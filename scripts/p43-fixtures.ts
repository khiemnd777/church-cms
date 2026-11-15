import { ObjectId } from "mongodb";
import type { Database } from "../api/infrastructure/database";
import { businessDay } from "../api/members/dates";
import type {
  VisitCommand,
  VisitEntryInput,
  VisitFields,
  VisitTarget,
} from "../api/visitation/validation";
import { check, type SyntheticClient, seedP2, syntheticChurch } from "./p2-fixtures";
export const careRoot = (c: { id: string }, s: SyntheticClient) =>
  `${s.realm === "owner" ? "owner/" : ""}churches/${c.id}/care`;
export const careCommon = { reason: null, preview: null, confirmed: false };
export const careCreate = (
  target: VisitTarget,
  fields: Partial<VisitFields> = {},
): VisitCommand => ({
  action: "create",
  target,
  fields: {
    reasonCode: "other",
    description: "Thăm viếng synthetic",
    priority: "normal",
    plannedOn: null,
    assigneeId: null,
    ...fields,
  },
  ...careCommon,
});
export const careRecord = (
  participants: string[],
  data: Partial<VisitEntryInput> = {},
): VisitCommand => ({
  action: "record",
  entry: {
    visitedOn: businessDay(),
    participantIds: participants,
    outcome: "visited",
    note: "Kết quả synthetic",
    ...data,
  },
  ...careCommon,
});
export const careUpdate = (d: VisitFields, fields: Partial<VisitFields> = {}): VisitCommand => ({
  action: "update",
  fields: {
    reasonCode: d.reasonCode,
    description: d.description,
    priority: d.priority,
    plannedOn: d.plannedOn,
    assigneeId: d.assigneeId,
    ...fields,
  },
  ...careCommon,
});
export async function p43Fixture(
  db: Database,
  owner: SyntheticClient,
  actorId: string,
  count = 12,
) {
  const c = await syntheticChurch(owner, `Thăm viếng synthetic ${crypto.randomUUID()}`);
  await seedP2(db, c.id, actorId, count);
  const people = await db.db
      .collection("members")
      .find({ churchId: new ObjectId(c.id), participation: { $in: ["active", "long_absent"] } })
      .sort({ nameKey: 1, _id: 1 })
      .toArray(),
    families = await db.db
      .collection("families")
      .find({ churchId: new ObjectId(c.id), status: "active" })
      .sort({ code: 1, _id: 1 })
      .toArray();
  check(people.length > 0 && families.length > 0, "Fixture source");
  return {
    ...c,
    people,
    families,
    target: { kind: "member" as const, id: people[0]?._id.toHexString() as string },
  };
}
export async function careSave(
  s: SyntheticClient,
  c: { id: string },
  b: VisitCommand,
  id?: string,
  v?: number,
  key = crypto.randomUUID(),
) {
  const path = `${careRoot(c, s)}/cases${id ? `/${id}` : ""}`,
    p = await s.call(`${path}/preview`, b, { version: v });
  check(p.status === 200, `care preview ${p.status} ${p.payload.error?.code ?? ""}`);
  const intent = { ...b, preview: p.payload.data.context };
  return {
    ...(await s.call(path, intent, { method: id ? "PATCH" : "POST", version: v, key })),
    key,
    intent,
    preview: p.payload.data,
  };
}
