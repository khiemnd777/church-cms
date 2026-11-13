import { type ClientSession, type Filter, ObjectId } from "mongodb";
import type { TenantGrant } from "../authorization/tenant-grant";
import { requireCondition } from "../errors";
import type { Database } from "../infrastructure/database";
import type { Baptism, Member } from "./models";
import { escaped } from "./queries";
export type BaptismChange = (
  g: TenantGrant,
  memberId: ObjectId,
  before: Baptism | null,
  after: Baptism,
  tx: ClientSession,
  op: ObjectId,
  requestId: string,
  originRiteId?: ObjectId,
) => Promise<void>;
export class RiteMembers {
  constructor(
    private db: Database,
    readonly setBaptism: (
      g: TenantGrant,
      id: ObjectId,
      expected: number,
      fact: Baptism,
      reason: string,
      tx: ClientSession,
      op: ObjectId,
      requestId: string,
      riteId: ObjectId,
    ) => Promise<void>,
  ) {}
  async identity(g: TenantGrant, id: string, tx: ClientSession) {
    const m = await this.db.db
      .collection<Member>("members")
      .findOne({ _id: new ObjectId(id), churchId: g.churchId }, { session: tx });
    requireCondition(m, 404, "NOT_FOUND");
    return {
      id: m._id.toHexString(),
      fullName: m.fullName,
      code: m.code,
      birthDate: m.birthDate,
      version: m.version,
      baptism: m.baptism,
    };
  }
  async fence(g: TenantGrant, id: string, expected: number, tx: ClientSession) {
    const r = await this.db.db
      .collection<Member>("members")
      .updateOne(
        { _id: new ObjectId(id), churchId: g.churchId, version: expected },
        { $inc: { writeFence: 1 } },
        { session: tx },
      );
    requireCondition(r.matchedCount, 412, "VERSION_CONFLICT");
  }
  async page(
    g: TenantGrant,
    term: string,
    after: { key: string; id: string } | null,
    limit: number,
    onlyBaptized: boolean,
    tx: ClientSession,
  ) {
    const filter: Filter<Member> = {
      churchId: g.churchId,
      ...(onlyBaptized ? { "baptism.status": "baptized" } : {}),
    };
    const clauses: Filter<Member>[] = [];
    if (term)
      clauses.push({
        $or: [
          { code: { $regex: `^${escaped(term)}`, $options: "i" } },
          { nameTokens: { $regex: `^${escaped(term)}`, $options: "i" } },
        ],
      });
    if (after)
      clauses.push({
        $or: [
          { nameKey: { $gt: after.key } },
          { nameKey: after.key, _id: { $gt: new ObjectId(after.id) } },
        ],
      });
    if (clauses.length) filter.$and = clauses;
    const rows = await this.db.db
      .collection<Member>("members")
      .find(filter, {
        session: tx,
        projection: { fullName: 1, code: 1, birthDate: 1, nameKey: 1, baptism: 1, version: 1 },
      })
      .sort({ nameKey: 1, _id: 1 })
      .limit(limit)
      .toArray();
    return rows.map((m) => ({
      id: m._id.toHexString(),
      fullName: m.fullName,
      code: m.code,
      birthDate: m.birthDate,
      nameKey: m.nameKey,
      baptism: m.baptism,
      version: m.version,
    }));
  }
}
