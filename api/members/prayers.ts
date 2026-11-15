import { type ClientSession, type Filter, ObjectId } from "mongodb";
import type { TenantGrant } from "../authorization/tenant-grant";
import { requireCondition } from "../errors";
import type { Database } from "../infrastructure/database";
import type { Member } from "./models";
import { escaped } from "./queries";
export class PrayerMembers {
  constructor(private db: Database) {}
  async person(g: TenantGrant, id: string, tx: ClientSession) {
    const p = await this.db.db
      .collection<Member>("members")
      .findOne(
        { _id: new ObjectId(id), churchId: g.churchId },
        { session: tx, projection: { code: 1, fullName: 1, participation: 1, version: 1 } },
      );
    return p
      ? {
          id: p._id.toHexString(),
          code: p.code,
          fullName: p.fullName,
          version: p.version,
          available: ["active", "long_absent"].includes(p.participation),
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
    const and: Filter<Member>[] = [];
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
    return (
      await this.db.db
        .collection<Member>("members")
        .find(
          {
            churchId: g.churchId,
            participation: { $in: ["active", "long_absent"] },
            ...(and.length ? { $and: and } : {}),
          },
          { session: tx, projection: { code: 1, fullName: 1, nameKey: 1 } },
        )
        .sort({ nameKey: 1, _id: 1 })
        .limit(limit)
        .toArray()
    ).map((p) => ({ id: p._id.toHexString(), code: p.code, fullName: p.fullName, key: p.nameKey }));
  }
  async fence(
    g: TenantGrant,
    p: NonNullable<Awaited<ReturnType<PrayerMembers["person"]>>>,
    tx: ClientSession,
  ) {
    const r = await this.db.db
      .collection<Member>("members")
      .updateOne(
        { _id: new ObjectId(p.id), churchId: g.churchId, version: p.version },
        { $inc: { writeFence: 1 } },
        { session: tx },
      );
    requireCondition(r.matchedCount, 412, "PRAYER_SOURCE_STALE");
  }
}
