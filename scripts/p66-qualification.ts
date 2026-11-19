import { createHash } from "node:crypto";
import { closeSync, openSync } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import ExcelJS from "exceljs";
import { strFromU8, unzipSync } from "fflate";
import { ObjectId } from "mongodb";
import { createApp } from "../api/app";
import { config } from "../api/config";
import { Identity } from "../api/identity/service";
import { Database, initialize } from "../api/infrastructure/database";
import { RateLimit } from "../api/infrastructure/rate-limit";
import { businessDay, shiftDay } from "../api/members/dates";
import { canonical } from "../api/operations/service";
import { type ReportDocument, reportMark, reportMetrics } from "../api/reporting/contracts";
import {
  check,
  localOnly,
  SyntheticClient,
  seedP2,
  syntheticChurch,
  syntheticOwner,
  syntheticUser,
} from "./p2-fixtures";
import { certificateFixture, createCertificateRite } from "./p35-fixtures";
import { p46Fingerprint } from "./p46-recovery";

const outputRoot = resolve("output/p6.6");
const out = resolve(process.env.CHURCH_EVIDENCE_DIR ?? join(outputRoot, "qualification"));
check(out.startsWith(outputRoot + sep), "Use a new evidence folder inside output/p6.6");
await mkdir(outputRoot, { recursive: true });
await mkdir(out);
const uuid = () => crypto.randomUUID().replaceAll("-", "");
const conf = {
  ...config(),
  database: `church_cms_test_p66_source_${uuid()}`,
  origin: "https://localhost:3519",
  csrfKey: uuid() + uuid(),
};
localOnly(conf);
const source = new Database(conf),
  target = new Database({ ...conf, database: `church_cms_test_p66_target_${uuid()}` });
const privateDir = await mkdtemp(join(tmpdir(), "church-p66-"));
const archive = join(privateDir, "p66.gz");
const checks: string[] = [];
const rates: RateLimit[] = [];
const connected: Database[] = [];
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
function assert(v: unknown, label: string): asserts v {
  check(v, label);
  checks.push(label);
}
function status(
  reply: Awaited<ReturnType<SyntheticClient["call"]>>,
  expected: number,
  label: string,
) {
  assert(
    reply.status === expected,
    `${label} [${reply.status}${reply.payload?.error?.code ? ` ${reply.payload.error.code}` : ""}]`,
  );
  return reply.payload?.data;
}
async function runtime(database: Database, local = conf) {
  const rate = new RateLimit(local.redisUrl, local.csrfKey);
  rates.push(rate);
  await rate.connect();
  const auth = new Identity(database, rate, local);
  await auth.initialize();
  const app = createApp(auth, local, { log: () => {} });
  const client = (realm: "owner" | "church" = "church") => {
    const ip = crypto.randomUUID();
    return new SyntheticClient(realm, local.origin, (req) => app(req, { ip }));
  };
  const raw = (who: SyntheticClient, path: string) =>
    app(new Request(`${local.origin}/api/v1/${path}`, { headers: { cookie: who.cookie() } }), {
      ip: "p66-files",
    });
  return { client, raw };
}
type Runtime = Awaited<ReturnType<typeof runtime>>;
type Artifact = { name: string; path: string; sha256: string; size: number };
async function file(run: Runtime, who: SyntheticClient, path: string, name: string) {
  const response = await run.raw(who, path);
  assert(response.status === 200, `Download ${name}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const sha256 = hash(bytes);
  const header = response.headers.get("x-file-digest");
  if (header) assert(header === sha256, `File digest ${name}`);
  return { artifact: { name, path, sha256, size: bytes.length }, bytes };
}
function mongoTool(args: string[], archiveFd: number, read: boolean) {
  const command = ["docker", "compose", "exec", "-T", "mongo", ...args];
  return read
    ? Bun.spawnSync(command, {
        stdin: archiveFd,
        stdout: "ignore",
        stderr: "pipe",
        timeout: 60_000,
      })
    : Bun.spawnSync(command, { stdout: archiveFd, stderr: "pipe", timeout: 60_000 });
}
async function measureReads(sources: { name: string; access: () => Promise<number> }[]) {
  const result = [];
  for (const workers of [1, 5, 10]) {
    const measurements: { name: string; ms: number; status: number }[] = [];
    await Promise.all(
      Array.from({ length: workers }, async () => {
        for (let round = 0; round < 3; round++) {
          for (const { name, access } of sources) {
            const start = performance.now();
            const response = await access();
            measurements.push({
              name,
              ms: Number((performance.now() - start).toFixed(2)),
              status: response,
            });
          }
        }
      }),
    );
    assert(
      measurements.every((m) => m.status === 200),
      `Mixed read workload ${workers} workers`,
    );
    const byRoute = sources.map(({ name }) => {
      const ms = measurements
        .filter((x) => x.name === name)
        .map((x) => x.ms)
        .sort((a, b) => a - b);
      return {
        name,
        samples: ms.length,
        medianMs: ms[Math.floor((ms.length - 1) * 0.5)],
        p95Ms: ms[Math.floor((ms.length - 1) * 0.95)],
        maxMs: ms.at(-1),
      };
    });
    result.push({ workers, requests: measurements.length, byRoute, measurements });
  }
  return result;
}

try {
  await source.client.connect();
  connected.push(source);
  await initialize(source.db);
  const run = await runtime(source);
  const owner = run.client("owner"),
    pastor = run.client(),
    treasurer = run.client(),
    member = run.client(),
    outsider = run.client();
  const actor = await syntheticOwner(source, owner);
  const a = await syntheticChurch(owner, "Hội Thánh P66 synthetic A");
  const b = await syntheticChurch(owner, "Hội Thánh P66 synthetic B");
  const pastorAccount = await syntheticUser(owner, pastor, a, "pastor");
  const treasurerAccount = await syntheticUser(owner, treasurer, a, "treasurer");
  const memberAccount = await syntheticUser(owner, member, a, "member");
  const outsiderAccount = await syntheticUser(owner, outsider, b, "pastor");
  const fixtures = await seedP2(source, a.id, actor.id, 8);
  const person = fixtures.members[2],
    other = fixtures.members[4];
  assert(person && other, "Deterministic personal fixture");
  const church = `churches/${a.id}`,
    admin = `owner/${church}`,
    portal = `${church}/portal`;
  const finance = `${church}/finance`,
    reports = `${church}/reports`,
    cert = `${church}/certificates`;
  const acct = `${admin}/accounts/${memberAccount.id}`;
  const day = businessDay(),
    from = shiftDay(day, -100);
  const rite = await createCertificateRite(owner, a.id, person._id.toHexString(), "baptism");
  assert(!!rite, "Recorded baptism linked to the certificate and portal member");
  const option = status(
    await owner.call(`${acct}/subject-options?q=${person.code}`),
    200,
    "Find eligible member",
  ).items[0];
  const accountVersion = status(
    await owner.call(acct),
    200,
    "Resolve member account version",
  ).version;
  status(
    await owner.call(
      `${acct}/subject`,
      {
        memberId: option.id,
        memberVersion: option.version,
        reason: "Đối chiếu synthetic",
        confirm: true,
      },
      { method: "PATCH", version: accountVersion },
    ),
    200,
    "Owner links account",
  );
  status(await member.call(`${portal}/profile`), 401, "Old session after link");
  status(
    await member.login(memberAccount.email, memberAccount.password, a.code),
    200,
    "Fresh member login",
  );
  assert(
    status(await member.call(`${portal}/profile`), 200, "Read self profile").profile.code ===
      person.code,
    "Profile matches the linked member",
  );
  const rites = status(await member.call(`${portal}/rites`), 200, "Read self rites").items;
  assert(
    rites.length === 1 && rites[0].kind === "baptism" && !("participants" in rites[0]),
    "Only recorded personal rite projection",
  );

  const fundId = status(
    await pastor.call(`${finance}/funds`, { name: "Quỹ synthetic P66" }),
    201,
    "Create synthetic fund",
  ).fundId;
  async function code(id: ObjectId) {
    return status(
      await treasurer.call(`${finance}/giving-codes`, { memberId: id.toHexString() }),
      201,
      "Issue synthetic giving code",
    ).givingId;
  }
  function payment(values: object) {
    return {
      submissionId: crypto.randomUUID(),
      businessDate: day,
      fundId,
      sourceReference: `P66-${uuid()}`,
      purpose: "Synthetic",
      ...values,
    };
  }
  async function previewReceipt(receipt: object) {
    const p = status(
      await treasurer.call(`${finance}/receipts/preview`, receipt),
      200,
      "Preview synthetic finance receipt",
    );
    return { receipt, previewToken: p.previewToken };
  }
  const mine = await code(person._id),
    theirs = await code(other._id);
  const preCutMoney = status(
    await treasurer.call(
      `${finance}/receipts`,
      await previewReceipt(
        payment({
          mode: "itemized",
          lines: [
            { givingId: mine, amount: "9007199254740993" },
            { givingId: theirs, amount: "2050" },
          ],
        }),
      ),
    ),
    201,
    "Commit a shared receipt",
  );
  const givePath = `${portal}/giving?period=${day.slice(0, 7)}`;
  const giving = status(await member.call(givePath), 200, "Read personal contribution");
  assert(
    giving.net === "9007199254740993" &&
      giving.items.length === 1 &&
      giving.items[0].amount === giving.net &&
      Object.keys(giving.items[0]).length === 4,
    "Exact personal money; other donor fields omitted",
  );
  const prayerPath = `${portal}/prayers`;
  const prayer = { category: "family", content: "Cầu thay riêng P66 giả lập", confirmed: true };
  const key = crypto.randomUUID();
  const prayerAck = status(
    await member.call(prayerPath, prayer, { key }),
    201,
    "Commit personal prayer",
  );
  const retry = status(await member.call(prayerPath, prayer, { key }), 200, "Same-intent retry");
  const personal = status(await member.call(prayerPath), 200, "Read personal prayer");
  assert(
    prayerAck.code === retry.code &&
      personal.items.length === 1 &&
      personal.items[0].content === prayer.content,
    "One prayer in the personal list",
  );
  const pastorPrayers = status(
    await pastor.call(`${church}/care/prayers?visibility=pastoral`),
    200,
    "Pastor reads personal prayer in existing register",
  );
  assert(
    pastorPrayers.items.some((p: { code: string }) => p.code === prayerAck.code),
    "Same prayer in the pastoral register",
  );
  assert(
    status(await owner.call(`${admin}/care/prayers?state=all`), 200, "Owner shared prayer list")
      .summary.total === 0,
    "Pastoral prayer omitted from owner counts",
  );

  const certInput = certificateFixture("baptism", rite);
  certInput.supplements.birthDate = null;
  const draftId = status(
    await pastor.call(`${cert}/drafts`, { input: certInput, reason: null }),
    201,
    "Create certificate from same baptism",
  ).draftId;
  const stageCertificate = async (id: string) =>
    status(
      await pastor.call(`${cert}/drafts/${id}/prepare`, {}, { version: 1 }),
      200,
      "Prepare certificate",
    );
  const cp = await stageCertificate(draftId);
  assert(
    !cp.snapshot.missing.length && !cp.snapshot.conflicts.length,
    "Certificate preview matches the recorded rite",
  );
  const certificateBody = (p: { id: string; context: string }) => ({
    previewId: p.id,
    context: p.context,
    confirm: true,
    faithConfirmed: true,
    reason: null,
  });
  const editionId = status(
    await pastor.call(`${cert}/drafts/${draftId}/issue`, certificateBody(cp), { version: 1 }),
    200,
    "Issue certificate",
  ).editionId;
  const retainedDraft = status(
    await pastor.call(`${cert}/drafts`, { input: certInput, reason: null }),
    201,
    "Stage independent certificate for recovery",
  ).draftId;
  const retainedCertificate = await stageCertificate(retainedDraft);

  const book = new ExcelJS.Workbook(),
    sheet = book.addWorksheet("Mẫu Hội Thánh P66");
  sheet.addRow(["Mẫu riêng Hội Thánh P66"]);
  for (const [k, name] of Object.entries(reportMetrics)) sheet.addRow([name, `{{${k}}}`]);
  const templateId = status(
    await pastor.call(`${reports}/templates`, Buffer.from(await book.xlsx.writeBuffer())),
    201,
    "Upload 13-metric tenant layout",
  ).id;
  status(
    await pastor.call(`${reports}/templates/${templateId}/activate`, {
      activeId: null,
      selectionVersion: 0,
      version: 1,
    }),
    200,
    "Activate tenant layout",
  );
  const reportInput = { templateId, from, to: day };
  const prepareReport = async () =>
    status(await pastor.call(`${reports}/preview`, reportInput), 200, "Prepare church report");
  const stale = await prepareReport();
  status(
    await pastor.call(`${church}/organization/units`, { kind: "area", name: "Khu vực P66" }),
    201,
    "Change report source after preview",
  );
  status(
    await pastor.call(`${reports}/issue`, { previewId: stale.id, confirm: true }),
    409,
    "Reject stale report preview",
  );
  const current = await prepareReport();
  const reportId = status(
    await pastor.call(`${reports}/issue`, { previewId: current.id, confirm: true }),
    201,
    "Issue report from refreshed sources",
  ).id;
  const retainedReport = await prepareReport();
  const artifactSpecs = [
    [`${cert}/editions/${editionId}/files/docx?version=1`, "certificate.docx"],
    [`${cert}/editions/${editionId}/files/pdf?version=1`, "certificate.pdf"],
    [`${reports}/editions/${reportId}/xlsx`, "report.xlsx"],
    [`${reports}/editions/${reportId}/pdf`, "report.pdf"],
  ] as const;
  const artifacts: Artifact[] = [];
  for (const [path, name] of artifactSpecs) {
    const { artifact, bytes } = await file(run, pastor, path, name);
    artifacts.push(artifact);
    await Bun.write(join(out, name), bytes);
  }
  const sourceDocx = Buffer.from(await Bun.file(join(out, "certificate.docx")).arrayBuffer());
  const xml = strFromU8(unzipSync(sourceDocx)["word/document.xml"] as Uint8Array);
  assert(
    xml.includes("MẪU KIỂM THỬ") && xml.includes(person.fullName),
    "Certificate DOCX matches linked baptism and watermark",
  );
  const reportDocument: ReportDocument = current.document;
  const expected = [1, 3, 2, 1, "—", 2, 1, 0, 0, 0, "—", 1, 0];
  const metricRows = reportDocument.rows.slice(1).map((r) => r.map((c) => c.value));
  assert(
    canonical(metricRows.map((r) => r[1])) === canonical(expected),
    `13 report metrics match synthetic fixture: ${JSON.stringify(metricRows.map((r) => r[1]))}`,
  );
  const readBack = new ExcelJS.Workbook();
  await readBack.xlsx.load(
    Buffer.from(await Bun.file(join(out, "report.xlsx")).arrayBuffer()) as never,
  );
  const values = readBack.worksheets[0]?.getSheetValues().flat();
  assert(values?.includes(reportMark), "Server watermark in Excel");
  const actualRows: unknown[][] = [];
  readBack.worksheets[0]?.eachRow((row) => {
    if (metricRows.some(([label]) => row.getCell(1).value === label))
      actualRows.push([row.getCell(1).value, row.getCell(2).value]);
  });
  assert(
    canonical(actualRows) === canonical(metricRows),
    "Workbook row-by-row match to report snapshot",
  );
  await Bun.write(
    join(out, "outputs.json"),
    JSON.stringify({ artifacts, metricRows, person: person.fullName, reportMark }, null, 2),
  );

  status(
    await outsider.call(`${portal}/profile`),
    404,
    "Other tenant cannot reach own portal of this tenant",
  );
  status(
    await outsider.call(`${reports}/editions/${reportId}`),
    404,
    "Other tenant cannot read report",
  );
  status(
    await member.call(`${cert}/editions/${editionId}`),
    403,
    "Member cannot read operational certificates",
  );
  status(await owner.call(prayerPath), 401, "Owner realm cannot read personal prayer");
  const clerk = run.client(),
    clerkAccount = await syntheticUser(owner, clerk, a, "secretary");
  assert(
    (await run.raw(clerk, artifactSpecs[0][0])).status === 200 &&
      (await run.raw(clerk, artifactSpecs[3][0])).status === 200,
    "Secretary can download while authorized",
  );

  const load = await measureReads([
    { name: "profile", access: async () => (await member.call(`${portal}/profile`)).status },
    { name: "giving", access: async () => (await member.call(givePath)).status },
    { name: "prayers", access: async () => (await member.call(prayerPath)).status },
    {
      name: "report detail",
      access: async () => (await pastor.call(`${reports}/editions/${reportId}`)).status,
    },
  ]);
  await Bun.write(
    join(out, "load.json"),
    JSON.stringify(
      {
        fixtureMembers: 8,
        transport: "real HTTP handler, in-process; MongoDB and Redis local",
        load,
      },
      null,
      2,
    ),
  );
  const pendingMoney = await previewReceipt(payment({ mode: "aggregate", amount: "117" }));

  // Source has no listener; every command and concurrent sample has settled before the cut.
  const before = await p46Fingerprint(source);
  const fd = openSync(archive, "wx", 0o600);
  try {
    const dump = mongoTool(
      [
        "mongodump",
        "--host",
        "127.0.0.1:27017",
        "--db",
        source.db.databaseName,
        "--archive",
        "--gzip",
      ],
      fd,
      false,
    );
    assert(dump.exitCode === 0, `Quiesced synthetic dump ${dump.stderr.toString().slice(-200)}`);
  } finally {
    closeSync(fd);
  }
  await target.client.connect();
  connected.push(target);
  assert(
    !(await target.db.listCollections().hasNext()),
    "New recovery database empty before restore",
  );
  const input = openSync(archive, "r");
  try {
    const restore = mongoTool(
      [
        "mongorestore",
        "--host",
        "127.0.0.1:27017",
        "--archive",
        "--gzip",
        "--nsInclude",
        `${source.db.databaseName}.*`,
        "--nsFrom",
        `${source.db.databaseName}.*`,
        "--nsTo",
        `${target.db.databaseName}.*`,
      ],
      input,
      true,
    );
    assert(restore.exitCode === 0, `Restore to new UUID ${restore.stderr.toString().slice(-200)}`);
  } finally {
    closeSync(input);
  }
  const restored = await p46Fingerprint(target);
  assert(
    canonical(before) === canonical(restored),
    "All documents, indexes and validators equal before transformations",
  );
  // Compare exact stored bytes separately before revocation, not just stored digest strings.
  const fileProof = [];
  for (const [collection, id, formats] of [
    ["certificate_editions", editionId, ["docx", "pdf"]],
    ["report_editions", reportId, ["xlsx", "pdf"]],
  ] as const) {
    const row = await target.db.collection(collection).findOne({ _id: new ObjectId(id) });
    assert(row, `Restored ${collection} row`);
    for (const kind of formats) {
      const filename = `${collection === "report_editions" ? "report" : "certificate"}.${kind}`;
      const digest = hash(row[kind].buffer);
      assert(
        digest === artifacts.find((item) => item.name === filename)?.sha256,
        `Restored bytes match ${filename}`,
      );
      fileProof.push({ name: filename, sha256: digest });
    }
  }
  const tail = status(
    await treasurer.call(
      `${finance}/receipts`,
      await previewReceipt(payment({ mode: "aggregate", amount: "205" })),
    ),
    201,
    "Commit a synthetic transaction on source after the cut",
  );

  const revoked = await target.sessions.updateMany(
    { revokedAt: { $exists: false } },
    { $set: { revokedAt: new Date() }, $inc: { writeFence: 1 } },
  );
  const purgedCert = await target.db.collection("certificate_previews").deleteMany({});
  const purgedReport = await target.db.collection("report_previews").deleteMany({});
  assert(
    revoked.modifiedCount > 0 && purgedCert.deletedCount > 0 && purgedReport.deletedCount > 0,
    "Retire copied sessions and pre-cut previews",
  );
  const again = await runtime(target, {
    ...conf,
    database: target.db.databaseName,
    csrfKey: uuid() + uuid(),
  });
  const freshMember = again.client(),
    freshPastor = again.client(),
    freshTreasurer = again.client(),
    freshOutside = again.client();
  const oldStatus = await again.raw(member, `${portal}/profile`);
  assert(oldStatus.status === 401, "Old member cookie denied after recovery");
  await oldStatus.arrayBuffer();
  status(
    await freshMember.login(memberAccount.email, memberAccount.password, a.code),
    200,
    "Fresh restored member login",
  );
  status(
    await freshPastor.login(pastorAccount.email, pastorAccount.password, a.code),
    200,
    "Fresh restored pastor login",
  );
  status(
    await freshTreasurer.login(treasurerAccount.email, treasurerAccount.password, a.code),
    200,
    "Fresh restored treasurer login",
  );
  status(
    await freshOutside.login(outsiderAccount.email, outsiderAccount.password, b.code),
    200,
    "Fresh restored other church login",
  );
  assert(
    status(await freshMember.call(givePath), 200, "Restored personal giving").net === giving.net,
    "Restored money matches pre-cut value",
  );
  assert(
    status(await freshMember.call(prayerPath), 200, "Restored personal prayer").items[0].code ===
      prayerAck.code,
    "Restored prayer still belongs to the same account and subject",
  );
  status(
    await freshOutside.call(`${reports}/editions/${reportId}`),
    404,
    "Other church remains denied after restore",
  );
  for (const item of artifacts) {
    const received = await file(again, freshPastor, item.path, item.name);
    assert(received.artifact.sha256 === item.sha256, `Fresh authorized download hash ${item.name}`);
  }
  status(
    await freshPastor.call(
      `${cert}/drafts/${retainedDraft}/issue`,
      certificateBody(retainedCertificate),
      { version: 1 },
    ),
    412,
    "Old certificate preview denied after recovery",
  );
  status(
    await freshPastor.call(`${reports}/issue`, { previewId: retainedReport.id, confirm: true }),
    409,
    "Old report preview denied after recovery",
  );
  status(
    await freshTreasurer.call(`${finance}/operations/${preCutMoney.operationId}`),
    200,
    "Pre-cut finance receipt retained",
  );
  status(
    await freshTreasurer.call(`${finance}/operations/${tail.operationId}`),
    404,
    "Post-cut receipt absent from recovery, UNKNOWN",
  );
  const ledgerCount = await target.db.collection("finance_ledger").countDocuments();
  status(
    await freshTreasurer.call(`${finance}/receipts`, pendingMoney),
    409,
    "Old signed finance preview fails after key rotation",
  );
  assert(
    (await target.db.collection("finance_ledger").countDocuments()) === ledgerCount,
    "No replay of unknown tail or disallowed preview",
  );
  const cv = status(
    await owner.call(`${admin}/accounts/${clerkAccount.id}`),
    200,
    "Secretary account version before revocation",
  ).version;
  status(
    await owner.call(
      `${admin}/accounts/${clerkAccount.id}/permissions`,
      {
        role: "member",
        scope: { kind: "self" },
      },
      { method: "PATCH", version: cv },
    ),
    200,
    "Revoke secretary file rights",
  );
  async function deniedDownloads(who: SyntheticClient, expected: number, label: string) {
    for (const [path, name] of artifactSpecs) {
      const response = await run.raw(who, path);
      assert(response.status === expected, `${label}: ${name} [${response.status}]`);
      await response.arrayBuffer();
    }
  }
  await deniedDownloads(
    clerk,
    403,
    "Role loss denies files immediately on the already logged-in session",
  );
  const downgraded = run.client();
  status(
    await downgraded.login(clerkAccount.email, clerkAccount.password, a.code),
    200,
    "Fresh downgraded account login",
  );
  await deniedDownloads(downgraded, 403, "Fresh downgraded session cannot download");
  const clerkVersion = status(
    await owner.call(`${admin}/accounts/${clerkAccount.id}`),
    200,
    "Version before account lock",
  ).version;
  status(
    await owner.call(
      `${admin}/accounts/${clerkAccount.id}/status`,
      {
        status: "locked",
        reason: "Kiểm thử thu hồi phiên",
      },
      { method: "PATCH", version: clerkVersion },
    ),
    200,
    "Lock synthetic account to revoke its session",
  );
  await deniedDownloads(
    downgraded,
    401,
    "Explicit session revocation denies every direct download",
  );

  await Bun.write(
    join(out, "restore.json"),
    JSON.stringify(
      {
        status: "PASS",
        collections: Object.keys(before).length,
        before,
        restored,
        fileProof,
        revokedSessions: revoked.modifiedCount,
        purgedPreviews: { cert: purgedCert.deletedCount, report: purgedReport.deletedCount },
        cutLine: {
          preCut: "RETAINED",
          postCut: "UNKNOWN (no replay)",
          method: "quiesced synthetic dump",
        },
      },
      null,
      2,
    ),
  );
  await Bun.write(
    join(out, "results.json"),
    JSON.stringify(
      { status: "PASS", checks, artifactCount: artifacts.length, metricCount: metricRows.length },
      null,
      2,
    ),
  );
  console.log(
    `P6.6 qualification PASS · ${checks.length} checks · ${Object.keys(before).length} restored collections`,
  );
} finally {
  const cleanup: { database: string; removed: boolean }[] = [];
  for (const database of connected.reverse()) {
    try {
      check(
        /^church_cms_test_p66_(?:source|target)_[a-f0-9]{32}$/.test(database.db.databaseName),
        "Refuse cleanup outside this run's UUIDs",
      );
      await database.db.dropDatabase();
      const removed = !(await database.db.admin().listDatabases()).databases.some(
        (db) => db.name === database.db.databaseName,
      );
      cleanup.push({ database: database.db.databaseName, removed });
    } catch {
      cleanup.push({ database: database.db.databaseName, removed: false });
    } finally {
      await database.client.close();
    }
  }
  for (const rate of rates) if (rate.client.isOpen) rate.client.destroy();
  await rm(privateDir, { recursive: true, force: true });
  await Bun.write(
    join(out, "cleanup.json"),
    JSON.stringify(
      { cleanup, privateDirectoryRemoved: !(await Bun.file(archive).exists()) },
      null,
      2,
    ),
  );
}
