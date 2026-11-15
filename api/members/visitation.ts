import { type ClientSession, type Filter, ObjectId } from "mongodb";
import type { TenantGrant } from "../authorization/tenant-grant";
import { requireCondition } from "../errors";
import type { Database } from "../infrastructure/database";
import type { Member } from "./models";
import { escaped } from "./queries";
export class VisitationMembers {
  constructor(private db: Database) {}
  async person(g: TenantGrant, id: string, tx: ClientSession) {
    const m = await this.db.db.collection<Member>("members").findOne(
      { _id: new ObjectId(id), churchId: g.churchId },
      {
        session: tx,
        projection: { code: 1, fullName: 1, phone: 1, familyId: 1, participation: 1, version: 1 },
      },
    );
    return m
      ? {
          id: m._id.toHexString(),
          code: m.code,
          fullName: m.fullName,
          phone: m.phone,
          familyId: m.familyId.toHexString(),
          version: m.version,
          available: ["active", "long_absent"].includes(m.participation),
        }
      : null;
  }
  async page(
    g: TenantGrant,
    q: string,
    after: { key: string; id: string } | null,
    limit: number,
    tx: ClientSession,
  ) {
    const f: Filter<Member> = {
        churchId: g.churchId,
        participation: { $in: ["active", "long_absent"] },
      },
      and: Filter<Member>[] = [];
    if (q)
      and.push({
        $or: [
          { code: { $regex: `^${escaped(q)}`, $options: "i" } },
          { nameTokens: { $regex: `^${escaped(q)}`, $options: "i" } },
          { nameKey: { $regex: `^${escaped(q.toLowerCase())}` } },
        ],
      });
    if (after)
      and.push({
        $or: [
          { nameKey: { $gt: after.key } },
          { nameKey: after.key, _id: { $gt: new ObjectId(after.id) } },
        ],
      });
    if (and.length) f.$and = and;
    return (
      await this.db.db
        .collection<Member>("members")
        .find(f, { session: tx, projection: { code: 1, fullName: 1, nameKey: 1 } })
        .sort({ nameKey: 1, _id: 1 })
        .limit(limit)
        .toArray()
    ).map((m) => ({ id: m._id.toHexString(), code: m.code, fullName: m.fullName, key: m.nameKey }));
  }
  async fence(
    g: TenantGrant,
    p: NonNullable<Awaited<ReturnType<VisitationMembers["person"]>>>,
    tx: ClientSession,
  ) {
    const r = await this.db.db
      .collection<Member>("members")
      .updateOne(
        { _id: new ObjectId(p.id), churchId: g.churchId, version: p.version },
        { $inc: { writeFence: 1 } },
        { session: tx },
      );
    requireCondition(r.matchedCount, 412, "VISIT_SOURCE_STALE");
  }
}
