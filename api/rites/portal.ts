import type { ClientSession, Filter, ObjectId } from "mongodb";
import { objectId } from "../http-validation";
import type { Database } from "../infrastructure/database";
import type { RiteRecord } from "./models";
import type { PersonInput } from "./validation";

export class PortalRites {
  constructor(private db: Database) {}
  async page(
    churchId: ObjectId,
    memberId: ObjectId,
    after: { key: string; id: string } | null,
    limit: number,
    tx: ClientSession,
  ) {
    const id = memberId.toHexString();
    // Require an explicit role in the ritual, never the officiant or an accidental mention in notes.
    const person = (field: string) => ({
      [`${field}.source`]: "member",
      [`${field}.memberId`]: id,
    });
    const primary = "input.payload";
    const roles: Filter<RiteRecord>[] = [
      { kind: { $in: ["baptism", "funeral"] }, ...person(`${primary}.person`) },
      { kind: "dedication", ...person(`${primary}.child`) },
      { kind: "dedication", [`${primary}.parents`]: { $elemMatch: person("person") } },
      { kind: "marriage", ...person(`${primary}.groom`) },
      { kind: "marriage", ...person(`${primary}.bride`) },
    ];
    const clauses: Filter<RiteRecord>[] = [{ $or: roles }];
    if (after)
      clauses.push(
        after.key
          ? {
              $or: [
                { "input.date": { $lt: after.key } },
                { "input.date": after.key, _id: { $lt: objectId(after.id) } },
                { "input.date": null },
              ],
            }
          : { "input.date": null, _id: { $lt: objectId(after.id) } },
      );
    const rows = await this.db.db
      .collection<RiteRecord>("rite_records")
      .find(
        {
          churchId,
          state: "recorded",
          memberIds: memberId,
          $and: clauses,
        },
        {
          session: tx,
          maxTimeMS: 3000,
          projection: {
            _id: 1,
            kind: 1,
            "input.date": 1,
            "input.payload.kind": 1,
            "input.payload.place": 1,
            "input.payload.person": 1,
            "input.payload.child": 1,
            "input.payload.parents": 1,
            "input.payload.groom": 1,
            "input.payload.bride": 1,
          },
        },
      )
      .sort({ "input.date": -1, _id: -1 })
      .limit(limit)
      .toArray();
    const me = (p: PersonInput) => p.source === "member" && p.memberId.toLowerCase() === id;
    return rows.map((row) => {
      const p = row.input.payload;
      const roles =
        p.kind === "baptism"
          ? ["Người chịu Báp-têm"]
          : p.kind === "funeral"
            ? ["Người được ghi nhận"]
            : p.kind === "dedication"
              ? [
                  ...(me(p.child) ? ["Người được dâng"] : []),
                  ...p.parents
                    .filter((parent) => me(parent.person))
                    .map(
                      (parent) =>
                        ({ father: "Cha", mother: "Mẹ", guardian: "Người giám hộ" })[parent.role],
                    ),
                ]
              : p.kind === "marriage"
                ? [me(p.groom) ? "Chú rể" : "Cô dâu"]
                : [];
      return {
        id: row._id.toHexString(),
        kind: row.kind,
        date: row.input.date,
        place: p.place,
        roles: [...new Set(roles)],
      };
    });
  }
}
