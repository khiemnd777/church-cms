import { type ClientSession, type Filter, ObjectId } from "mongodb";
import type { TenantGrant } from "../authorization/tenant-grant";
import { requireCondition } from "../errors";
import type { Database } from "../infrastructure/database";
import type { UnitKind } from "../organization/models";
import type { Member } from "./models";
import { escaped } from "./queries";
export interface ProgramUnitRef {
  id: string;
  kind: UnitKind;
  termMemberIds: string[] | null;
}
export interface ProgramPerson {
  id: string;
  code: string;
  fullName: string;
  version: number;
  nameKey: string;
}
// Public reduced Members read/fence contract for Programs; no profile/membership writes.
export class ProgramMembers {
  constructor(private db: Database) {}
  private filter(g: TenantGrant, u: ProgramUnitRef): Filter<Member> {
    return {
      churchId: g.churchId,
      participation: { $in: ["active", "long_absent"] },
      ...(u.kind === "board"
        ? { _id: { $in: (u.termMemberIds ?? []).map((id) => new ObjectId(id)) } }
        : { "assignment.unitIds": new ObjectId(u.id) }),
    };
  }
  async candidates(
    g: TenantGrant,
    u: ProgramUnitRef,
    tx: ClientSession,
    limit: number,
    q = "",
    after: { key: string; id: string } | null = null,
  ) {
    const f = this.filter(g, u),
      and: Filter<Member>[] = [];
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
    if (and.length) f.$and = and;
    return (
      await this.db.db
        .collection<Member>("members")
        .find(f, { session: tx, projection: { code: 1, fullName: 1, version: 1, nameKey: 1 } })
        .sort({ nameKey: 1, _id: 1 })
        .limit(limit)
        .toArray()
    ).map((m) => ({
      id: m._id.toHexString(),
      code: m.code,
      fullName: m.fullName,
      version: m.version,
      nameKey: m.nameKey,
    }));
  }
  async selected(g: TenantGrant, u: ProgramUnitRef, ids: string[], tx: ClientSession) {
    requireCondition(ids.length <= 50, 400, "INVALID_REQUEST");
    const f = this.filter(g, u);
    f.$and = [{ _id: { $in: ids.map((id) => new ObjectId(id)) } }];
    return (
      await this.db.db
        .collection<Member>("members")
        .find(f, { session: tx, projection: { code: 1, fullName: 1, version: 1, nameKey: 1 } })
        .sort({ _id: 1 })
        .limit(50)
        .toArray()
    ).map((m) => ({
      id: m._id.toHexString(),
      code: m.code,
      fullName: m.fullName,
      version: m.version,
      nameKey: m.nameKey,
    }));
  }
  async fence(g: TenantGrant, u: ProgramUnitRef, p: ProgramPerson, tx: ClientSession) {
    const f = this.filter(g, u);
    f.$and = [{ _id: new ObjectId(p.id), version: p.version }];
    const r = await this.db.db
      .collection<Member>("members")
      .updateOne(f, { $inc: { writeFence: 1 } }, { session: tx });
    requireCondition(r.matchedCount, 412, "PROGRAM_SOURCE_STALE");
  }
}
