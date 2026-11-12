import type { ClientSession, Document, ObjectId } from "mongodb";
import type { TenantGrant } from "../authorization/tenant-grant";
import { requireCondition } from "../errors";
import type { Family, LinkChange } from "../families/models";
import type { FamilyCommand } from "../families/validation";
import { objectId } from "../http-validation";
import type { Database } from "../infrastructure/database";
import { TenantQueries } from "../tenant-queries";
import { ageOn, businessDay } from "./dates";
import type { Member } from "./models";
import { escaped } from "./queries";
export const familyPerson = (m: Member, today: string) => ({
  id: m._id.toHexString(),
  code: m.code,
  fullName: m.fullName,
  age: ageOn(m.birthDate, today),
  householdRole: m.householdRole,
  participation: m.participation,
  familyId: m.familyId.toHexString(),
  version: m.version,
});
type Append = (
  g: TenantGrant,
  old: Member,
  m: Member,
  event: string,
  fields: string[],
  effectiveOn: string,
  eventDate: string | null,
  reason: string | null,
  tx: ClientSession,
  op: ObjectId,
  requestId: string,
) => Promise<unknown>;
export class FamilyMembers {
  private query: TenantQueries;
  constructor(
    private db: Database,
    private append: Append,
    key: string,
    private now: () => Date,
  ) {
    this.query = new TenantQueries(key, now, "family-members");
  }
  private get rows() {
    return this.db.db.collection<Member>("members");
  }
  searchStages(churchId: ObjectId, text: string, alternatives: Document[]): Document[] {
    return [
      {
        $lookup: {
          from: "members",
          let: { family: "$_id" },
          pipeline: [
            {
              $match: {
                churchId,
                nameTokens: { $regex: `^${escaped(text)}` },
                $expr: { $eq: ["$familyId", "$$family"] },
              },
            },
            { $limit: 1 },
            { $project: { _id: 1 } },
          ],
          as: "matchedPerson",
        },
      },
      { $match: { $or: [...alternatives, { "matchedPerson.0": { $exists: true } }] } },
      { $unset: "matchedPerson" },
    ];
  }
  async summary(churchId: ObjectId, ids: ObjectId[], tx?: ClientSession) {
    requireCondition(ids.length <= 50, 400, "INVALID_REQUEST");
    const today = businessDay(this.now());
    const rows = await this.rows
      .aggregate<{ _id: ObjectId; count: number; people: Member[] }>(
        [
          { $match: { churchId, familyId: { $in: ids } } },
          { $sort: { nameKey: 1, _id: 1 } },
          {
            $group: {
              _id: "$familyId",
              count: { $sum: 1 },
              people: { $firstN: { input: "$$ROOT", n: 6 } },
            },
          },
        ],
        { session: tx },
      )
      .toArray();
    const heads = await this.rows
      .find(
        { churchId, familyId: { $in: ids }, householdRole: "head" },
        {
          session: tx,
          projection: { _id: 1, familyId: 1, fullName: 1, participation: 1, version: 1 },
        },
      )
      .toArray();
    return ids.map((id) => {
      const r = rows.find((r) => r._id.equals(id));
      return {
        id: id.toHexString(),
        count: r?.count ?? 0,
        head: (() => {
          const h = heads.find((h) => h.familyId.equals(id));
          return h
            ? {
                id: h._id.toHexString(),
                fullName: h.fullName,
                participation: h.participation,
                version: h.version,
              }
            : null;
        })(),
        people: r?.people.map((m) => familyPerson(m, today)) ?? [],
      };
    });
  }
  async page(g: TenantGrant, familyId: ObjectId, q: URLSearchParams) {
    this.query.allow(q, ["limit", "cursor"]);
    const filter: Document = { churchId: g.churchId, familyId },
      context = this.query.context(g, "people", familyId.toHexString()),
      limit = this.query.limit(q);
    if (q.has("cursor")) {
      const c = this.query.decode(q.get("cursor") as string, context);
      filter.$or = [{ nameKey: { $gt: c.key } }, { nameKey: c.key, _id: { $gt: objectId(c.id) } }];
    }
    const rows = await this.rows
        .find(filter)
        .sort({ nameKey: 1, _id: 1 })
        .limit(limit + 1)
        .toArray(),
      more = rows.length > limit;
    if (more) rows.pop();
    const last = rows.at(-1);
    return {
      items: rows.map((m) => familyPerson(m, businessDay(this.now()))),
      nextCursor:
        more && last ? this.query.encode(context, last.nameKey, last._id.toHexString()) : null,
    };
  }
  async prepare(
    g: TenantGrant,
    source: Family,
    target: Family | null,
    command: Exclude<FamilyCommand, { kind: "area" }>,
    tx?: ClientSession,
  ) {
    const moves = "moves" in command ? command.moves : [],
      roles = command.roleChanges,
      all = [...moves, ...roles];
    requireCondition(all.length <= 100, 422, "FAMILY_COMMAND_LIMIT");
    requireCondition(
      new Set(all.map((c) => c.id.toLowerCase())).size === all.length,
      422,
      "VALIDATION_FAILED",
    );
    const rows = await this.rows
      .find({ churchId: g.churchId, _id: { $in: all.map((c) => objectId(c.id)) } }, { session: tx })
      .toArray();
    requireCondition(rows.length === all.length, 404, "NOT_FOUND");
    const summaries = await this.summary(
        g.churchId,
        [source._id, ...(target ? [target._id] : [])],
        tx,
      ),
      sourceCount = summaries[0]?.count ?? 0,
      targetCount = summaries[1]?.count ?? 0;
    if (command.kind === "merge") {
      requireCondition(sourceCount <= 100, 422, "FAMILY_COMMAND_LIMIT");
      requireCondition(moves.length === sourceCount, 412, "VERSION_CONFLICT");
    }
    const heads = await this.rows
      .find(
        {
          churchId: g.churchId,
          familyId: { $in: [source._id, ...(target ? [target._id] : [])] },
          householdRole: "head",
        },
        { session: tx },
      )
      .toArray();
    const changed = all.flatMap((c) => {
      const old = rows.find((m) => m._id.equals(objectId(c.id))) as Member,
        isMove = moves.includes(c);
      requireCondition(old.version === c.version, 412, "VERSION_CONFLICT");
      requireCondition(
        isMove
          ? old.familyId.equals(source._id)
          : old.familyId.equals(source._id) || (!!target && old.familyId.equals(target._id)),
        422,
        "FAMILY_MEMBER_MISMATCH",
      );
      const familyId = isMove ? (target as Family)._id : old.familyId;
      if (c.role === "head" && (old.householdRole !== "head" || !familyId.equals(old.familyId)))
        requireCondition(
          ["active", "long_absent"].includes(old.participation),
          422,
          "MEMBER_NOT_CURRENT",
        );
      requireCondition(
        !old.birthDate || command.effectiveOn >= old.birthDate,
        422,
        "VALIDATION_FAILED",
      );
      if (old.familyId.equals(familyId) && old.householdRole === c.role) return [];
      const m: Member = {
        ...old,
        familyId,
        householdRole: c.role,
        version: old.version + 1,
        writeFence: old.writeFence + 1,
        updatedAt: this.now(),
        updatedBy: g.actorId,
      };
      return [{ old, m }];
    });
    const finalHeads = [
      ...heads.filter((h) => !changed.some((c) => c.old._id.equals(h._id))),
      ...changed.filter((c) => c.m.householdRole === "head").map((c) => c.m),
    ];
    requireCondition(
      new Set(finalHeads.map((h) => h.familyId.toHexString())).size === finalHeads.length,
      409,
      "FAMILY_HEAD_EXISTS",
    );
    requireCondition(changed.length > 0 || command.kind === "merge", 422, "NO_CHANGES");
    const links: LinkChange[] = changed.map((c) => ({
      id: c.m._id.toHexString(),
      fullName: c.m.fullName,
      fromCode: c.old.familyId.equals(source._id) ? source.code : target?.code,
      toCode: c.m.familyId.equals(source._id) ? source.code : target?.code,
      fromFamilyId: c.old.familyId.toHexString(),
      toFamilyId: c.m.familyId.toHexString(),
      fromRole: c.old.householdRole,
      toRole: c.m.householdRole,
    }));
    return {
      changes: changed.map((c) => ({
        ...(links.find((l) => l.id === c.m._id.toHexString()) as LinkChange),
        fullName: c.m.fullName,
        version: c.old.version,
        code: c.m.code,
      })),
      links,
      sourceBefore: {
        count: sourceCount,
        head: heads.find((m) => m.familyId.equals(source._id))?.fullName ?? null,
      },
      targetBefore: target
        ? {
            count: targetCount,
            head: heads.find((m) => m.familyId.equals(target._id))?.fullName ?? null,
          }
        : null,
      source: {
        count: sourceCount - moves.length,
        head: finalHeads.find((m) => m.familyId.equals(source._id))?.fullName ?? null,
      },
      target: target
        ? {
            count: targetCount + moves.length,
            head: finalHeads.find((m) => m.familyId.equals(target._id))?.fullName ?? null,
          }
        : null,
      apply: async (session: ClientSession, op: ObjectId, requestId: string) => {
        requireCondition(session === tx, 500, "DEPENDENCY_UNAVAILABLE");
        for (const c of changed.sort(
          (a, b) => Number(a.m.householdRole === "head") - Number(b.m.householdRole === "head"),
        )) {
          const r = await this.rows.replaceOne(
            {
              _id: c.old._id,
              churchId: g.churchId,
              version: c.old.version,
              familyId: c.old.familyId,
            },
            c.m,
            { session },
          );
          requireCondition(r.matchedCount, 412, "VERSION_CONFLICT");
        }
        for (const c of changed)
          await this.append(
            g,
            c.old,
            c.m,
            c.old.familyId.equals(c.m.familyId) ? "household_role_changed" : "family_changed",
            c.old.familyId.equals(c.m.familyId) ? ["householdRole"] : ["familyId", "householdRole"],
            command.effectiveOn,
            null,
            command.reason,
            session,
            op,
            requestId,
          );
      },
    };
  }
}
