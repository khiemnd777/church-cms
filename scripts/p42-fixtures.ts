import { ObjectId } from "mongodb";
import type { Database } from "../api/infrastructure/database";
import { businessDay, shiftDay } from "../api/members/dates";
import type { ProgramCommand } from "../api/programs/validation";
import type { ScheduleCommand } from "../api/scheduling/validation";
import { check, type SyntheticClient, seedP2, syntheticChurch } from "./p2-fixtures";
export const programCommand = (
  action: ProgramCommand["action"],
  extra: Partial<ProgramCommand> = {},
): ProgramCommand => ({
  action,
  unitId: null,
  occurrenceId: null,
  rows: null,
  reason: null,
  preview: null,
  incompleteConfirmed: false,
  ...extra,
});
export const programRoot = (c: { id: string }, s: SyntheticClient) =>
  `${s.realm === "owner" ? "owner/" : ""}churches/${c.id}/programs`;
export async function p42Fixture(db: Database, owner: SyntheticClient, ownerId: string, count = 8) {
  const c = await syntheticChurch(owner, `Chương trình synthetic ${crypto.randomUUID()}`);
  await seedP2(db, c.id, ownerId, count);
  const made = await owner.call(`owner/churches/${c.id}/organization/units`, {
    kind: "service_ministry",
    name: "Ban chương trình synthetic",
  });
  check(made.status === 201, "fixture unit");
  const unit = made.payload.data.unit.id as string;
  // Explicit local volume/roster fixture, not a claim about public membership commands.
  await db.db
    .collection("members")
    .updateMany(
      { churchId: new ObjectId(c.id) },
      { $addToSet: { "assignment.unitIds": new ObjectId(unit) } },
    );
  const people = await db.db
    .collection("members")
    .find({ churchId: new ObjectId(c.id), participation: { $in: ["active", "long_absent"] } })
    .sort({ nameKey: 1, _id: 1 })
    .toArray();
  const day = shiftDay(businessDay(), 30);
  const schedule: ScheduleCommand = {
    input: {
      label: "Sinh hoạt ban synthetic",
      kind: "activity",
      scope: "unit",
      unitId: unit,
      day,
      startTime: "14:00",
      endDay: day,
      endTime: "15:30",
      location: "Phòng synthetic",
      scripture: "Giăng 15",
      theme: "Đề tài synthetic",
      speaker: { source: "member", memberId: people[0]?._id.toHexString() as string },
      leaderId: null,
      choirId: null,
      communion: false,
      repeat: { kind: "once" },
    },
    state: "scheduled",
    range: "one",
    reason: null,
    preview: null,
    conflictsConfirmed: false,
    exceptionsConfirmed: false,
  };
  const occurrence = await p42Schedule(owner, c, schedule);
  return { ...c, unit, people, day, schedule, occurrence };
}
export async function p42Schedule(
  owner: SyntheticClient,
  c: { id: string },
  b: ScheduleCommand,
  id?: string,
  v?: number,
) {
  const p = `owner/churches/${c.id}/scheduling/occurrences${id ? `/${id}` : ""}`;
  const preview = await owner.call(`${p}/preview`, b, { version: v });
  check(preview.status === 200, `fixture schedule preview ${preview.status}`);
  const r = await owner.call(
    p,
    { ...b, preview: preview.payload.data.context },
    { version: v, method: id ? "PATCH" : "POST" },
  );
  check([200, 201].includes(r.status), `fixture schedule ${r.status}`);
  return r.payload.data.occurrenceId as string;
}
export async function p42Save(
  s: SyntheticClient,
  c: { id: string },
  b: ProgramCommand,
  id?: string,
  v?: number,
  key = crypto.randomUUID(),
) {
  const p = `${programRoot(c, s)}/drafts${id ? `/${id}` : ""}`;
  const preview = await s.call(`${p}/preview`, b, { version: v });
  check(
    preview.status === 200,
    `program preview ${preview.status} ${preview.payload.error?.code ?? ""}`,
  );
  const intent = { ...b, preview: preview.payload.data.context };
  const r = await s.call(p, intent, { version: v, method: id ? "PATCH" : "POST", key });
  return { ...r, intent, key, preview: preview.payload.data };
}
