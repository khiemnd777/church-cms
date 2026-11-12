import type { ClientSession, Document, ObjectId } from "mongodb";
import type { TenantGrant } from "../authorization/tenant-grant";
import { requireCondition } from "../errors";
import { objectId } from "../http-validation";
import type { Database } from "../infrastructure/database";
import type { UnitKind } from "../organization/models";
import { TenantQueries } from "../tenant-queries";
import { ageOn, businessDay } from "./dates";
import type { Member } from "./models";
import { escaped } from "./queries";

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
// Organization consumes this bounded public Members port, never writes Member storage.
export class OrganizationMembers {
  private query: TenantQueries;
  constructor(
    private db: Database,
    private append: Append,
    key: string,
    private now: () => Date,
  ) {
    this.query = new TenantQueries(key, now, "organization-roster");
  }
  private get rows() {
    return this.db.db.collection<Member>("members");
  }
  private stages(churchId: ObjectId, unitId: ObjectId, kind: UnitKind): Document[] {
    const stages: Document[] = [
      {
        $match: {
          churchId,
          participation: { $in: ["active", "long_absent"] },
          ...(kind !== "area" ? { "assignment.unitIds": unitId } : {}),
        },
      },
    ];
    if (kind === "area")
      stages.push(
        {
          $lookup: {
            from: "families",
            let: { id: "$familyId" },
            pipeline: [
              {
                $match: {
                  churchId,
                  areaId: unitId,
                  status: "active",
                  $expr: { $eq: ["$_id", "$$id"] },
                },
              },
              { $project: { _id: 1 } },
            ],
            as: "matchedFamily",
          },
        },
        { $match: { "matchedFamily.0": { $exists: true } } },
      );
    return stages;
  }
  async count(churchId: ObjectId, unitId: ObjectId, kind: UnitKind, tx: ClientSession) {
    const rows = await this.rows
      .aggregate<{ n: number }>([...this.stages(churchId, unitId, kind), { $count: "n" }], {
        session: tx,
      })
      .toArray();
    return rows[0]?.n ?? 0;
  }
  async roster(
    g: TenantGrant,
    unitId: ObjectId,
    kind: UnitKind,
    unitVersion: number,
    q: URLSearchParams,
    tx: ClientSession,
  ) {
    this.query.allow(q, ["q", "limit", "cursor"]);
    const term = (q.get("q") ?? "").normalize("NFC").trim().toLowerCase();
    requireCondition(term.length <= 100, 400, "INVALID_REQUEST");
    const context = this.query.context(g, `unit/${unitId}`, [
        term,
        unitVersion,
        g.unitScope ?? null,
      ]),
      limit = this.query.limit(q);
    const stages = this.stages(g.churchId, unitId, kind);
    if (term)
      stages.push({
        $match: {
          $or: [
            { code: { $regex: `^${escaped(term.toUpperCase())}` } },
            { nameTokens: { $regex: `^${escaped(term)}` } },
          ],
        },
      });
    const count = await this.rows
      .aggregate<{ n: number }>([...stages, { $count: "n" }], { session: tx })
      .toArray();
    if (q.has("cursor")) {
      const c = this.query.decode(q.get("cursor") as string, context);
      stages.push({
        $match: {
          $or: [{ nameKey: { $gt: c.key } }, { nameKey: c.key, _id: { $gt: objectId(c.id) } }],
        },
      });
    }
    stages.push(
      { $sort: { nameKey: 1, _id: 1 } },
      { $limit: limit + 1 },
      {
        $project: {
          _id: 1,
          nameKey: 1,
          code: 1,
          fullName: 1,
          birthDate: 1,
          participation: 1,
          version: 1,
        },
      },
    );
    const rows = await this.rows.aggregate<Member>(stages, { session: tx }).toArray(),
      more = rows.length > limit;
    if (more) rows.pop();
    const last = rows.at(-1);
    return {
      total: count[0]?.n ?? 0,
      items: rows.map((m) => ({
        id: m._id.toHexString(),
        code: m.code,
        fullName: m.fullName,
        age: ageOn(m.birthDate, businessDay(this.now())),
        participation: m.participation,
        unitId: unitId.toHexString(),
        ...(!g.unitScope ? { version: m.version } : {}),
      })),
      nextCursor:
        more && last ? this.query.encode(context, last.nameKey, last._id.toHexString()) : null,
    };
  }
  async eligible(churchId: ObjectId, id: string, tx: ClientSession) {
    const m = await this.rows.findOneAndUpdate(
      {
        _id: objectId(id),
        churchId,
        type: "believer",
        membership: "member",
        participation: "active",
      },
      { $inc: { writeFence: 1 } },
      { session: tx, returnDocument: "after" },
    );
    requireCondition(m, 422, "APPOINTEE_NOT_AVAILABLE");
    return { memberId: m._id, code: m.code, fullName: m.fullName };
  }
  async labels(churchId: ObjectId, ids: ObjectId[], tx: ClientSession) {
    requireCondition(ids.length <= 100, 400, "INVALID_REQUEST");
    const rows = await this.rows
      .find(
        { churchId, _id: { $in: ids } },
        {
          session: tx,
          projection: { _id: 1, code: 1, fullName: 1, type: 1, membership: 1, participation: 1 },
        },
      )
      .toArray();
    return rows.map((m) => ({
      id: m._id.toHexString(),
      code: m.code,
      fullName: m.fullName,
      eligible: m.type === "believer" && m.membership === "member" && m.participation === "active",
    }));
  }
  async previewServices(
    g: TenantGrant,
    changes: { id: string; version: number; add: boolean }[],
    tx: ClientSession,
  ) {
    const results = [];
    for (const c of changes) {
      const m = await this.rows.findOne(
        { _id: objectId(c.id), churchId: g.churchId },
        { session: tx },
      );
      requireCondition(m, 404, "NOT_FOUND");
      requireCondition(m.version === c.version, 412, "VERSION_CONFLICT");
      requireCondition(
        !c.add || ["active", "long_absent"].includes(m.participation),
        422,
        "MEMBER_NOT_CURRENT",
      );
      results.push({
        id: c.id,
        code: m.code,
        fullName: m.fullName,
        add: c.add,
        version: c.version,
        assignmentMode: m.assignment.mode,
        preservesAgeAndArea: true,
      });
    }
    return results;
  }
  async changeServices(
    g: TenantGrant,
    unitId: ObjectId,
    changes: { id: string; version: number; add: boolean }[],
    effectiveOn: string,
    reason: string,
    tx: ClientSession,
    op: ObjectId,
    requestId: string,
  ) {
    const results = [];
    for (const change of changes) {
      const old = await this.rows.findOne(
        { _id: objectId(change.id), churchId: g.churchId },
        { session: tx },
      );
      requireCondition(old, 404, "NOT_FOUND");
      requireCondition(old.version === change.version, 412, "VERSION_CONFLICT");
      requireCondition(
        !change.add || ["active", "long_absent"].includes(old.participation),
        422,
        "MEMBER_NOT_CURRENT",
      );
      const ids = old.assignment.unitIds.filter((id) => !id.equals(unitId));
      if (change.add) ids.push(unitId);
      requireCondition(ids.length <= 50, 422, "VALIDATION_FAILED");
      const m: Member = {
        ...old,
        assignment: { ...old.assignment, unitIds: ids },
        version: old.version + 1,
        writeFence: old.writeFence + 1,
        updatedAt: this.now(),
        updatedBy: g.actorId,
      };
      const changed = await this.rows.replaceOne(
        { _id: old._id, churchId: g.churchId, version: change.version },
        m,
        { session: tx },
      );
      requireCondition(changed.matchedCount, 412, "VERSION_CONFLICT");
      await this.append(
        g,
        old,
        m,
        "service_membership_changed",
        ["assignment"],
        effectiveOn,
        null,
        reason,
        tx,
        op,
        requestId,
      );
      results.push({ id: m._id.toHexString(), version: m.version });
    }
    return results;
  }
}
