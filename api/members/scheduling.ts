import { type ClientSession, type Filter, ObjectId } from "mongodb";
import type { TenantGrant } from "../authorization/tenant-grant";
import { requireCondition } from "../errors";
import type { Database } from "../infrastructure/database";
import type { Member } from "./models";
import { escaped } from "./queries";
// Scheduling receives reduced identities through this public Members port, never profile storage.
export class SchedulingMembers {
  constructor(private db: Database) {}
  async identity(g: TenantGrant, id: string, tx: ClientSession) {
    const m = await this.db.db.collection<Member>("members").findOne(
      {
        churchId: g.churchId,
        _id: new ObjectId(id),
        participation: { $in: ["active", "long_absent"] },
      },
      { session: tx },
    );
    requireCondition(m, 422, "SCHEDULE_PERSON_UNAVAILABLE");
    return { id: m._id.toHexString(), fullName: m.fullName, code: m.code, version: m.version };
  }
  async fence(g: TenantGrant, id: string, version: number, tx: ClientSession) {
    const r = await this.db.db.collection<Member>("members").updateOne(
      {
        churchId: g.churchId,
        _id: new ObjectId(id),
        version,
        participation: { $in: ["active", "long_absent"] },
      },
      { $inc: { writeFence: 1 } },
      { session: tx },
    );
    requireCondition(r.matchedCount, 412, "VERSION_CONFLICT");
  }
  async page(
    g: TenantGrant,
    q: string,
    after: { key: string; id: string } | null,
    limit: number,
    tx: ClientSession,
  ) {
    const filter: Filter<Member> = {
      churchId: g.churchId,
      participation: { $in: ["active", "long_absent"] },
    };
    const and: Filter<Member>[] = [];
    if (q)
      and.push({
        $or: [
          { code: { $regex: `^${escaped(q)}`, $options: "i" } },
          { nameTokens: { $regex: `^${escaped(q)}`, $options: "i" } },
        ],
      });
    if (after)
      and.push({
        $or: [
          { nameKey: { $gt: after.key } },
          { nameKey: after.key, _id: { $gt: new ObjectId(after.id) } },
        ],
      });
    if (and.length) filter.$and = and;
    return this.db.db
      .collection<Member>("members")
      .find(filter, { session: tx, projection: { fullName: 1, code: 1, nameKey: 1 } })
      .sort({ nameKey: 1, _id: 1 })
      .limit(limit)
      .toArray();
  }
}
