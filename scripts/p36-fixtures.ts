import { ObjectId } from "mongodb";
import { lastSunday } from "../api/attendance/reporting";
import type { Database } from "../api/infrastructure/database";
import { businessDay, shiftDay } from "../api/members/dates";
import type { SyntheticClient } from "./p2-fixtures";
import { check, seedP2 } from "./p2-fixtures";
export async function p36Session(
  owner: SyntheticClient,
  churchId: string,
  heldOn: string,
  extra: object = {},
  presentIds: string[] = [],
  close = true,
) {
  const base = `${owner.realm === "owner" ? "owner/" : ""}churches/${churchId}/attendance/sessions`;
  const made = await owner.call(base, {
    label: "Buổi tham chiếu synthetic",
    heldOn,
    location: null,
    scope: "church",
    unitId: null,
    ...extra,
  });
  check(made.status === 201, `P36 create ${made.status} ${made.payload?.error?.code ?? ""}`);
  const id = made.payload.data.sessionId as string;
  const preview = await owner.call(`${base}/${id}/candidates`);
  check(preview.status === 200, "P36 candidates");
  check(
    (
      await owner.call(
        `${base}/${id}/open`,
        { previewToken: preview.payload.data.previewToken },
        { version: 1 },
      )
    ).status === 200,
    "P36 open",
  );
  const roster = await owner.call(`${base}/${id}/participants?limit=100`);
  check(roster.status === 200, "P36 roster");
  for (const memberId of presentIds) {
    const r = await owner.call(
      `${base}/${id}/participants/${memberId}`,
      { present: true, generation: roster.payload.data.session.generation },
      { method: "PATCH", version: 1 },
    );
    check(r.status === 200, `P36 mark ${r.status}`);
  }
  if (close) {
    const s = (await owner.call(`${base}/${id}`)).payload.data;
    check(
      (await owner.call(`${base}/${id}/close`, {}, { version: s.version })).status === 200,
      "P36 close",
    );
  }
  return { id, roster: roster.payload.data.items as { memberId: string; version: number }[] };
}
export async function seedP36(
  db: Database,
  owner: SyntheticClient,
  c: { id: string },
  actorId: string,
  count = 6,
  dates = 4,
) {
  const seed = await seedP2(db, c.id, actorId, count);
  await db.db
    .collection("members")
    .updateMany({ churchId: new ObjectId(c.id) }, { $set: { participation: "active" } });
  const rows = await db.db
      .collection("members")
      .find({ churchId: new ObjectId(c.id) })
      .sort({ _id: 1 })
      .toArray(),
    until = lastSunday(businessDay()),
    sessions = [];
  for (let i = dates - 1; i >= 0; i--)
    sessions.push(
      await p36Session(
        owner,
        c.id,
        shiftDay(until, -7 * i),
        { reportingKind: "sunday_reference" },
        rows.slice(0, Math.floor(count / 2)).map((m) => m._id.toHexString()),
      ),
    );
  return { ...seed, rows, until, sessions };
}
