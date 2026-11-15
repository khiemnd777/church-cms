import { type ClientSession, type Filter, ObjectId } from "mongodb";
import type { TenantGrant } from "../authorization/tenant-grant";
import { requireCondition } from "../errors";
import type { Database } from "../infrastructure/database";
import { escaped } from "../members/queries";
import type { Family } from "./models";
export class VisitationFamilies {
  constructor(private db: Database) {}
  async family(g: TenantGrant, id: string, tx: ClientSession) {
    const f = await this.db.db
      .collection<Family>("families")
      .findOne(
        { _id: new ObjectId(id), churchId: g.churchId },
        { session: tx, projection: { code: 1, name: 1, address: 1, status: 1, version: 1 } },
      );
    return f
      ? {
          id: f._id.toHexString(),
          code: f.code,
          name: f.name,
          address: f.address,
          version: f.version,
          available: f.status === "active",
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
    const f: Filter<Family> = { churchId: g.churchId, status: "active" },
      and: Filter<Family>[] = [];
    if (q)
      and.push({
        $or: [
          { code: { $regex: `^${escaped(q)}`, $options: "i" } },
          { name: { $regex: `^${escaped(q)}`, $options: "i" } },
        ],
      });
    if (after)
      and.push({
        $or: [
          { code: { $gt: after.key } },
          { code: after.key, _id: { $gt: new ObjectId(after.id) } },
        ],
      });
    if (and.length) f.$and = and;
    return (
      await this.db.db
        .collection<Family>("families")
        .find(f, { session: tx, projection: { code: 1, name: 1 } })
        .sort({ code: 1, _id: 1 })
        .limit(limit)
        .toArray()
    ).map((f) => ({
      id: f._id.toHexString(),
      code: f.code,
      fullName: f.name ?? f.code,
      key: f.code,
    }));
  }
  async fence(
    g: TenantGrant,
    f: NonNullable<Awaited<ReturnType<VisitationFamilies["family"]>>>,
    tx: ClientSession,
  ) {
    const r = await this.db.db
      .collection<Family>("families")
      .updateOne(
        { _id: new ObjectId(f.id), churchId: g.churchId, version: f.version },
        { $inc: { writeFence: 1 } },
        { session: tx },
      );
    requireCondition(r.matchedCount, 412, "VISIT_SOURCE_STALE");
  }
}
