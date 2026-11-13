import type { ClientSession, ObjectId } from "mongodb";
import { requireCondition } from "../errors";
import type { Database } from "../infrastructure/database";
import type { Member } from "./models";
export class CardMembers {
  constructor(private db: Database) {}
  async identity(churchId: ObjectId, memberId: ObjectId, tx: ClientSession) {
    const m = await this.db.db
      .collection<Member>("members")
      .findOne(
        { _id: memberId, churchId },
        { session: tx, projection: { fullName: 1, code: 1, participation: 1 } },
      );
    requireCondition(m, 404, "NOT_FOUND");
    return {
      fullName: m.fullName,
      code: m.code,
      current: ["active", "long_absent"].includes(m.participation),
    };
  }
  async current(churchId: ObjectId, memberId: ObjectId, tx: ClientSession) {
    const m = await this.db.db
      .collection<Member>("members")
      .findOne(
        { _id: memberId, churchId, participation: { $in: ["active", "long_absent"] } },
        { session: tx, projection: { _id: 1 } },
      );
    return !!m;
  }
}
