import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { Decimal128, ObjectId } from "mongodb";
import { createApp } from "../../api/app";
import { config } from "../../api/config";
import { AppError } from "../../api/errors";
import { decimalString, moneyValue } from "../../api/finance/money";
import { Finance } from "../../api/finance/service";
import type { Receipt } from "../../api/finance/transactions-model";
import { Identity } from "../../api/identity/service";
import { Database, initialize } from "../../api/infrastructure/database";
import { RateLimit } from "../../api/infrastructure/rate-limit";
import { businessDay } from "../../api/members/dates";
import {
  localOnly,
  SyntheticClient,
  seedP2,
  syntheticOwner,
  syntheticUser,
} from "../../scripts/p2-fixtures";
import { financeChurch, financeRoot } from "../../scripts/p51-fixtures";

const conf = {
  ...config(),
  origin: "https://localhost:3494",
  database: `church_cms_test_p52_${crypto.randomUUID().replaceAll("-", "")}`,
  csrfKey: crypto.randomUUID() + crypto.randomUUID(),
};
localOnly(conf);
let timeOffset = 0;
const db = new Database(conf),
  rate = new RateLimit(conf.redisUrl, conf.csrfKey),
  logs: object[] = [];
let app: ReturnType<typeof createApp>,
  owner: SyntheticClient,
  pastor: SyntheticClient,
  treasurer: SyntheticClient,
  secretary: SyntheticClient,
  lead: SyntheticClient,
  member: SyntheticClient,
  c: Awaited<ReturnType<typeof financeChurch>>,
  other: Awaited<ReturnType<typeof financeChurch>>,
  fundId: string,
  givingId: string,
  memberId: string;
const client = (realm: "owner" | "church" = "church") => {
  const ip = crypto.randomUUID();
  return new SyntheticClient(realm, conf.origin, (req) => app(req, { ip }));
};
const root = () => financeRoot(c);
const command = (extra: object = {}) => ({
  submissionId: crypto.randomUUID(),
  businessDate: businessDay(),
  fundId,
  sourceReference: `S-${crypto.randomUUID()}`,
  purpose: "Nội dung tài chính riêng synthetic",
  mode: "aggregate",
  amount: "9007199254740993",
  ...extra,
});
async function preview(b: object, s = treasurer) {
  return s.call(`${root()}/receipts/preview`, b);
}
async function post(b: object, s = treasurer, key?: string) {
  const p = await preview(b, s);
  expect(p.status).toBe(200);
  return s.call(
    `${root()}/receipts`,
    { receipt: b, previewToken: p.payload.data.previewToken },
    { key },
  );
}
async function receipt(extra: object = {}) {
  const b = command(extra),
    r = await post(b);
  expect(r.status).toBe(201);
  return { b, id: r.payload.data.receiptId as string, r };
}
async function net() {
  return (await treasurer.call(`${root()}/ledger`)).payload.data.netIncome as string;
}
beforeAll(async () => {
  await db.client.connect();
  await initialize(db.db);
  await rate.connect();
  const identity = new Identity(db, rate, conf, () => new Date(Date.now() + timeOffset));
  await identity.initialize();
  app = createApp(identity, conf, { log: (r) => logs.push(r) });
  owner = client("owner");
  await syntheticOwner(db, owner);
  c = await financeChurch(owner, "P52 contracts");
  other = await financeChurch(owner, "P52 other");
  [pastor, treasurer, secretary, lead, member] = [client(), client(), client(), client(), client()];
  for (const [s, role] of [
    [pastor, "pastor"],
    [treasurer, "treasurer"],
    [secretary, "secretary"],
    [lead, "ministry_lead"],
    [member, "member"],
  ] as const)
    await syntheticUser(owner, s, c, role, [c.unitId]);
  const f = await pastor.call(`${root()}/funds`, { name: "Quỹ thu synthetic" });
  fundId = f.payload.data.fundId;
  const people = await seedP2(db, c.id, (await pastor.call("auth/me")).payload.data.accountId, 12);
  const current = people.members.filter((m) => ["active", "long_absent"].includes(m.participation));
  memberId = (current[0] as (typeof people.members)[number])._id.toHexString();
});
afterAll(async () => {
  await db.db.dropDatabase();
  expect(
    (await db.db.admin().listDatabases()).databases.some((d) => d.name === conf.database),
  ).toBe(false);
  await db.client.close();
  if (rate.client.isOpen) rate.client.destroy();
});
describe("P52 real transactional income contracts", () => {
  test("exact bigint/Decimal128 including scientific notation and integer limits", () => {
    expect(moneyValue("9007199254740993")).toBe(9007199254740993n);
    expect(decimalString(Decimal128.fromString("9.007199254740993E+15"))).toBe("9007199254740993");
    expect(decimalString(Decimal128.fromString("-1.00E+3"))).toBe("-1000");
    for (const v of ["0", "-1", "1.5", "01", "1e4", "1000000000000000000"])
      expect(() => moneyValue(v)).toThrow();
    expect(() => decimalString(Decimal128.fromString("1.1"))).toThrow();
  });
  test("GET no period initialization; action ACL, cross tenant and strict close/no legacy expense API", async () => {
    expect(await db.db.collection("finance_periods").countDocuments()).toBe(0);
    for (const s of [pastor, treasurer])
      for (const p of ["giving-codes", "member-options", "receipts", "ledger"])
        expect((await s.call(`${root()}/${p}`)).status).toBe(200);
    expect(await db.db.collection("finance_periods").countDocuments()).toBe(0);
    for (const s of [owner, secretary, lead, member])
      for (const p of ["giving-codes", "member-options", "receipts", "ledger"]) {
        const path =
          s === owner ? `${root().replace("churches/", "owner/churches/")}/${p}` : `${root()}/${p}`;
        expect((await s.call(path)).status).toBe(403);
      }
    expect((await treasurer.call(`${financeRoot(other)}/receipts`)).status).toBe(403);
    expect((await pastor.call(`${root()}/receipts/preview`, command())).status).toBe(403);
    expect((await pastor.call(`${root()}/giving-codes`, { memberId })).status).toBe(403);
    expect((await treasurer.call(`${root()}/funds`, { name: "Denied" })).status).toBe(403);
    expect((await treasurer.call(`churches/${c.id}/members`)).status).toBe(403);
    expect((await treasurer.call(`${root()}/periods/2026-11/close`, {})).status).toBe(422);
    expect((await treasurer.call(`${root()}/expenses`, {})).status).toBe(404);
  });
  test("minimal source identity, one immutable code per member, active/inactive CAS/history", async () => {
    const options = await treasurer.call(`${root()}/member-options?limit=2`);
    expect(options.payload.data.items.length).toBe(2);
    expect(Object.keys(options.payload.data.items[0]).sort()).toEqual(["code", "id", "name"]);
    expect(options.payload.data.nextCursor).toBeString();
    const r = await treasurer.call(`${root()}/giving-codes`, { memberId });
    expect(r.status).toBe(201);
    givingId = r.payload.data.givingId;
    const code = (await treasurer.call(`${root()}/giving-codes?memberId=${memberId}`)).payload.data
      .items[0];
    expect(code.code).toStartWith("DH-");
    expect(code.code).not.toBe(code.memberCode);
    expect((await treasurer.call(`${root()}/giving-codes`, { memberId })).payload.error.code).toBe(
      "FINANCE_GIVING_EXISTS",
    );
    expect(
      (
        await treasurer.call(
          `${root()}/giving-codes/${givingId}/status`,
          { status: "inactive", reason: "Tạm ngừng" },
          { method: "PATCH", version: 2 },
        )
      ).status,
    ).toBe(412);
    expect(
      (
        await treasurer.call(
          `${root()}/giving-codes/${givingId}/status`,
          { status: "inactive", reason: "Tạm ngừng" },
          { method: "PATCH", version: 1 },
        )
      ).status,
    ).toBe(200);
    expect((await treasurer.call(`${root()}/giving-codes`, { memberId })).status).toBe(409);
    expect(
      (
        await treasurer.call(
          `${root()}/giving-codes/${givingId}/status`,
          { status: "active", reason: "Khôi phục" },
          { method: "PATCH", version: 2 },
        )
      ).status,
    ).toBe(200);
    expect(
      (await pastor.call(`${root()}/giving-codes/${givingId}/history`)).payload.data.items.length,
    ).toBe(3);
  });
  test("preview no money writes; aggregate exact total one ledger entry snapshots", async () => {
    const b = command(),
      before = await db.db.collection("finance_receipts").countDocuments(),
      p = await preview(b);
    expect(p.payload.data.total).toBe(b.amount);
    expect(await db.db.collection("finance_receipts").countDocuments()).toBe(before);
    const r = await treasurer.call(`${root()}/receipts`, {
      receipt: b,
      previewToken: p.payload.data.previewToken,
    });
    expect(r.status).toBe(201);
    const d = (await pastor.call(`${root()}/receipts/${r.payload.data.receiptId}`)).payload.data;
    expect(d.total).toBe("9007199254740993");
    expect(d.lines).toEqual([]);
    expect(
      await db.db.collection("finance_ledger").countDocuments({ receiptId: new ObjectId(d.id) }),
    ).toBe(1);
    expect(d.canVoid).toBe(false);
  });
  test("itemized sum exact, no double count, member finance port separated from DTO", async () => {
    const before = BigInt(await net()),
      b = command({
        mode: "itemized",
        amount: undefined,
        lines: [
          { givingId, amount: "9007199254740993" },
          { givingId, amount: "7" },
        ],
      }),
      r = await post(b);
    expect(r.status).toBe(201);
    const d = (await treasurer.call(`${root()}/receipts/${r.payload.data.receiptId}`)).payload.data;
    expect(d.total).toBe("9007199254741000");
    expect(BigInt(await net()) - before).toBe(9007199254741000n);
    expect(d.lines.length).toBe(2);
    const own = await pastor.call(`${root()}/receipts?givingId=${givingId}`);
    expect(
      own.payload.data.items.some(
        (i: { contribution: string }) => i.contribution === "9007199254741000",
      ),
    ).toBe(true);
    const m = await pastor.call(`churches/${c.id}/members/${memberId}`);
    expect(JSON.stringify(m.payload)).not.toContain("givingId");
    expect(JSON.stringify(m.payload)).not.toContain("9007199254741000");
    const second = await db.db.collection("members").findOne({
      churchId: new ObjectId(c.id),
      _id: { $ne: new ObjectId(memberId) },
      participation: { $in: ["active", "long_absent"] },
    });
    expect(second).toBeTruthy();
    const issued = await treasurer.call(`${root()}/giving-codes`, {
      memberId: second?._id.toHexString(),
    });
    expect(issued.status).toBe(201);
    const secondGiving = issued.payload.data.givingId;
    const multi = await receipt({
        mode: "itemized",
        amount: undefined,
        lines: [
          { givingId, amount: "12" },
          { givingId: secondGiving, amount: "34" },
        ],
      }),
      multiDetail = (await treasurer.call(`${root()}/receipts/${multi.id}`)).payload.data;
    expect(multiDetail.total).toBe("46");
    expect(multiDetail.lines.map((l: { memberId: string }) => l.memberId)).toEqual([
      memberId,
      second?._id.toHexString(),
    ]);
    for (const [g, amount] of [
      [givingId, "12"],
      [secondGiving, "34"],
    ]) {
      const individual = await pastor.call(`${root()}/receipts?givingId=${g}`);
      expect(
        individual.payload.data.items.find((r: { id: string }) => r.id === multi.id).contribution,
      ).toBe(amount);
    }
  });
  test("invalid modes, amount/total bounds, 100-line body fits 16KiB; 101 rejected", async () => {
    for (const x of [
      { amount: 1 },
      { amount: "0" },
      { amount: "1.1" },
      { amount: "1e6" },
      { amount: "01" },
      { amount: "1000000000000000000" },
      { mode: "aggregate", lines: [] },
      { businessDate: "2026-02-30" },
      { businessDate: "9999-12-31" },
    ])
      expect((await preview(command(x))).status).toBe(422);
    expect(
      (
        await preview(
          command({
            mode: "itemized",
            amount: undefined,
            lines: [
              { givingId, amount: "999999999999999999" },
              { givingId, amount: "1" },
            ],
          }),
        )
      ).status,
    ).toBe(422);
    const b = command({
        mode: "itemized",
        amount: undefined,
        lines: Array.from({ length: 100 }, () => ({ givingId, amount: "1" })),
      }),
      p = await preview(b);
    expect(p.status).toBe(200);
    const body = { receipt: b, previewToken: p.payload.data.previewToken };
    expect(Buffer.byteLength(JSON.stringify(body))).toBeLessThan(16384);
    expect((await treasurer.call(`${root()}/receipts`, body)).status).toBe(201);
    expect(
      (
        await preview({
          ...b,
          lines: Array.from({ length: 101 }, () => ({ givingId, amount: "1" })),
        })
      ).status,
    ).toBe(422);
    expect(
      (await treasurer.call(`${root()}/receipts/preview`, { ...b, purpose: "x".repeat(17000) }))
        .status,
    ).toBe(413);
  });
  test("preview bound to actor/body/source and expires, stale names not silently committed", async () => {
    const b = command(),
      p = await preview(b),
      f = await db.db.collection("finance_funds").findOne({ _id: new ObjectId(fundId) });
    expect(
      (
        await treasurer.call(`${root()}/receipts`, {
          receipt: { ...b, amount: "1" },
          previewToken: p.payload.data.previewToken,
        })
      ).payload.error.code,
    ).toBe("FINANCE_PREVIEW_STALE");
    await pastor.call(
      `${root()}/funds/${fundId}`,
      { name: "Quỹ đã đổi" },
      { method: "PATCH", version: f?.version },
    );
    expect(
      (
        await treasurer.call(`${root()}/receipts`, {
          receipt: b,
          previewToken: p.payload.data.previewToken,
        })
      ).payload.error.code,
    ).toBe("FINANCE_PREVIEW_STALE");
    const fresh = await preview(command());
    timeOffset = 301000;
    const expBody = command(),
      expPreview = await preview(expBody);
    timeOffset += 301000;
    expect(
      (
        await treasurer.call(`${root()}/receipts`, {
          receipt: expBody,
          previewToken: expPreview.payload.data.previewToken,
        })
      ).payload.error.code,
    ).toBe("FINANCE_PREVIEW_STALE");
    timeOffset = 0;
    expect(fresh.status).toBe(200);
  });
  test("durable submission/source dedupe survives operation removal and void replay", async () => {
    const b = command({ amount: "12345" }),
      p = await preview(b),
      body = { receipt: b, previewToken: p.payload.data.previewToken },
      key = crypto.randomUUID(),
      r = await treasurer.call(`${root()}/receipts`, body, { key }),
      id = r.payload.data.receiptId;
    expect(r.status).toBe(201);
    expect((await treasurer.call(`${root()}/receipts`, body, { key })).payload.meta.replayed).toBe(
      true,
    );
    expect(
      (
        await treasurer.call(
          `${root()}/receipts/${id}/void`,
          { reason: "Nhập sai synthetic", confirmed: true },
          { version: 1 },
        )
      ).status,
    ).toBe(200);
    await db.db
      .collection("idempotency_operations")
      .deleteOne({ _id: new ObjectId(r.payload.data.operationId) });
    const retry = await treasurer.call(`${root()}/receipts`, body);
    expect(retry.status).toBe(200);
    expect(retry.payload.data.version).toBe(2);
    expect((await treasurer.call(`${root()}/receipts/${id}`)).payload.data.state).toBe("voided");
    expect(
      await db.db.collection("finance_ledger").countDocuments({ receiptId: new ObjectId(id) }),
    ).toBe(2);
    expect(
      (await post(command({ sourceReference: b.sourceReference, amount: "1" }))).payload.error.code,
    ).toBe("FINANCE_SOURCE_EXISTS");
    expect(
      (
        await treasurer.call(`${root()}/receipts`, {
          receipt: { ...b, amount: "1" },
          previewToken: p.payload.data.previewToken,
        })
      ).payload.error.code,
    ).toBe("FINANCE_SUBMISSION_CONFLICT");
    expect((await pastor.call(`${root()}/operations/${r.payload.data.operationId}`)).status).toBe(
      404,
    );
  });
  test("void original date/period, once only, CAS, replacement unique and immutable snapshots", async () => {
    const before = BigInt(await net()),
      x = await receipt({ amount: "1200" }),
      original = (await treasurer.call(`${root()}/receipts/${x.id}`)).payload.data;
    expect(
      (
        await pastor.call(
          `${root()}/receipts/${x.id}/void`,
          { reason: "Denied", confirmed: true },
          { version: 1 },
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await treasurer.call(
          `${root()}/receipts/${x.id}/void`,
          { reason: " ", confirmed: true },
          { version: 1 },
        )
      ).status,
    ).toBe(422);
    expect(
      (
        await treasurer.call(
          `${root()}/receipts/${x.id}/void`,
          { reason: "Sai", confirmed: true },
          { version: 2 },
        )
      ).status,
    ).toBe(412);
    const key = crypto.randomUUID(),
      body = { reason: "Sai nguồn", confirmed: true };
    expect(
      (await treasurer.call(`${root()}/receipts/${x.id}/void`, body, { version: 1, key })).status,
    ).toBe(200);
    expect(
      (await treasurer.call(`${root()}/receipts/${x.id}/void`, body, { version: 1, key })).status,
    ).toBe(200);
    expect(BigInt(await net())).toBe(before);
    const entries = await db.db
      .collection("finance_ledger")
      .find({ receiptId: new ObjectId(x.id) })
      .toArray();
    expect(entries.map((e) => decimalString(e.amount)).sort()).toEqual(["-1200", "1200"]);
    expect(
      entries.every(
        (e) => e.businessDate === original.businessDate && e.period === original.period,
      ),
    ).toBe(true);
    expect(
      (
        await treasurer.call(
          `${root()}/receipts/${x.id}`,
          { purpose: "Mutate" },
          { method: "PATCH", version: 2 },
        )
      ).status,
    ).toBe(405);
    expect((await receipt({ amount: "1300", replacesReceiptId: x.id })).id).toBeString();
    expect((await post(command({ amount: "1", replacesReceiptId: x.id }))).payload.error.code).toBe(
      "FINANCE_REPLACEMENT_EXISTS",
    );
  });
  test("closed synthetic period refuses money/void; reopen fixture only; source lifecycle fences", async () => {
    const x = await receipt({ amount: "5" }),
      period = businessDay().slice(0, 7);
    await db.db
      .collection("finance_periods")
      .updateOne(
        { churchId: new ObjectId(c.id), period },
        { $set: { state: "closed" }, $inc: { version: 1 } },
      );
    expect((await preview(command())).payload.error.code).toBe("FINANCE_PERIOD_CLOSED");
    expect((await treasurer.call(`${root()}/receipts/${x.id}`)).payload.data.canVoid).toBe(false);
    expect(
      (
        await treasurer.call(
          `${root()}/receipts/${x.id}/void`,
          { reason: "Sai", confirmed: true },
          { version: 1 },
        )
      ).payload.error.code,
    ).toBe("FINANCE_PERIOD_CLOSED");
    await db.db
      .collection("finance_periods")
      .updateOne(
        { churchId: new ObjectId(c.id), period },
        { $set: { state: "open" }, $inc: { version: 1 } },
      );
    const m = await db.db.collection("members").findOne({ _id: new ObjectId(memberId) });
    await db.db.collection("members").updateOne(
      { _id: m?._id },
      {
        $set: { fullName: "Tên hiện hành mới", participation: "transferred" },
        $inc: { version: 1 },
      },
    );
    expect(
      (await treasurer.call(`${root()}/giving-codes?memberId=${memberId}`)).payload.data.items[0]
        .status,
    ).toBe("active");
    expect(
      (
        await preview(
          command({ mode: "itemized", amount: undefined, lines: [{ givingId, amount: "1" }] }),
        )
      ).status,
    ).toBe(200);
    const archived = await db.db.collection("members").findOne({
      churchId: new ObjectId(c.id),
      participation: { $nin: ["active", "long_absent"] },
      _id: { $ne: new ObjectId(memberId) },
    });
    expect(
      (await treasurer.call(`${root()}/giving-codes`, { memberId: archived?._id.toHexString() }))
        .status,
    ).toBe(422);
    expect(
      (await treasurer.call(`${root()}/giving-codes?memberId=${memberId}`)).payload.data.items[0]
        .memberName,
    ).toBe("Tên hiện hành mới");
  });
  test("failure between receipt/ledger/history rolls back all money and operation", async () => {
    const counts = await Promise.all(
        ["finance_receipts", "finance_ledger", "finance_history", "idempotency_operations"].map(
          (n) => db.db.collection(n).countDocuments(),
        ),
      ),
      b = command(),
      p = await preview(b),
      spy = spyOn(Finance.prototype, "append").mockRejectedValueOnce(
        new AppError(503, "DEPENDENCY_UNAVAILABLE"),
      );
    const r = await treasurer.call(`${root()}/receipts`, {
      receipt: b,
      previewToken: p.payload.data.previewToken,
    });
    spy.mockRestore();
    expect(r.status).toBe(503);
    expect(
      await Promise.all(
        ["finance_receipts", "finance_ledger", "finance_history", "idempotency_operations"].map(
          (n) => db.db.collection(n).countDocuments(),
        ),
      ),
    ).toEqual(counts);
  });
  test("racing duplicate source and first-period creation never double credit", async () => {
    const b = command({ businessDate: "2025-01-01", amount: "17" }),
      p = await preview(b),
      body = { receipt: b, previewToken: p.payload.data.previewToken },
      results = await Promise.all(
        Array.from({ length: 3 }, () => treasurer.call(`${root()}/receipts`, body)),
      );
    expect(results.filter((r) => r.status === 201).length).toBe(1);
    expect(
      await db.db.collection("finance_receipts").countDocuments({ submissionId: b.submissionId }),
    ).toBe(1);
    expect(
      await db.db
        .collection("finance_periods")
        .countDocuments({ churchId: new ObjectId(c.id), period: "2025-01" }),
    ).toBe(1);
    const diff = command({
      sourceReference: b.sourceReference,
      businessDate: "2025-01-01",
      amount: "19",
    });
    expect((await post(diff)).status).toBe(409);
    const churchId = new ObjectId(c.id),
      period = "2025-02",
      periodId = `${c.id}:${period}`;
    await db.db.collection("finance_periods").insertOne({
      _id: periodId as never,
      churchId,
      period,
      state: "open",
      version: 1,
      writeFence: 0,
    });
    const raceBody = command({ businessDate: "2025-02-01", amount: "23" }),
      racePreview = await preview(raceBody);
    const [posted] = await Promise.all([
      treasurer.call(`${root()}/receipts`, {
        receipt: raceBody,
        previewToken: racePreview.payload.data.previewToken,
      }),
      db.transaction(async (tx) => {
        const close = await db.db
          .collection("finance_periods")
          .updateOne(
            { _id: periodId as never, state: "open", version: 1 },
            { $set: { state: "closed" }, $inc: { version: 1, writeFence: 1 } },
            { session: tx },
          );
        expect(close.matchedCount).toBe(1);
      }),
    ]);
    expect([201, 409].includes(posted.status)).toBe(true);
    expect(
      (await db.db.collection("finance_periods").findOne({ _id: periodId as never }))?.state,
    ).toBe("closed");
    expect(
      await db.db
        .collection("finance_receipts")
        .countDocuments({ submissionId: raceBody.submissionId }),
    ).toBe(posted.status === 201 ? 1 : 0);
    expect(await db.db.collection("finance_ledger").countDocuments({ churchId, period })).toBe(
      posted.status === 201 ? 1 : 0,
    );
  });
  test("preview fences code/member changes, wrong actor and foreign source IDs", async () => {
    const b = command({ mode: "itemized", amount: undefined, lines: [{ givingId, amount: "12" }] }),
      p = await preview(b),
      code = (await treasurer.call(`${root()}/giving-codes?memberId=${memberId}`)).payload.data
        .items[0];
    expect(
      (
        await treasurer.call(
          `${root()}/giving-codes/${givingId}/status`,
          { status: "inactive", reason: "Concurrent source change" },
          { method: "PATCH", version: code.version },
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await treasurer.call(`${root()}/receipts`, {
          receipt: b,
          previewToken: p.payload.data.previewToken,
        })
      ).payload.error.code,
    ).toBe("FINANCE_SOURCE_UNAVAILABLE");
    await treasurer.call(
      `${root()}/giving-codes/${givingId}/status`,
      { status: "active", reason: "Restore source fixture" },
      { method: "PATCH", version: code.version + 1 },
    );
    expect(
      (
        await treasurer.call(`${root()}/receipts`, {
          receipt: b,
          previewToken: p.payload.data.previewToken,
        })
      ).payload.error.code,
    ).toBe("FINANCE_PREVIEW_STALE");
    const p2 = await preview(b);
    await db.db
      .collection("members")
      .updateOne(
        { _id: new ObjectId(memberId) },
        { $set: { fullName: "Tên sau preview" }, $inc: { version: 1 } },
      );
    expect(
      (
        await treasurer.call(`${root()}/receipts`, {
          receipt: b,
          previewToken: p2.payload.data.previewToken,
        })
      ).payload.error.code,
    ).toBe("FINANCE_PREVIEW_STALE");
    const actor = client();
    await syntheticUser(owner, actor, c, "treasurer");
    const p3 = await preview(b);
    expect(
      (
        await actor.call(`${root()}/receipts`, {
          receipt: b,
          previewToken: p3.payload.data.previewToken,
        })
      ).payload.error.code,
    ).toBe("FINANCE_PREVIEW_STALE");
    const actorPreview = await preview(b, actor);
    const actorMe = (await actor.call("auth/me")).payload.data;
    await db.db
      .collection("accounts")
      .updateOne(
        { _id: new ObjectId(actorMe.accountId) },
        { $set: { role: "secretary" }, $inc: { version: 1 } },
      );
    const revoked = await actor.call(`${root()}/receipts`, {
      receipt: b,
      previewToken: actorPreview.payload.data.previewToken,
    });
    expect([401, 403].includes(revoked.status)).toBe(true);
    expect(
      await db.db.collection("finance_receipts").countDocuments({ submissionId: b.submissionId }),
    ).toBe(0);
    expect(
      (await preview(command({ fundId: new ObjectId().toHexString() }))).payload.error.code,
    ).toBe("FINANCE_SOURCE_UNAVAILABLE");
    expect(
      (
        await preview(
          command({
            mode: "itemized",
            amount: undefined,
            lines: [{ givingId: new ObjectId().toHexString(), amount: "1" }],
          }),
        )
      ).payload.error.code,
    ).toBe("FINANCE_SOURCE_UNAVAILABLE");
    const prior = await db.db
      .collection<Receipt>("finance_receipts")
      .findOne({ mode: "itemized", state: "posted" });
    expect(prior?.lines[0]?.memberName).not.toBe("Tên sau preview");
  });
  test("Mongo validators reject fractional/negative/mismatched total and duplicate ledger", async () => {
    const original = await db.db
      .collection<Receipt>("finance_receipts")
      .findOne({ state: "posted" });
    expect(original).toBeTruthy();
    for (const total of ["0", "-1", "1.5", "1000000000000000000"])
      await expect(
        db.db
          .collection("finance_receipts")
          .updateOne({ _id: original?._id }, { $set: { total: Decimal128.fromString(total) } }),
      ).rejects.toThrow();
    const entry = await db.db.collection("finance_ledger").findOne({ kind: "receipt" });
    await expect(
      db.db.collection("finance_ledger").insertOne({ ...entry, _id: new ObjectId() }),
    ).rejects.toThrow();
    await expect(
      db.db
        .collection("finance_ledger")
        .updateOne({ _id: entry?._id }, { $set: { amount: Decimal128.fromString("-1") } }),
    ).rejects.toThrow();
  });
  test("bounded cursors/filter source/safe ledger and audit privacy", async () => {
    const a = await treasurer.call(`${root()}/receipts?limit=2&state=all`);
    expect(a.payload.data.items.length).toBe(2);
    expect(a.payload.data.items[0].purpose).toBe("Nội dung tài chính riêng synthetic");
    expect(a.payload.data).not.toHaveProperty("totalCount");
    const b = await treasurer.call(
      `${root()}/receipts?limit=2&state=all&cursor=${encodeURIComponent(a.payload.data.nextCursor)}`,
    );
    expect(
      b.payload.data.items.some((i: IncomeRow) =>
        a.payload.data.items.some((j: IncomeRow) => j.id === i.id),
      ),
    ).toBe(false);
    expect(
      (
        await treasurer.call(
          `${root()}/receipts?limit=2&state=posted&cursor=${encodeURIComponent(a.payload.data.nextCursor)}`,
        )
      ).status,
    ).toBe(400);
    expect((await treasurer.call(`${root()}/receipts?limit=101`)).status).toBe(400);
    const ledger = JSON.stringify((await treasurer.call(`${root()}/ledger`)).payload.data);
    for (const secret of ["memberId", "memberName", "givingCode", "Nội dung tài chính riêng"])
      expect(ledger).not.toContain(secret);
    const audits = await db.audits.find({ eventType: { $regex: "^finance\\." } }).toArray();
    expect(audits.length).toBeGreaterThan(0);
    expect(JSON.stringify(audits)).not.toContain("Nội dung tài chính riêng");
    expect(JSON.stringify(logs)).not.toContain("9007199254740993");
  });
});
interface IncomeRow {
  id: string;
}
