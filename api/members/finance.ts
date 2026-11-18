import { type ClientSession, type Filter, ObjectId } from "mongodb";
import { requireCondition } from "../errors";
import type { Database } from "../infrastructure/database";
import type { Member } from "./models";
import { escaped } from "./queries";
// Members-owned, financial read model. Never exports profile/family/contact/private details.
export class FinanceMembers {
  constructor(private db: Database) {}
  async identities(churchId: ObjectId, ids: ObjectId[], tx: ClientSession) {
    const rows = await this.db.db
      .collection<Member>("members")
      .find(
        { churchId, _id: { $in: ids } },
        { session: tx, projection: { _id: 1, code: 1, fullName: 1, participation: 1, version: 1 } },
      )
      .toArray();
    return rows.map((m) => ({
      id: m._id.toHexString(),
      code: m.code,
      name: m.fullName,
      current: ["active", "long_absent"].includes(m.participation),
      version: m.version,
    }));
  }
  async page(
    churchId: ObjectId,
    q: string,
    after: { key: string; id: string } | null,
    limit: number,
    tx: ClientSession,
  ) {
    const filter: Filter<Member> = { churchId, participation: { $in: ["active", "long_absent"] } },
      and: Filter<Member>[] = [];
    if (q)
      and.push({
        $or: [
          { code: { $regex: `^${escaped(q)}`, $options: "i" } },
          { nameTokens: { $regex: `^${escaped(q.toLowerCase())}` } },
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
    return (
      await this.db.db
        .collection<Member>("members")
        .find(filter, {
          session: tx,
          maxTimeMS: 3000,
          projection: { code: 1, fullName: 1, nameKey: 1, version: 1 },
        })
        .sort({ nameKey: 1, _id: 1 })
        .limit(limit)
        .toArray()
    ).map((m) => ({ id: m._id.toHexString(), code: m.code, name: m.fullName, key: m.nameKey }));
  }
  async fence(churchId: ObjectId, id: ObjectId, version: number, tx: ClientSession) {
    const r = await this.db.db
      .collection<Member>("members")
      .updateOne({ _id: id, churchId, version }, { $inc: { writeFence: 1 } }, { session: tx });
    requireCondition(r.matchedCount, 412, "FINANCE_SOURCE_STALE");
  }
}
