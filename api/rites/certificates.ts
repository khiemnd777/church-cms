import { type ClientSession, ObjectId } from "mongodb";
import type { TenantGrant } from "../authorization/tenant-grant";
import { requireCondition } from "../errors";
import type { Database } from "../infrastructure/database";
import { type RiteRecord, riteDto } from "./models";
export class CertificateRites {
  constructor(private db: Database) {}
  async get(g: TenantGrant, id: string, tx: ClientSession) {
    const r = await this.db.db
      .collection<RiteRecord>("rite_records")
      .findOne({ _id: new ObjectId(id), churchId: g.churchId }, { session: tx });
    requireCondition(r, 404, "NOT_FOUND");
    return { ...riteDto(r), memberIds: r.memberIds.map((id) => id.toHexString()) };
  }
  async fence(g: TenantGrant, id: string, expected: number, tx: ClientSession) {
    const r = await this.db.db
      .collection<RiteRecord>("rite_records")
      .updateOne(
        { _id: new ObjectId(id), churchId: g.churchId, version: expected },
        { $inc: { writeFence: 1 } },
        { session: tx },
      );
    requireCondition(r.matchedCount, 412, "VERSION_CONFLICT");
  }
}
