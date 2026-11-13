import { type ClientSession, type Filter, ObjectId } from "mongodb";
import { requireCondition } from "../errors";
import type { Database } from "../infrastructure/database";
import type { Member } from "./models";
import { escaped } from "./queries";
export class PrepMembers {
  constructor(private db: Database) {}
  async identity(churchId: ObjectId, id: ObjectId, tx: ClientSession) {
    const m = await this.db.db.collection<Member>("members").findOne(
      { _id: id, churchId },
      {
        session: tx,
        projection: {
          fullName: 1,
          code: 1,
          nameKey: 1,
          birthDate: 1,
          type: 1,
          membership: 1,
          participation: 1,
          baptism: 1,
        },
      },
    );
    requireCondition(m, 404, "NOT_FOUND");
    return {
      ...m,
      current: ["active", "long_absent"].includes(m.participation),
      eligible:
        m.type === "believer" &&
        m.membership === "preparatory" &&
        ["active", "long_absent"].includes(m.participation) &&
        m.baptism.status !== "baptized",
    };
  }
  async candidates(
    churchId: ObjectId,
    term: string,
    after: { key: string; id: string } | null,
    limit: number,
    tx: ClientSession,
  ) {
    const filter: Filter<Member> = {
      churchId,
      type: "believer",
      membership: "preparatory",
      participation: { $in: ["active", "long_absent"] },
      "baptism.status": { $in: ["unknown", "not_baptized"] },
    };
    const predicates: Filter<Member>[] = [];
    if (term)
      predicates.push({
        $or: [
          { code: { $regex: `^${escaped(term)}`, $options: "i" } },
          { nameTokens: { $regex: `^${escaped(term)}`, $options: "i" } },
        ],
      });
    if (after)
      predicates.push({
        $or: [
          { nameKey: { $gt: after.key } },
          { nameKey: after.key, _id: { $gt: new ObjectId(after.id) } },
        ],
      });
    if (predicates.length) filter.$and = predicates;
    return this.db.db
      .collection<Member>("members")
      .find(filter, { session: tx, projection: { fullName: 1, code: 1, nameKey: 1, baptism: 1 } })
      .sort({ nameKey: 1, _id: 1 })
      .limit(limit)
      .toArray();
  }
}
