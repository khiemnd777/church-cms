import { afterAll, beforeAll, expect, test } from "bun:test";
import ExcelJS from "exceljs";
import { ObjectId } from "mongodb";
import { createApp } from "../../api/app";
import { lastSunday } from "../../api/attendance/reporting";
import { config } from "../../api/config";
import { Identity } from "../../api/identity/service";
import { Database, initialize } from "../../api/infrastructure/database";
import { RateLimit } from "../../api/infrastructure/rate-limit";
import { businessDay, shiftDay } from "../../api/members/dates";
import { reportMark, reportMetrics } from "../../api/reporting/contracts";
import {
  SyntheticClient,
  seedP2,
  syntheticChurch,
  syntheticOwner,
  syntheticUser,
} from "../../scripts/p2-fixtures";
import { writeEvidence } from "../evidence";

const conf = {
  ...config(),
  origin: "https://localhost:3516",
  database: `church_cms_test_p62_${crypto.randomUUID().replaceAll("-", "")}`,
  csrfKey: crypto.randomUUID() + crypto.randomUUID(),
};
for (const service of [conf.mongoUrl, conf.redisUrl]) {
  if (!["localhost", "127.0.0.1"].includes(new URL(service).hostname))
    throw Error("Local synthetic only");
}
const db = new Database(conf),
  rate = new RateLimit(conf.redisUrl, conf.csrfKey);
let app: ReturnType<typeof createApp>, owner: SyntheticClient, ownerId: string;
const client = (realm: "owner" | "church") => {
  const ip = crypto.randomUUID();
  return new SyntheticClient(realm, conf.origin, (req) => app(req, { ip }));
};
const base = (id: string, who: SyntheticClient) =>
  `${who.realm === "owner" ? "owner/" : ""}churches/${id}/reports`;
const day = businessDay(),
  start = shiftDay(day, -100);
async function binary(who: SyntheticClient, path: string) {
  return app(new Request(`${conf.origin}/api/v1/${path}`, { headers: { cookie: who.cookie() } }), {
    ip: "p62-file",
  });
}
async function workbook(
  name: string,
  rows: (string | number | { formula: string; result: number })[][],
) {
  const book = new ExcelJS.Workbook(),
    sheet = book.addWorksheet(name);
  for (const row of rows) sheet.addRow(row);
  sheet.getRow(1).font = { bold: true };
  return Buffer.from(await book.xlsx.writeBuffer());
}
async function upload(who: SyntheticClient, id: string, bytes: Uint8Array) {
  const r = await who.call(`${base(id, who)}/templates`, bytes);
  expect(r.status).toBe(201);
  return r.payload.data.id as string;
}
async function activate(who: SyntheticClient, churchId: string, id: string) {
  const path = base(churchId, who),
    v = await who.call(`${path}/list`);
  const state = v.payload.data;
  const version = state.items.find((x: { id: string }) => x.id === id).version;
  return who.call(`${path}/templates/${id}/activate`, {
    activeId: state.activeId,
    selectionVersion: state.selectionVersion,
    version,
  });
}
async function prepare(who: SyntheticClient, id: string, templateId: string, extra = {}) {
  return who.call(`${base(id, who)}/preview`, { templateId, from: start, to: day, ...extra });
}
beforeAll(async () => {
  await db.client.connect();
  await initialize(db.db);
  await rate.connect();
  const auth = new Identity(db, rate, conf);
  await auth.initialize();
  app = createApp(auth, conf, { log: () => {} });
  owner = client("owner");
  ownerId = (await syntheticOwner(db, owner)).id;
});
afterAll(async () => {
  await db.db.dropDatabase();
  expect(
    (await db.client.db("admin").admin().listDatabases()).databases.some(
      (x) => x.name === conf.database,
    ),
  ).toBe(false);
  await db.client.close();
  if (rate.client.isOpen) rate.client.destroy();
});
async function fixture() {
  const church = await syntheticChurch(owner, `Báo cáo synthetic ${crypto.randomUUID()}`);
  const pastor = client("church"),
    secretary = client("church");
  const account = await syntheticUser(owner, pastor, church, "pastor");
  await syntheticUser(owner, secretary, church, "secretary");
  return { church, pastor, secretary, account };
}

test("W18 accepts round-trip starter and custom tenant layouts; invalid upload keeps the active template", async () => {
  const a = await fixture(),
    b = await fixture();
  const pathA = base(a.church.id, a.secretary),
    pathB = base(b.church.id, b.pastor);
  const seed = await binary(a.secretary, `${pathA}/starter`);
  expect(seed.status).toBe(200);
  const bytes = new Uint8Array(await seed.arrayBuffer());
  const first = await upload(a.secretary, a.church.id, bytes);
  expect((await activate(a.secretary, a.church.id, first)).status).toBe(403);
  expect((await activate(a.pastor, a.church.id, first)).status).toBe(200);
  const secondBytes = await workbook("Thống kê khu vực B", [
    ["Hội Thánh tự đặt nhóm"],
    ["Hộ đang sinh hoạt", "{{believer_families}}"],
    ["Tín hữu trẻ", "{{children}}"],
  ]);
  const second = await upload(b.pastor, b.church.id, secondBytes);
  expect((await activate(b.pastor, b.church.id, second)).status).toBe(200);
  expect((await a.secretary.call(`${pathA}/templates/${second}`)).status).toBe(404);
  expect((await a.secretary.call(`${pathB}/list`)).status).toBe(404);
  expect((await owner.call(`${base(b.church.id, owner)}/templates`, secondBytes)).status).toBe(403);
  const invalid = await a.secretary.call(
    `${pathA}/templates`,
    await workbook("Sai", [["Sai", "{{metric_unknown}}"]]),
  );
  expect(invalid.status).toBe(422);
  expect(invalid.payload.error.fieldErrors.B1).toContain("Mã chỉ tiêu");
  const formula = await a.secretary.call(
    `${pathA}/templates`,
    await workbook("Sai", [
      ["Gia đình", "{{believer_families}}"],
      ["Công thức", { formula: "1+1", result: 2 }],
    ]),
  );
  expect(formula.status).toBe(422);
  expect(
    (await a.secretary.call(`${pathA}/templates`, new Uint8Array(512 * 1024 + 1))).status,
  ).toBe(413);
  expect((await a.secretary.call(`${pathA}/list`)).payload.data.activeId).toBe(first);
  const previewA = await prepare(a.secretary, a.church.id, first);
  const previewB = await prepare(b.pastor, b.church.id, second);
  expect(previewA.status).toBe(200);
  expect(previewB.status).toBe(200);
  expect(previewA.payload.data.document.rows.length).toBe(15);
  expect(
    previewB.payload.data.document.rows[1].map((x: { value: string | number }) => x.value),
  ).toEqual(["Hộ đang sinh hoạt", 0]);
}, 30000);

test("report metrics enforce time window, missing source, grouping and closed-Sunday coverage", async () => {
  const { church, pastor } = await fixture(),
    churchId = new ObjectId(church.id);
  expect(
    (
      await pastor.call(`churches/${church.id}/organization/units`, {
        kind: "area",
        name: "Khu vực báo cáo",
      })
    ).status,
  ).toBe(201);
  await seedP2(db, church.id, ownerId, 8);
  const members = db.db.collection("members");
  const persons = await members.find({ churchId }).sort({ _id: 1 }).limit(8).toArray();
  await members.updateMany(
    { churchId },
    {
      $set: {
        type: "believer",
        membership: "member",
        participation: "deceased",
        baptism: { status: "unknown", date: null, place: null },
        visitor: null,
      },
    },
  );
  const change = async (n: number, values: Record<string, unknown>) => {
    await members.updateOne({ _id: persons[n]?._id, churchId }, { $set: values });
  };
  await change(0, {
    participation: "active",
    baptism: { status: "baptized", date: day, place: null },
  });
  await change(1, { participation: "long_absent" });
  await change(2, {
    participation: "active",
    membership: "preparatory",
    visitor: {
      stage: "believed",
      firstVisit: start,
      believedOn: start,
      referrer: null,
      caregiverId: null,
    },
  });
  await change(3, { participation: "active", membership: "child" });
  await change(4, {
    participation: "active",
    type: "visitor",
    membership: null,
    visitor: { stage: "new", firstVisit: day, believedOn: null, referrer: null, caregiverId: null },
  });
  await change(5, { participation: "transferred" });
  const bytes = await workbook(
    "Đủ chỉ tiêu",
    Object.entries(reportMetrics).map(([code]) => [code, `{{${code}}}`]),
  );
  const id = await upload(pastor, church.id, bytes);
  expect((await activate(pastor, church.id, id)).status).toBe(200);
  const small = await prepare(pastor, church.id, id);
  expect(small.status).toBe(200);
  const report = small.payload.data.document;
  const rows = (doc: typeof report) =>
    Object.fromEntries(
      doc.rows.map((r: { value: number | string }[]) => [r[0]?.value, r[1]?.value]),
    );
  expect(rows(report)).toMatchObject({
    baptized_members: 1,
    preparatory_members: 1,
    children: 1,
    visitors: 1,
    believed_visitors: 1,
    believer_families: 1,
    baptisms: 0,
    dedications: 0,
    marriages: 0,
    funerals: 0,
    sunday_average: "—",
    transferred: "—",
  });
  expect(rows(report).areas).toBe(1);
  expect(report.warnings.join(" ")).toContain("Báp-têm chưa rõ: 1");
  expect(report.warnings.join(" ")).toContain("0/4");
  const now = new Date();
  await db.db.collection("attendance_sessions").insertMany(
    [3, 5, 7, 9].map((presentCount, i) => ({
      churchId,
      label: "CN synthetic",
      reportingKind: "sunday_reference",
      heldOn: shiftDay(lastSunday(day), -7 * i),
      location: null,
      scope: "church",
      unitId: null,
      unitName: null,
      state: "closed",
      version: 1,
      generation: 1,
      includedCount: 10,
      rowCount: 10,
      presentCount,
      capturedAt: now,
      createdAt: now,
      updatedAt: now,
    })),
  );
  const after = await prepare(pastor, church.id, id);
  expect(after.status).toBe(200);
  const history = db.db.collection("member_history");
  for (const [n, eventDate, effectiveOn] of [
    [2, day, shiftDay(start, -1)],
    [3, null, start],
    [4, shiftDay(start, -1), day],
  ] as const) {
    await history.insertOne({
      churchId,
      memberId: persons[5]?._id,
      event: "participation_changed",
      effectiveOn,
      eventDate,
      reason: "Fixture chuyển đi",
      actorKind: "owner",
      actorId: new ObjectId(ownerId),
      occurredAt: now,
      version: n,
      before: { participation: "active" },
      after: { participation: "transferred" },
      changedFields: ["participation"],
    });
  }
  const withHistory = await prepare(pastor, church.id, id);
  expect(withHistory.status).toBe(200);
  expect(rows(withHistory.payload.data.document).transferred).toBe(1);
  expect(rows(after.payload.data.document).sunday_average).toBe(6);
  expect(after.payload.data.document.warnings.join(" ")).toContain("4/4");
  const old = await pastor.call(`${base(church.id, pastor)}/issue`, {
    previewId: small.payload.data.id,
    confirm: true,
  });
  expect(old.status).toBe(409);
}, 30000);

test("issue is actor-bound and single-use, replacement preserves both artifact hashes, includes server watermark", async () => {
  const { church, pastor, secretary } = await fixture();
  const path = base(church.id, pastor);
  const first = await upload(
    pastor,
    church.id,
    await workbook("Mẫu của Hội Thánh", [
      ["PHẦN I · THUỘC VIÊN"],
      ["Hộ tín hữu", "{{believer_families}}"],
      ["CN bình quân", "{{sunday_average}}"],
    ]),
  );
  expect((await activate(pastor, church.id, first)).status).toBe(200);
  const prepared = await prepare(pastor, church.id, first);
  expect(prepared.status).toBe(200);
  const issue = { previewId: prepared.payload.data.id, confirm: true },
    keys = [crypto.randomUUID(), crypto.randomUUID()];
  expect((await secretary.call(`${base(church.id, secretary)}/issue`, issue)).status).toBe(409);
  const attempts = await Promise.all([
    ...keys.map((key) => pastor.call(`${path}/issue`, issue, { key })),
  ]);
  expect(attempts.map((x) => x.status).sort()).toEqual([201, 409]);
  const winner = attempts.find((x) => x.status === 201)?.payload.data;
  const oldId = winner.id as string;
  const replay = await pastor.call(`${path}/issue`, issue, {
    key: keys[attempts.findIndex((x) => x.status === 201)],
  });
  expect(replay.status).toBe(200);
  expect(replay.payload.data.id).toBe(oldId);

  const received = await pastor.call(`${path}/operations/${winner.operationId}`);
  expect(received.status).toBe(200);
  expect(received.payload.data.safeResult.id).toBe(oldId);
  const xlsx = await binary(pastor, `${path}/editions/${oldId}/xlsx`),
    pdf = await binary(pastor, `${path}/editions/${oldId}/pdf`);
  expect(xlsx.status).toBe(200);
  expect(pdf.status).toBe(200);
  const xx = new Uint8Array(await xlsx.arrayBuffer()),
    pp = new Uint8Array(await pdf.arrayBuffer());
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(Buffer.from(xx) as never);
  expect(book.worksheets[0]?.getCell("A1").value).toBe(reportMark);
  expect(book.worksheets[0]?.getSheetValues().flat()).toContain("PHẦN I · THUỘC VIÊN");
  expect(book.worksheets[0]?.getSheetValues().flat()).toContain("—");
  expect(Buffer.from(pp).subarray(0, 5).toString()).toBe("%PDF-");
  await writeEvidence("output/p6.2/documents/report.xlsx", xx);
  await writeEvidence("output/p6.2/documents/report.pdf", pp);
  const second = await upload(
    pastor,
    church.id,
    await workbook("Mẫu đổi bố cục", [["Hộ", "{{believer_families}}"]]),
  );
  expect((await activate(pastor, church.id, second)).status).toBe(200);
  const replacement = await prepare(pastor, church.id, second, {
    previousId: oldId,
    reason: "Đổi bố cục báo cáo",
  });
  expect(replacement.status).toBe(200);
  const updated = await pastor.call(`${path}/issue`, {
    previewId: replacement.payload.data.id,
    confirm: true,
  });
  expect(updated.status).toBe(201);
  const old = await pastor.call(`${path}/editions/${oldId}`);
  expect(old.payload.data.supersededBy).toBe(updated.payload.data.id);
  for (const [format, before] of [
    ["pdf", pdf],
    ["xlsx", xlsx],
  ] as const) {
    const again = await binary(pastor, `${path}/editions/${oldId}/${format}`);
    expect(again.headers.get("x-file-digest")).toBe(before.headers.get("x-file-digest"));
    expect(new Uint8Array(await again.arrayBuffer())).toEqual(format === "pdf" ? pp : xx);
  }
}, 30000);

test("activation is compare-and-swap; retirement preserves old files and clears the active choice", async () => {
  const { church, pastor } = await fixture();
  const path = base(church.id, pastor);
  const work = await workbook("Nội bộ", [["Hộ", "{{believer_families}}"]]);
  const a = await upload(pastor, church.id, work),
    b = await upload(pastor, church.id, work);
  const args = { activeId: null, selectionVersion: 0, version: 1 };
  const results = await Promise.all(
    [a, b].map((id) => pastor.call(`${path}/templates/${id}/activate`, args)),
  );
  expect(results.map((x) => x.status).sort()).toEqual([200, 409]);
  const activeId = results.find((x) => x.status === 200)?.payload.data.id as string;
  const preview = await prepare(pastor, church.id, activeId);
  expect(preview.status).toBe(200);
  expect(
    (
      await pastor.call(`${path}/templates/${activeId}/retire`, {
        activeId,
        selectionVersion: 1,
        version: 1,
      })
    ).status,
  ).toBe(200);
  expect((await pastor.call(`${path}/list`)).payload.data.activeId).toBeNull();
  expect(
    (await pastor.call(`${path}/issue`, { previewId: preview.payload.data.id, confirm: true }))
      .status,
  ).toBe(409);
}, 30000);

test("period includes recorded rites at its boundaries, counts the marriage once and reports undated rites", async () => {
  const { church, pastor } = await fixture();
  const path = `owner/churches/${church.id}/rites/records`;
  await seedP2(db, church.id, ownerId, 8);
  const people = await db.db
    .collection("members")
    .find({ churchId: new ObjectId(church.id) })
    .sort({ _id: 1 })
    .toArray();
  const member = (n: number) => ({ source: "member", memberId: people[n]?._id.toHexString() });
  const other = { source: "external", fullName: "Người B synthetic", birthDate: null };
  const facts = [
    {
      payload: { kind: "baptism", person: member(0), officiant: null, place: null },
      date: start,
      state: "recorded",
    },
    {
      payload: {
        kind: "dedication",
        child: member(2),
        parents: [{ role: "guardian", person: other }],
        officiant: null,
        place: null,
      },
      date: day,
      state: "recorded",
    },
    {
      payload: {
        kind: "marriage",
        groom: member(1),
        bride: other,
        officiant: null,
        place: null,
        announcements: [],
      },
      date: day,
      state: "recorded",
    },
    {
      payload: { kind: "funeral", person: member(3), deathOn: null, age: null, place: null },
      date: day,
      state: "recorded",
    },
    {
      payload: { kind: "funeral", person: member(4), deathOn: null, age: null, place: null },
      date: null,
      state: "recorded",
    },
    {
      payload: {
        kind: "dedication",
        child: member(2),
        parents: [{ role: "guardian", person: other }],
        officiant: null,
        place: null,
      },
      date: shiftDay(start, -1),
      state: "recorded",
    },
    {
      payload: {
        kind: "dedication",
        child: member(2),
        parents: [{ role: "guardian", person: other }],
        officiant: null,
        place: null,
      },
      date: day,
      state: "draft",
    },
  ];
  for (const { payload, date, state } of facts) {
    const body = {
      record: { payload, date, historical: true, note: null },
      state,
      reason: null,
      preview: null,
      baptismAfter: payload.kind === "baptism" ? { status: "baptized", date, place: null } : null,
    };
    const p = await owner.call(`${path}/preview`, body);
    expect({ status: p.status, kind: payload.kind, error: p.payload?.error?.code }).toEqual({
      status: 200,
      kind: payload.kind,
      error: undefined,
    });
    expect((await owner.call(path, { ...body, preview: p.payload.data.context })).status).toBe(201);
  }
  const id = await upload(
    pastor,
    church.id,
    await workbook("Báo cáo nhiều trang", [
      ...Array.from({ length: 60 }, (_, i) => [`Nhóm trình bày ${i + 1}`]),
      ["Báp-têm", "{{baptisms}}"],
      ["Dâng con", "{{dedications}}"],
      ["Thành hôn", "{{marriages}}"],
      ["An táng", "{{funerals}}"],
    ]),
  );
  expect((await activate(pastor, church.id, id)).status).toBe(200);
  const p = await prepare(pastor, church.id, id);
  expect(p.status).toBe(200);
  expect(
    p.payload.data.document.rows.slice(-4).map((r: { value: number | string }[]) => r[1]?.value),
  ).toEqual([1, 1, 1, 1]);
  expect(p.payload.data.document.warnings).toContain(
    "An táng: 1 sự kiện thiếu ngày, chưa tính vào kỳ.",
  );
  const issued = await pastor.call(`${base(church.id, pastor)}/issue`, {
    previewId: p.payload.data.id,
    confirm: true,
  });
  expect(issued.status).toBe(201);
  const pdf = await binary(
    pastor,
    `${base(church.id, pastor)}/editions/${issued.payload.data.id}/pdf`,
  );
  expect(pdf.status).toBe(200);
  await writeEvidence("output/p6.2/documents/report-long.pdf", await pdf.arrayBuffer());
}, 30000);
