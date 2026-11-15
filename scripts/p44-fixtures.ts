import { ObjectId } from "mongodb";
import type { Database } from "../api/infrastructure/database";
import { businessDay } from "../api/members/dates";
import type { PrayerCommand, PrayerFields } from "../api/prayers/validation";
import { check, type SyntheticClient, seedP2, syntheticChurch } from "./p2-fixtures";
export const prayerRoot = (c: { id: string }, s: SyntheticClient) =>
  `${s.realm === "owner" ? "owner/" : ""}churches/${c.id}/care/prayers`;
export const prayerCommon = { reason: null, preview: null, confirmed: false };
export const prayerCreate = (
  visibility: "shared" | "pastoral" = "shared",
  fields: Partial<PrayerFields> = {},
): PrayerCommand => ({
  action: "create",
  visibility,
  fields: {
    content: "Lời cầu thay synthetic",
    category: "other",
    receivedOn: businessDay(),
    requester: { kind: "none" },
    ...fields,
  },
  ...prayerCommon,
});
export const prayerEdit = (
  p: PrayerFields,
  fields: Partial<PrayerFields> = {},
  action: "update" | "correct" = "update",
): Extract<PrayerCommand, { action: "update" | "correct" }> => ({
  action,
  fields: {
    content: p.content,
    category: p.category,
    receivedOn: p.receivedOn,
    requester: p.requester,
    ...fields,
  },
  ...prayerCommon,
  reason: "Đính chính synthetic",
});
export async function p44Fixture(
  db: Database,
  owner: SyntheticClient,
  actorId: string,
  count = 12,
) {
  const c = await syntheticChurch(owner, `Cầu thay synthetic ${crypto.randomUUID()}`);
  await seedP2(db, c.id, actorId, count);
  const people = await db.db
    .collection("members")
    .find({ churchId: new ObjectId(c.id), participation: { $in: ["active", "long_absent"] } })
    .sort({ nameKey: 1, _id: 1 })
    .toArray();
  return { ...c, people };
}
export async function prayerSave(
  s: SyntheticClient,
  c: { id: string },
  b: PrayerCommand,
  id?: string,
  version?: number,
  key = crypto.randomUUID(),
) {
  const path = `${prayerRoot(c, s)}${id ? `/${id}` : ""}`,
    p = await s.call(`${path}/preview`, b, { version });
  check(p.status === 200, `prayer preview ${p.status} ${p.payload.error?.code ?? ""}`);
  const intent = { ...b, preview: p.payload.data.context, confirmed: true };
  return {
    ...(await s.call(path, intent, { method: id ? "PATCH" : "POST", version, key })),
    key,
    intent,
    preview: p.payload.data,
  };
}
