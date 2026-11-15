import { type ClientSession, ObjectId } from "mongodb";
import type { TenantGrant } from "../authorization/tenant-grant";
import { requireCondition } from "../errors";
import type { Database } from "../infrastructure/database";
import type { Family } from "./models";
export class CareFamilies {
  constructor(private db: Database) {}
  async facts(g: TenantGrant, ids: string[], tx: ClientSession) {
    requireCondition(ids.length <= 100, 400, "INVALID_REQUEST");
    return new Map(
      (
        await this.db.db
          .collection<Family>("families")
          .find(
            { churchId: g.churchId, _id: { $in: ids.map((id) => new ObjectId(id)) } },
            { session: tx, projection: { code: 1, name: 1, status: 1, version: 1 } },
          )
          .limit(100)
          .toArray()
      ).map(
        (f) =>
          [
            f._id.toHexString(),
            {
              id: f._id.toHexString(),
              code: f.code,
              name: f.name ?? f.code,
              version: f.version,
              available: f.status === "active",
            },
          ] as const,
      ),
    );
  }
  async fence(g: TenantGrant, p: { id: string; version: number }, tx: ClientSession) {
    const r = await this.db.db
      .collection<Family>("families")
      .updateOne(
        { _id: new ObjectId(p.id), churchId: g.churchId, version: p.version },
        { $inc: { writeFence: 1 } },
        { session: tx },
      );
    requireCondition(r.matchedCount, 412, "CARE_SOURCE_STALE");
  }
}
