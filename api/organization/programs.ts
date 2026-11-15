import { type ClientSession, type Filter, ObjectId } from "mongodb";
import type { TenantGrant } from "../authorization/tenant-grant";
import { requireCondition } from "../errors";
import type { Database } from "../infrastructure/database";
import { TenantQueries } from "../tenant-queries";
import type { Unit } from "./models";
import type { BoardTerm } from "./runtime";
export class ProgramOrganization {
  private query: TenantQueries;
  constructor(
    private db: Database,
    key: string,
    now: () => Date,
  ) {
    this.query = new TenantQueries(key, now, "program-units");
  }
  async unit(g: TenantGrant, id: string, tx: ClientSession, active = false) {
    const u = await this.db.db.collection<Unit>("organization_units").findOne(
      {
        churchId: g.churchId,
        _id: new ObjectId(id),
        kind: { $in: ["age_ministry", "service_ministry", "board"] },
        ...(active || g.unitScope ? { status: "active" as const } : {}),
      },
      { session: tx },
    );
    requireCondition(
      u && (!g.unitScope || (u.kind !== "board" && g.unitScope.includes(id))),
      404,
      "NOT_FOUND",
    );
    return u;
  }
  async list(g: TenantGrant, q: URLSearchParams) {
    this.query.allow(q, ["limit", "cursor"]);
    const limit = this.query.limit(q),
      context = this.query.context(g, "units", g.unitScope ?? null),
      after = q.has("cursor") ? this.query.decode(q.get("cursor") as string, context) : null;
    return this.db.readSnapshot(g.churchId.toHexString(), async (tx) => {
      await g.fence(tx);
      const f: Filter<Unit> = {
        churchId: g.churchId,
        status: "active",
        kind: {
          $in: g.unitScope
            ? ["age_ministry", "service_ministry"]
            : ["age_ministry", "service_ministry", "board"],
        },
        ...(g.unitScope ? { _id: { $in: g.unitScope.map((id) => new ObjectId(id)) } } : {}),
      };
      if (after)
        f.$and = [
          {
            $or: [
              { nameKey: { $gt: after.key } },
              { nameKey: after.key, _id: { $gt: new ObjectId(after.id) } },
            ],
          },
        ];
      const rows = await this.db.db
          .collection<Unit>("organization_units")
          .find(f, { session: tx })
          .sort({ nameKey: 1, _id: 1 })
          .limit(limit + 1)
          .toArray(),
        more = rows.length > limit;
      rows.splice(limit);
      const last = rows.at(-1);
      return {
        items: rows.map((u) => ({ id: u._id.toHexString(), name: u.name, kind: u.kind })),
        nextCursor:
          more && last ? this.query.encode(context, last.nameKey, last._id.toHexString()) : null,
      };
    });
  }
  async activeIds(g: TenantGrant, tx: ClientSession) {
    return (
      await this.db.db
        .collection<Unit>("organization_units")
        .find(
          {
            churchId: g.churchId,
            status: "active",
            kind: { $in: ["age_ministry", "service_ministry"] },
            _id: { $in: (g.unitScope ?? []).map((id) => new ObjectId(id)) },
          },
          { session: tx, projection: { _id: 1 } },
        )
        .limit(50)
        .toArray()
    ).map((u) => u._id);
  }
  async context(g: TenantGrant, id: string, day: string, tx: ClientSession, active = false) {
    const unit = await this.unit(g, id, tx, active);
    const terms =
      unit.kind === "board"
        ? await this.db.db
            .collection<BoardTerm>("organization_terms")
            .find(
              {
                churchId: g.churchId,
                state: "confirmed",
                startOn: { $lte: day },
                endOn: { $gte: day },
              },
              { session: tx },
            )
            .limit(2)
            .toArray()
        : [];
    const term = terms.length === 1 ? (terms[0] ?? null) : null;
    return {
      unit: {
        id: unit._id.toHexString(),
        name: unit.name,
        kind: unit.kind,
        version: unit.version,
        status: unit.status,
      },
      available: unit.kind !== "board" || !!term,
      term: term
        ? {
            id: term._id.toHexString(),
            version: term.version,
            label: term.label,
            memberIds: term.appointments.map((a) => a.memberId.toHexString()),
          }
        : null,
    };
  }
  async fence(
    g: TenantGrant,
    c: Awaited<ReturnType<ProgramOrganization["context"]>>,
    tx: ClientSession,
  ) {
    const r = await this.db.db.collection<Unit>("organization_units").updateOne(
      {
        _id: new ObjectId(c.unit.id),
        churchId: g.churchId,
        version: c.unit.version,
        status: "active",
      },
      { $inc: { writeFence: 1 } },
      { session: tx },
    );
    requireCondition(r.matchedCount, 412, "PROGRAM_SOURCE_STALE");
    if (c.term) {
      const t = await this.db.db.collection<BoardTerm>("organization_terms").updateOne(
        {
          _id: new ObjectId(c.term.id),
          churchId: g.churchId,
          version: c.term.version,
          state: "confirmed",
        },
        { $inc: { writeFence: 1 } },
        { session: tx },
      );
      requireCondition(t.matchedCount, 412, "PROGRAM_SOURCE_STALE");
    }
  }
}
