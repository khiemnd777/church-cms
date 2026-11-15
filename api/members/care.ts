import { type ClientSession, ObjectId } from "mongodb";
import type { TenantGrant } from "../authorization/tenant-grant";
import { requireCondition } from "../errors";
import type { Database } from "../infrastructure/database";
import type { Member } from "./models";
export class CareMembers {
  constructor(private db: Database) {}
  private projection = {
    code: 1,
    fullName: 1,
    participation: 1,
    version: 1,
    "visitor.stage": 1,
    "visitor.believedOn": 1,
  };
  private dto(m: Member) {
    return {
      id: m._id.toHexString(),
      code: m.code,
      name: m.fullName,
      version: m.version,
      available: ["active", "long_absent"].includes(m.participation),
      belief: m.visitor?.stage === "believed" ? m.visitor.believedOn : null,
    };
  }
  async page(g: TenantGrant, after: string | null, limit: number, tx: ClientSession) {
    requireCondition(limit <= 101, 400, "INVALID_REQUEST");
    return (
      await this.db.db
        .collection<Member>("members")
        .find(
          { churchId: g.churchId, ...(after ? { _id: { $gt: new ObjectId(after) } } : {}) },
          { session: tx, projection: this.projection },
        )
        .sort({ _id: 1 })
        .limit(limit)
        .toArray()
    ).map((m) => this.dto(m));
  }
  async facts(g: TenantGrant, ids: string[], tx: ClientSession) {
    requireCondition(ids.length <= 100, 400, "INVALID_REQUEST");
    return new Map(
      (
        await this.db.db
          .collection<Member>("members")
          .find(
            { churchId: g.churchId, _id: { $in: ids.map((id) => new ObjectId(id)) } },
            { session: tx, projection: this.projection },
          )
          .limit(100)
          .toArray()
      ).map((m) => {
        const p = this.dto(m);
        return [p.id, p] as const;
      }),
    );
  }
  async fence(g: TenantGrant, p: { id: string; version: number }, tx: ClientSession) {
    const r = await this.db.db
      .collection<Member>("members")
      .updateOne(
        { _id: new ObjectId(p.id), churchId: g.churchId, version: p.version },
        { $inc: { writeFence: 1 } },
        { session: tx },
      );
    requireCondition(r.matchedCount, 412, "CARE_SOURCE_STALE");
  }
}
