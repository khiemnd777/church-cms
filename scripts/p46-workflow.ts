import { ObjectId } from "mongodb";
import { lastSunday } from "../api/attendance/reporting";
import type { Database } from "../api/infrastructure/database";
import { businessDay, shiftDay } from "../api/members/dates";
import { canonical } from "../api/operations/service";
import type { ProgramRow } from "../api/programs/validation";
import { check, type SyntheticClient, syntheticUser } from "./p2-fixtures";
import { p36Session } from "./p36-fixtures";
import { p42Fixture, p42Save, p42Schedule, programCommand, programRoot } from "./p42-fixtures";
import {
  careRecord,
  careSave,
  careCommon as visitCommon,
  careRoot as visitRoot,
} from "./p43-fixtures";
import { prayerCommon, prayerCreate, prayerRoot, prayerSave } from "./p44-fixtures";
import {
  alertSave,
  careDecision,
  careOpenAlert,
  careRoot,
  careScan,
  signalCreate,
  signalSave,
} from "./p45-fixtures";

export type P46Fixture = Awaited<ReturnType<typeof p42Fixture>>;
export type P46Assert = (condition: unknown, label: string) => void;
export const p46Base = (c: { id: string }, s: SyntheticClient) =>
  `${s.realm === "owner" ? "owner/" : ""}churches/${c.id}`;

export async function p46Retry<T extends { status: number }>(call: () => Promise<T>) {
  for (let attempt = 0; attempt < 32; attempt++) {
    const r = await call();
    if (![409, 412].includes(r.status)) return r;
    await Bun.sleep(Math.min(500, 25 * 2 ** Math.min(attempt, 4)) * (0.5 + Math.random()));
  }
  throw new Error("P46 bounded re-read/re-preview retry exhausted");
}

export async function p46Program(
  s: SyntheticClient,
  c: P46Fixture,
  occurrence: string,
  assert: P46Assert,
) {
  const root = programRoot(c, s),
    made = await p46Retry(() =>
      p42Save(s, c, programCommand("create", { unitId: c.unit, occurrenceId: occurrence })),
    );
  assert(made.status === 201, "program-root-created");
  const id = made.payload.data.programId as string;
  let d = (await s.call(`${root}/drafts/${id}`)).payload.data;
  const rows: ProgramRow[] = structuredClone(d.rows);
  check(rows[0], "program first row");
  rows[0].title = "Tiết mục sửa tay P4.6 synthetic";
  const saved = await p46Retry(async () =>
    p42Save(
      s,
      c,
      programCommand("save", { rows }),
      id,
      (await s.call(`${root}/drafts/${id}`)).payload.data.version,
    ),
  );
  assert(saved.status === 200, "program-manual-save");
  d = (await s.call(`${root}/drafts/${id}`)).payload.data;
  const finalized = await p46Retry(async () =>
    p42Save(
      s,
      c,
      programCommand("finalize", { incompleteConfirmed: true }),
      id,
      (await s.call(`${root}/drafts/${id}`)).payload.data.version,
    ),
  );
  assert(finalized.status === 200, "program-finalized");
  d = (await s.call(`${root}/drafts/${id}`)).payload.data;
  const editions = await s.call(`${root}/drafts/${id}/editions`),
    print = await s.call(`${root}/drafts/${id}/print?version=1&revision=1`);
  assert(
    editions.status === 200 &&
      editions.payload.data.items.length === 1 &&
      print.status === 200 &&
      print.text?.includes(rows[0].title),
    "immutable-edition-and-authenticated-print",
  );
  return {
    id,
    version: d.version as number,
    edition: editions.payload.data.items[0],
    html: print.text as string,
  };
}

export async function p46Visit(
  s: SyntheticClient,
  c: P46Fixture,
  alertId: string,
  participant: string,
  assert: P46Assert,
) {
  let a = (await s.call(`${careRoot(c, s)}/${alertId}`)).payload.data;
  const b = careDecision(a.existing);
  if (b.action === "convert") b.fields.assigneeId = participant;
  const converted = await p46Retry(async () => {
    a = (await s.call(`${careRoot(c, s)}/${alertId}`)).payload.data;
    return alertSave(s, c, alertId, a.record.version, b);
  });
  assert(converted.status === 200, "care-confirmed-create-or-link");
  const id = converted.payload.data.caseId as string,
    root = `${visitRoot(c, s)}/cases/${id}`;
  let d = (await s.call(root)).payload.data;
  assert(d.state === "open" && d.visitedCount === 0, "conversion-never-records-visited");
  const recorded = await p46Retry(async () =>
    careSave(
      s,
      c,
      { ...careRecord([participant]), confirmed: true },
      id,
      (await s.call(root)).payload.data.version,
    ),
  );
  assert(recorded.status === 200, "visit-explicit-entry");
  d = (await s.call(root)).payload.data;
  const completed = await p46Retry(async () =>
    careSave(
      s,
      c,
      {
        action: "complete",
        ...visitCommon,
        confirmed: true,
        reason: "Hoàn tất sau lần thăm synthetic",
      },
      id,
      (await s.call(root)).payload.data.version,
    ),
  );
  assert(completed.status === 200, "visit-explicit-completion");
  d = (await s.call(root)).payload.data;
  assert(d.state === "completed" && d.visitedCount === 1, "visit-terminal-state");
  return {
    id,
    alertId,
    version: d.version as number,
    operationId: converted.payload.data.operationId as string,
    key: converted.key,
    intent: converted.intent,
    alertVersion: a.record.version as number,
    mode: b.action === "convert" ? b.mode : null,
  };
}

export async function p46Prayer(s: SyntheticClient, c: P46Fixture, assert: P46Assert) {
  const made = await p46Retry(() => prayerSave(s, c, prayerCreate("shared")));
  assert(made.status === 201, "prayer-created");
  const id = made.payload.data.prayerId as string;
  const closed = await p46Retry(() =>
    prayerSave(
      s,
      c,
      {
        action: "close",
        ...prayerCommon,
        confirmed: true,
        reason: "Kết thúc lời cầu thay synthetic",
      },
      id,
      1,
    ),
  );
  assert(closed.status === 200, "prayer-explicitly-closed");
  return { id };
}

export async function p46Workflow(
  db: Database,
  owner: SyntheticClient,
  actorId: string,
  client: (realm: "owner" | "church") => SyntheticClient,
  assert: P46Assert,
) {
  const c = await p42Fixture(db, owner, actorId, 12),
    other = await p42Fixture(db, owner, actorId, 4),
    pastor = client("church"),
    secretary = client("church");
  const pastorAccount = await syntheticUser(owner, pastor, c, "pastor"),
    secretaryAccount = await syntheticUser(owner, secretary, c, "secretary");
  const target = c.people[0]?._id.toHexString(),
    assignee = c.people[1]?._id.toHexString();
  check(target && assignee, "cross-workflow people");
  const churchId = new ObjectId(c.id),
    count = (name: string) => db.db.collection(name).countDocuments({ churchId });
  assert(
    (await count("attendance_sessions")) === 0 && (await count("rite_records")) === 0,
    "planned-schedule-does-not-create-attendance-or-rites",
  );
  // A bounded repeated series and a single exception remain distinct from its program editions.
  const day = shiftDay(c.day, 7),
    recurring = {
      ...c.schedule,
      input: {
        ...c.schedule.input,
        day,
        endDay: day,
        repeat: {
          kind: "weekly" as const,
          interval: 1,
          weekdays: [new Date(day).getUTCDay()],
          until: shiftDay(day, 14),
        },
      },
    };
  const repeated = await p42Schedule(owner, c, recurring);
  const occurrence = (await owner.call(`${p46Base(c, owner)}/scheduling/occurrences/${repeated}`))
    .payload.data;
  await p42Schedule(
    owner,
    c,
    {
      ...recurring,
      input: { ...occurrence.input, theme: "Ngoại lệ synthetic" },
      range: "one",
      reason: "Ngoại lệ một buổi",
    },
    repeated,
    occurrence.version,
  );
  const exception = (await owner.call(`${p46Base(c, owner)}/scheduling/occurrences/${repeated}`))
    .payload.data;
  assert(exception.exception === true, "recurring-single-exception");
  const program = await p46Program(secretary, c, c.occurrence, assert);
  const original = canonical(program.edition);
  await p42Schedule(
    owner,
    c,
    {
      ...c.schedule,
      input: { ...c.schedule.input, theme: "Nguồn sau chốt" },
      reason: "Đổi nguồn sau chốt",
    },
    c.occurrence,
    1,
  );
  assert(
    canonical(
      (await secretary.call(`${programRoot(c, secretary)}/drafts/${program.id}/editions`)).payload
        .data.items[0],
    ) === original,
    "source-change-does-not-rewrite-edition",
  );
  let draft = (await secretary.call(`${programRoot(c, secretary)}/drafts/${program.id}`)).payload
    .data;
  assert(
    (
      await p42Save(
        secretary,
        c,
        programCommand("amend", { reason: "Cập nhật bản mới" }),
        program.id,
        draft.version,
      )
    ).status === 200,
    "explicit-amend",
  );
  draft = (await secretary.call(`${programRoot(c, secretary)}/drafts/${program.id}`)).payload.data;
  assert(
    (await p42Save(secretary, c, programCommand("regenerate"), program.id, draft.version))
      .status === 200,
    "explicit-regenerate-after-source-drift",
  );
  draft = (await secretary.call(`${programRoot(c, secretary)}/drafts/${program.id}`)).payload.data;
  assert(draft.rows[0].title === "Tiết mục sửa tay P4.6 synthetic", "merge-preserves-manual-edit");
  const sunday = lastSunday(businessDay());
  for (const days of [-14, -7, 0])
    await p36Session(
      owner,
      c.id,
      shiftDay(sunday, days),
      { reportingKind: "sunday_reference" },
      [],
      true,
    );
  await careScan(secretary, c);
  const absent = await careOpenAlert(db, c, target, "absence");
  assert(
    absent.evidence.filter((e) => e.type === "attendance").length === 3,
    "care-absence-exact-three-calendar-sundays",
  );
  const visit = await p46Visit(secretary, c, absent.id, assignee, assert);
  const entries = (await secretary.call(`${visitRoot(c, secretary)}/cases/${visit.id}/entries`))
    .payload.data.items;
  const entry = entries[0];
  check(entry, "visit entry");
  const correction = await careSave(
    secretary,
    c,
    {
      action: "correct",
      entryId: entry.id,
      entryVersion: entry.version,
      entry: {
        visitedOn: entry.visitedOn,
        participantIds: entry.participantIds,
        outcome: "visited",
        note: "Đính chính sau đóng synthetic",
      },
      ...visitCommon,
      confirmed: true,
      reason: "Đính chính ghi chú",
    },
    visit.id,
    visit.version,
  );
  assert(correction.status === 200, "closed-visit-correction-preserves-history");
  const replay = await secretary.call(`${careRoot(c, secretary)}/${absent.id}`, visit.intent, {
    method: "PATCH",
    key: visit.key,
    version: visit.alertVersion,
  });
  assert(
    replay.status === 200 && replay.payload.meta.replayed === true,
    "same-actor-replay-after-cross-domain-completion",
  );
  assert(
    (await secretary.call(`${careRoot(c, secretary)}/operations/${visit.operationId}`)).status ===
      200,
    "care-receipt-after-case-completed",
  );
  assert(
    (await db.db
      .collection("visitation_cases")
      .countDocuments({ churchId, targetId: new ObjectId(target), reasonCode: "absence" })) === 1,
    "one-cross-domain-case",
  );
  const beforePrayer = await count("care_alerts"),
    privatePrayer = await prayerSave(
      pastor,
      c,
      prayerCreate("pastoral", { content: "Marker riêng tư P46 synthetic" }),
    );
  assert(privatePrayer.status === 201, "pastoral-prayer-created");
  await p46Prayer(secretary, c, assert);
  assert((await count("care_alerts")) === beforePrayer, "prayer-does-not-feed-care");
  for (const s of [owner, secretary]) {
    for (const suffix of ["", "/history"])
      assert(
        (await s.call(`${prayerRoot(c, s)}/${privatePrayer.payload.data.prayerId}${suffix}`))
          .status === 404,
        "pastoral-hidden-from-owner-secretary",
      );
    const listed = await s.call(`${prayerRoot(c, s)}?q=Marker`);
    assert(
      listed.status === 200 &&
        listed.payload.data.items.length === 0 &&
        !canonical(listed.payload).includes(privatePrayer.payload.data.prayerId),
      "private-filter-count-does-not-leak",
    );
  }
  for (const role of ["ministry_lead", "treasurer", "member"]) {
    const s = client("church");
    await syntheticUser(owner, s, c, role, role === "ministry_lead" ? [c.unit] : []);
    for (const endpoint of [careRoot(c, s), `${visitRoot(c, s)}/cases`, prayerRoot(c, s)])
      assert((await s.call(endpoint)).status === 403, `deny-${role}-care-boundary`);
    if (role === "ministry_lead") {
      assert(
        (await s.call(`${programRoot(c, s)}/drafts/${program.id}`)).status === 200,
        "lead-own-unit-program",
      );
      assert(
        (await s.call(`${p46Base(c, s)}/scheduling/occurrences/preview`, c.schedule)).status ===
          403,
        "lead-no-schedule-write",
      );
    }
  }
  assert(
    (await secretary.call(`${careRoot(other, secretary)}/${absent.id}`)).status === 404,
    "cross-tenant-care-hidden",
  );
  const signal = await signalSave(secretary, c, signalCreate(assignee));
  assert(signal.status === 201, "manual-source-creates-care-independent-of-prayer");
  const cursor = (await secretary.call(`${careRoot(c, secretary)}?limit=1`)).payload.data
    .nextCursor;
  check(cursor, "pre-recovery cursor");
  // The current same-account role policy is rechecked even when the original operation completed.
  await db.db
    .collection("accounts")
    .updateOne(
      { _id: new ObjectId(pastorAccount.id) },
      { $set: { role: "secretary" }, $inc: { version: 1 } },
    );
  assert(
    (
      await pastor.call(
        `${prayerRoot(c, pastor)}/operations/${privatePrayer.payload.data.operationId}`,
      )
    ).status === 404,
    "downgraded-private-receipt-hidden",
  );
  assert(
    (await pastor.call(prayerRoot(c, pastor), privatePrayer.intent, { key: privatePrayer.key }))
      .status === 404,
    "downgraded-private-create-replay-hidden",
  );
  await db.db
    .collection("accounts")
    .updateOne(
      { _id: new ObjectId(pastorAccount.id) },
      { $set: { role: "pastor" }, $inc: { version: 1 } },
    );
  program.html = (
    await secretary.call(
      `${programRoot(c, secretary)}/drafts/${program.id}/print?version=1&revision=1`,
    )
  ).text as string;
  return {
    c,
    other,
    program,
    visit,
    signal,
    privatePrayer,
    secretary,
    secretaryAccount,
    pastor,
    pastorAccount,
    target,
    assignee,
    cursor,
  };
}
