import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { Decimal128, ObjectId } from "mongodb";
import { createApp } from "../../api/app";
import { config } from "../../api/config";
import { AppError } from "../../api/errors";
import { Finance } from "../../api/finance/service";
import { Identity } from "../../api/identity/service";
import { Database, initialize } from "../../api/infrastructure/database";
import { RateLimit } from "../../api/infrastructure/rate-limit";
import {
  localOnly,
  SyntheticClient,
  syntheticOwner,
  syntheticUser,
} from "../../scripts/p2-fixtures";
import { financeChurch, financeRoot } from "../../scripts/p51-fixtures";

const conf = {
  ...config(),
  origin: "https://localhost:3497",
  database: `church_cms_test_p54_${crypto.randomUUID().replaceAll("-", "")}`,
  csrfKey: crypto.randomUUID() + crypto.randomUUID(),
};
localOnly(conf);
let offset = 0;
const db = new Database(conf),
  rate = new RateLimit(conf.redisUrl, conf.csrfKey),
  logs: object[] = [];
let app: ReturnType<typeof createApp>,
  owner: SyntheticClient,
  p: SyntheticClient,
  p2: SyntheticClient,
  s: SyntheticClient,
  s2: SyntheticClient,
  t: SyntheticClient,
  t2: SyntheticClient,
  l: SyntheticClient,
  l2: SyntheticClient,
  m: SyntheticClient,
  c: Awaited<ReturnType<typeof financeChurch>>,
  other: Awaited<ReturnType<typeof financeChurch>>,
  fundId: string;
const client = (realm: "owner" | "church" = "church") => {
  const ip = crypto.randomUUID();
  return new SyntheticClient(realm, conf.origin, (req) => app(req, { ip }));
};
const root = () => `${financeRoot(c)}/expense-proposals`,
  draft = (x: object = {}) => ({
    submissionId: crypto.randomUUID(),
    fundId,
    amount: "9007199254740993",
    purpose: "Mục đích chi riêng synthetic",
    ...x,
  });
async function setConfig(
  approverRole = "pastor",
  proposerRoles = ["secretary", "treasurer", "ministry_lead"],
) {
  const before = await p.call(`${financeRoot(c)}/settings`);
  const r = await p.call(
    `${financeRoot(c)}/settings`,
    { approverRole, proposerRoles },
    {
      method: before.payload.data.configured ? "PATCH" : "POST",
      version: before.payload.data.settings?.version,
    },
  );
  expect([200, 201]).toContain(r.status);
  return r;
}
async function submit(who = s, x: object = {}) {
  const b = draft(x),
    preview = await who.call(`${root()}/preview`, b);
  expect(preview.status).toBe(200);
  const body = { proposal: b, previewToken: preview.payload.data.previewToken },
    r = await who.call(root(), body);
  expect(r.status, r.payload.error?.code).toBe(201);
  return { id: r.payload.data.proposalId as string, b, body, r };
}
async function decide(
  id: string,
  action: "approved" | "rejected" = "approved",
  who = p,
  reason = "Kiểm chứng synthetic",
  version = 1,
) {
  const b = { decision: action, reason },
    preview = await who.call(`${root()}/${id}/preview`, b, { version });
  expect(preview.status).toBe(200);
  const body = { decision: b, previewToken: preview.payload.data.previewToken },
    r = await who.call(`${root()}/${id}/decision`, body, { version });
  return { r, body };
}
beforeAll(async () => {
  await db.client.connect();
  await initialize(db.db);
  await rate.connect();
  const identity = new Identity(db, rate, conf, () => new Date(Date.now() + offset));
  await identity.initialize();
  app = createApp(identity, conf, { log: (r) => logs.push(r) });
  owner = client("owner");
  await syntheticOwner(db, owner);
  c = await financeChurch(owner, "P54 contracts");
  other = await financeChurch(owner, "P54 other");
  [p, p2, s, s2, t, t2, l, l2, m] = [
    client(),
    client(),
    client(),
    client(),
    client(),
    client(),
    client(),
    client(),
    client(),
  ];
  for (const [who, role] of [
    [p, "pastor"],
    [p2, "pastor"],
    [s, "secretary"],
    [s2, "secretary"],
    [t, "treasurer"],
    [t2, "treasurer"],
    [l, "ministry_lead"],
    [l2, "ministry_lead"],
    [m, "member"],
  ] as const)
    await syntheticUser(owner, who, c, role, [c.unitId]);
  const f = await p.call(`${financeRoot(c)}/funds`, { name: "Quỹ P54 synthetic" });
  fundId = f.payload.data.fundId;
});
afterAll(async () => {
  await db.db.dropDatabase();
  expect(
    (await db.db.admin().listDatabases()).databases.some((d) => d.name === conf.database),
  ).toBe(false);
  await db.client.close();
  if (rate.client.isOpen) rate.client.destroy();
});
async function receipt(amount: string, fund = fundId, day?: string) {
  const b = {
    submissionId: crypto.randomUUID(),
    businessDate:
      day ??
      new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Ho_Chi_Minh",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date(Date.now() + offset)),
    fundId: fund,
    sourceReference: `P54-${crypto.randomUUID()}`,
    purpose: "Thu synthetic",
    mode: "aggregate",
    amount,
  };
  const pre = await t.call(`${financeRoot(c)}/receipts/preview`, b);
  expect(pre.status).toBe(200);
  const r = await t.call(`${financeRoot(c)}/receipts`, {
    receipt: b,
    previewToken: pre.payload.data.previewToken,
  });
  expect(r.status).toBe(201);
  return r.payload.data.receiptId as string;
}
async function approved(amount = "100", who = s, fund = fundId) {
  const r = await submit(who, { amount, fundId: fund });
  expect((await decide(r.id)).r.status).toBe(200);
  return r.id;
}
async function previewPay(id: string, who = t, submissionId = crypto.randomUUID()) {
  const b = { submissionId },
    r = await who.call(`${root()}/${id}/payment-preview`, b, { version: 2 });
  return { r, b };
}
async function pay(id: string, who = t) {
  const { r, b } = await previewPay(id, who);
  expect(r.status).toBe(200);
  const body = { payment: b, previewToken: r.payload.data.previewToken, confirmed: true };
  const key = crypto.randomUUID();
  return { r: await who.call(`${root()}/${id}/payment`, body, { version: 2, key }), body, key };
}
async function newFund() {
  const r = await p.call(`${financeRoot(c)}/funds`, { name: `Quỹ P54 ${crypto.randomUUID()}` });
  expect(r.status).toBe(201);
  return r.payload.data.fundId as string;
}
const paymentRoot = () => `${financeRoot(c)}/payments`;
describe("P54 payment/book public contracts", () => {
  test("explicit rights and empty book; only treasurer pay, owner and unrelated tenant deny", async () => {
    await setConfig();
    const id = await approved();
    expect((await previewPay(id)).r.payload.error.code).toBe("FINANCE_INSUFFICIENT_BALANCE");
    for (const who of [p, s, l, m]) expect((await previewPay(id, who)).r.status).toBe(403);
    expect(
      (
        await owner.call(
          `owner/${root()}/${id}/payment-preview`,
          { submissionId: crypto.randomUUID() },
          { version: 2 },
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await t.call(
          `churches/${other.id}/finance/expense-proposals/${id}/payment-preview`,
          { submissionId: crypto.randomUUID() },
          { version: 2 },
        )
      ).status,
    ).toBe(403);
    expect((await t.call(`${root()}/context`)).payload.data.canPay).toBe(true);
    expect((await s.call(`${root()}/context`)).payload.data.canPay).toBe(false);
  });
  test("full exact >2^53 amount: preview/confirm/PC/negative ledger/paid atomic; minimal own view", async () => {
    const fund = await newFund();
    await receipt("9007199254740993", fund);
    const id = await approved("9007199254740993", s, fund),
      r = await pay(id);
    expect(r.r.status).toBe(201);
    const pid = r.r.payload.data.paymentId,
      detail = await p.call(`${paymentRoot()}/${pid}`);
    expect(detail.status).toBe(200);
    expect(detail.payload.data.amount).toBe("9007199254740993");
    expect(detail.payload.data.code).toMatch(/^PC-/);
    const row = await s.call(`${root()}/${id}`);
    expect(row.payload.data.state).toBe("paid");
    expect(row.payload.data.version).toBe(3);
    expect(row.payload.data.payment.id).toBe(pid);
    expect(row.payload.data).not.toHaveProperty("balance");
    expect(row.payload.data.canReadPayment).toBe(false);
    for (const who of [s, l, m]) {
      expect((await who.call(`${paymentRoot()}/${pid}`)).status).toBe(403);
      expect((await who.call(`${paymentRoot()}/${pid}/history`)).status).toBe(403);
    }
    expect(
      await db.db.collection("finance_payments").countDocuments({ proposalId: new ObjectId(id) }),
    ).toBe(1);
    const ledger = await db.db
      .collection("finance_ledger")
      .findOne({ paymentId: new ObjectId(pid) });
    expect(ledger?.amount.toString()).toBe("-9007199254740993");
    expect(ledger).not.toHaveProperty("receiptId");
    expect((await t.call(`${paymentRoot()}/${pid}/history`)).payload.data.items[0].event).toBe(
      "posted",
    );
    const history = await s.call(`${root()}/${id}/history`);
    expect(history.payload.data.items[0].event).toBe("paid");
    expect(JSON.stringify(history.payload.data)).not.toContain("balance");
    const safe = await db.db.collection("audit_events").find({ targetId: pid }).toArray();
    expect(JSON.stringify(safe)).not.toContain("Mục đích chi riêng");
  });
  test("own treasurer proposal may be paid after another account approves", async () => {
    await receipt("1000");
    const id = await approved("100", t);
    expect((await pay(id)).r.status).toBe(201);
  });
  test("pending/rejected/paid cannot be paid; no standalone arbitrary amount/fund/date", async () => {
    const pending = await submit(s, { amount: "100" }),
      rejected = await submit(s, { amount: "100" });
    await decide(rejected.id, "rejected");
    for (const id of [pending.id, rejected.id])
      expect((await previewPay(id)).r.payload.error.code).toBe("PAYMENT_NOT_APPROVED");
    const id = await approved();
    expect(
      (
        await t.call(
          `${root()}/${id}/payment-preview`,
          { submissionId: crypto.randomUUID(), amount: "1" },
          { version: 2 },
        )
      ).status,
    ).toBe(422);
    expect(
      (
        await t.call(
          `${root()}/${id}/payment-preview`,
          { submissionId: crypto.randomUUID(), businessDate: "2020-01-01" },
          { version: 2 },
        )
      ).status,
    ).toBe(422);
    expect(
      (
        await t.call(
          `${root()}/${id}/payment-preview`,
          { submissionId: crypto.randomUUID() },
          { version: 1 },
        )
      ).status,
    ).toBe(412);
  });
  test("expired preview, missing explicit confirmation and different actor tokens cannot commit", async () => {
    const id = await approved(),
      { r, b } = await previewPay(id);
    expect(r.status).toBe(200);
    expect(
      (
        await t.call(
          `${root()}/${id}/payment`,
          { payment: b, previewToken: r.payload.data.previewToken },
          { version: 2 },
        )
      ).status,
    ).toBe(422);
    expect(
      (
        await t2.call(
          `${root()}/${id}/payment`,
          { payment: b, previewToken: r.payload.data.previewToken, confirmed: true },
          { version: 2 },
        )
      ).payload.error.code,
    ).toBe("PAYMENT_PREVIEW_STALE");
    offset += 301000;
    try {
      expect(
        (
          await t.call(
            `${root()}/${id}/payment`,
            { payment: b, previewToken: r.payload.data.previewToken, confirmed: true },
            { version: 2 },
          )
        ).payload.error.code,
      ).toBe("PAYMENT_PREVIEW_STALE");
    } finally {
      offset -= 301000;
    }
    expect(
      await db.db.collection("finance_payments").countDocuments({ proposalId: new ObjectId(id) }),
    ).toBe(0);
  });
  test("changed book invalidates preview without writing, config reroute preserves valid approval", async () => {
    const id = await approved(),
      { r, b } = await previewPay(id);
    await receipt("1");
    expect(
      (
        await t.call(
          `${root()}/${id}/payment`,
          { payment: b, previewToken: r.payload.data.previewToken, confirmed: true },
          { version: 2 },
        )
      ).payload.error.code,
    ).toBe("PAYMENT_PREVIEW_STALE");
    await setConfig("secretary");
    expect((await pay(id)).r.status).toBe(201);
    await setConfig();
  });
  test("durable exact intent retry survives Operations deletion; other intent and actor cannot duplicate", async () => {
    const id = await approved(),
      x = await pay(id);
    expect(x.r.status).toBe(201);
    const pid = x.r.payload.data.paymentId;
    const replay = await t.call(`${root()}/${id}/payment`, x.body, { version: 2, key: x.key });
    expect(replay.status).toBe(200);
    expect(replay.payload.data.paymentId).toBe(pid);
    const op = await db.db.collection("idempotency_operations").findOne({ "resourceRefs.id": pid });
    expect(op).not.toBeNull();
    if (!op) throw Error("Missing operation fixture");
    expect((await t.call(`${paymentRoot()}/operations/${op._id}`)).status).toBe(200);
    expect((await t2.call(`${paymentRoot()}/operations/${op._id}`)).status).toBe(404);
    expect((await p.call(`${paymentRoot()}/operations/${op._id}`)).status).toBe(403);
    await db.db.collection("idempotency_operations").deleteMany({ "resourceRefs.id": pid });
    const restored = await t.call(`${root()}/${id}/payment`, x.body, { version: 2, key: x.key });
    expect(restored.payload.data.paymentId).toBe(pid);
    expect(restored.payload.data.reconciled).toBe(true);
    expect(
      (await t2.call(`${root()}/${id}/payment`, x.body, { version: 2 })).payload.error.code,
    ).toBe("PAYMENT_ALREADY_POSTED");
    expect(
      (
        await t.call(
          `${root()}/${id}/payment`,
          { ...x.body, payment: { submissionId: crypto.randomUUID() } },
          { version: 2 },
        )
      ).payload.error.code,
    ).toBe("PAYMENT_ALREADY_POSTED");
    expect(
      await db.db.collection("finance_ledger").countDocuments({ paymentId: new ObjectId(pid) }),
    ).toBe(1);
  });
  test("insufficient own fund cannot borrow other fund; deactivated fund blocks payment", async () => {
    const f = await newFund(),
      id = await approved("100", s, f);
    expect((await previewPay(id)).r.payload.error.code).toBe("FINANCE_INSUFFICIENT_BALANCE");
    await receipt("100", f);
    const before = await p.call(`${financeRoot(c)}/funds/${f}`);
    expect(
      (
        await p.call(
          `${financeRoot(c)}/funds/${f}/status`,
          { status: "inactive", reason: "Synthetic" },
          { method: "PATCH", version: before.payload.data.version },
        )
      ).status,
    ).toBe(200);
    expect((await previewPay(id)).r.payload.error.code).toBe("FINANCE_SOURCE_UNAVAILABLE");
  });
  test("closed period is denied without implicit date shift", async () => {
    const id = await approved(),
      day = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Ho_Chi_Minh",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date()),
      month = day.slice(0, 7);
    await db.db
      .collection("finance_periods")
      .updateOne({ _id: `${c.id}:${month}` as never }, { $set: { state: "closed" } });
    try {
      expect((await previewPay(id)).r.payload.error.code).toBe("FINANCE_PERIOD_CLOSED");
      expect(
        await db.db.collection("finance_payments").countDocuments({ proposalId: new ObjectId(id) }),
      ).toBe(0);
    } finally {
      await db.db
        .collection("finance_periods")
        .updateOne({ _id: `${c.id}:${month}` as never }, { $set: { state: "open" } });
    }
  });
  test("two intents for same proposal only one commits", async () => {
    const id = await approved(),
      a = await previewPay(id, t),
      b = await previewPay(id, t2);
    const rs = await Promise.all(
      [
        [t, a],
        [t2, b],
      ].map(async ([who, pre]) => {
        const v = pre as typeof a;
        return (who as SyntheticClient).call(
          `${root()}/${id}/payment`,
          { payment: v.b, previewToken: v.r.payload.data.previewToken, confirmed: true },
          { version: 2 },
        );
      }),
    );
    expect(rs.filter((r) => r.status === 201)).toHaveLength(1);
    expect(
      await db.db.collection("finance_payments").countDocuments({ proposalId: new ObjectId(id) }),
    ).toBe(1);
  });
  test("two different proposals cannot overspend shared fund; independent funds do not interfere", async () => {
    const f = await newFund();
    await receipt("100", f);
    // Prepare both approved proposals before the payment race; setup contention is not this invariant.
    const ids = [await approved("70", s, f), await approved("70", s2, f)],
      pre = await Promise.all(ids.map((id) => previewPay(id)));
    const rs = await Promise.all(
      ids.map((id, i) =>
        t.call(
          `${root()}/${id}/payment`,
          {
            payment: pre[i]?.b,
            previewToken: pre[i]?.r.payload.data.previewToken,
            confirmed: true,
          },
          { version: 2 },
        ),
      ),
    );
    expect(rs.filter((r) => r.status === 201)).toHaveLength(1);
    const sum = await t.call(`${financeRoot(c)}/ledger?fundId=${f}`);
    expect(sum.payload.data.closingBalance).toBe("30");
  });
  test("voiding income cannot make current fund negative, including concurrent pay/void", async () => {
    const f = await newFund(),
      rid = await receipt("100", f),
      id = await approved("70", s, f);
    expect((await pay(id)).r.status).toBe(201);
    expect(
      (
        await t.call(
          `${financeRoot(c)}/receipts/${rid}/void`,
          { reason: "Synthetic", confirmed: true },
          { version: 1 },
        )
      ).payload.error.code,
    ).toBe("FINANCE_INSUFFICIENT_BALANCE");
    expect((await t.call(`${financeRoot(c)}/receipts/${rid}`)).payload.data.state).toBe("posted");
    const f2 = await newFund(),
      r2 = await receipt("100", f2),
      i2 = await approved("70", s, f2),
      pre = await previewPay(i2);
    const rs = await Promise.all([
      t.call(
        `${root()}/${i2}/payment`,
        { payment: pre.b, previewToken: pre.r.payload.data.previewToken, confirmed: true },
        { version: 2 },
      ),
      t2.call(
        `${financeRoot(c)}/receipts/${r2}/void`,
        { reason: "Race", confirmed: true },
        { version: 1 },
      ),
    ]);
    expect(rs.filter((r) => r.status === 201 || r.status === 200)).toHaveLength(1);
    const book = await t.call(`${financeRoot(c)}/ledger?fundId=${f2}`);
    expect(BigInt(book.payload.data.closingBalance) >= 0n).toBe(true);
  });
  test("rollback after ledger/history failure leaves all business writes absent", async () => {
    const id = await approved(),
      pre = await previewPay(id);
    const spy = spyOn(Finance.prototype, "append").mockImplementation(async () => {
      throw new AppError(503, "DEPENDENCY_UNAVAILABLE");
    });
    try {
      expect(
        (
          await t.call(
            `${root()}/${id}/payment`,
            { payment: pre.b, previewToken: pre.r.payload.data.previewToken, confirmed: true },
            { version: 2 },
          )
        ).status,
      ).toBe(503);
    } finally {
      spy.mockRestore();
    }
    expect(
      await db.db.collection("finance_payments").countDocuments({ proposalId: new ObjectId(id) }),
    ).toBe(0);
    expect(
      await db.db.collection("finance_ledger").countDocuments({ proposalId: new ObjectId(id) }),
    ).toBe(0);
    expect((await s.call(`${root()}/${id}`)).payload.data.state).toBe("approved");
  });
  test("mixed ledger sums retain income semantics; type/code filters and paging don't change totals", async () => {
    const f = await newFund();
    await receipt("1000", f);
    const id = await approved("300", s, f),
      x = await pay(id);
    expect(x.r.status).toBe(201);
    const full = await t.call(`${financeRoot(c)}/ledger?fundId=${f}&limit=1`);
    expect(full.payload.data.netIncome).toBe("1000");
    expect(full.payload.data.netExpense).toBe("300");
    expect(full.payload.data.closingBalance).toBe("700");
    expect(full.payload.data.items).toHaveLength(1);
    const next = await t.call(
      `${financeRoot(c)}/ledger?fundId=${f}&limit=1&cursor=${encodeURIComponent(full.payload.data.nextCursor)}`,
    );
    expect(next.status).toBe(200);
    expect(next.payload.data.items[0].id).not.toBe(full.payload.data.items[0].id);
    const typed = await t.call(`${financeRoot(c)}/ledger?fundId=${f}&kind=payment&q=PC-`);
    expect(typed.payload.data.items).toHaveLength(1);
    expect(typed.payload.data.netIncome).toBe("1000");
    expect(typed.payload.data.netExpense).toBe("300");
    expect(typed.payload.data.items[0].receiptId).toBeNull();
    expect(typed.payload.data.items[0].proposalCode).toMatch(/^DX-/);
    expect(JSON.stringify(typed.payload.data)).not.toContain("Mục đích chi riêng");
    expect(
      (
        await t.call(
          `${financeRoot(c)}/ledger?fundId=${f}&kind=payment&cursor=${encodeURIComponent(full.payload.data.nextCursor)}`,
        )
      ).status,
    ).toBe(400);
    const receipts = await t.call(`${financeRoot(c)}/receipts?fundId=${f}`);
    expect(receipts.payload.data.netIncome).toBe("1000");
    expect(receipts.payload.data.netExpense).toBe("300");
  });
  test("database uniqueness and validators prevent mixed source/paid without link/positive debit", async () => {
    const payment = await db.db
      .collection("finance_payments")
      .findOne({ churchId: new ObjectId(c.id) });
    expect(payment).not.toBeNull();
    if (!payment) throw Error("Missing payment fixture");
    await expect(
      db.db
        .collection("finance_payments")
        .insertOne({ ...payment, _id: new ObjectId(), code: "PC-DUP" }),
    ).rejects.toThrow();
    const led = await db.db.collection("finance_ledger").findOne({ paymentId: payment._id });
    expect(led).not.toBeNull();
    if (!led) throw Error("Missing ledger fixture");
    await expect(
      db.db.collection("finance_ledger").insertOne({
        ...led,
        _id: new ObjectId(),
        paymentId: new ObjectId(),
        amount: Decimal128.fromString("1"),
      }),
    ).rejects.toThrow();
    await expect(
      db.db.collection("finance_ledger").insertOne({
        ...led,
        _id: new ObjectId(),
        paymentId: new ObjectId(),
        receiptId: new ObjectId(),
      }),
    ).rejects.toThrow();
    const id = await approved();
    await expect(
      db.db
        .collection("finance_expense_proposals")
        .updateOne({ _id: new ObjectId(id) }, { $set: { state: "paid", version: 3 } }),
    ).rejects.toThrow();
  });
  test("opening/closing are cumulative book values, not a manually seeded balance", async () => {
    const f = await newFund(),
      old = new Date();
    old.setUTCMonth(old.getUTCMonth() - 1);
    const day = `${old.toISOString().slice(0, 7)}-01`;
    await receipt("500", f, day);
    const id = await approved("100", s, f);
    expect((await pay(id)).r.status).toBe(201);
    const now = await t.call(`${financeRoot(c)}/ledger?fundId=${f}`);
    expect(now.payload.data.openingBalance).toBe("500");
    expect(now.payload.data.netIncome).toBe("0");
    expect(now.payload.data.netExpense).toBe("100");
    expect(now.payload.data.closingBalance).toBe("400");
    const prior = await t.call(`${financeRoot(c)}/ledger?fundId=${f}&period=${day.slice(0, 7)}`);
    expect(prior.payload.data.netIncome).toBe("500");
    expect(prior.payload.data.netExpense).toBe("0");
    expect(prior.payload.data.closingBalance).toBe("500");
  });
  test("fresh permission revoke denies operation lookup and replay after a new session", async () => {
    const who = client(),
      account = await syntheticUser(owner, who, c, "treasurer"),
      id = await approved(),
      x = await pay(id, who);
    expect(x.r.status).toBe(201);
    const operationId = x.r.payload.data.operationId,
      record = await owner.call(`owner/churches/${c.id}/accounts/${account.id}`);
    expect(
      (
        await owner.call(
          `owner/churches/${c.id}/accounts/${account.id}/permissions`,
          { role: "pastor", scope: { kind: "church" } },
          { method: "PATCH", version: record.payload.data.version },
        )
      ).status,
    ).toBe(200);
    const fresh = client();
    expect((await fresh.login(account.email, account.password, c.code)).status).toBe(200);
    expect((await fresh.call(`${paymentRoot()}/operations/${operationId}`)).status).toBe(403);
    expect(
      (await fresh.call(`${root()}/${id}/payment`, x.body, { version: 2, key: x.key })).status,
    ).toBe(403);
    expect(
      await db.db.collection("finance_payments").countDocuments({ proposalId: new ObjectId(id) }),
    ).toBe(1);
  });
});

describe("P7.3 approval threshold", () => {
  async function configure(threshold: object | null | undefined, approverRole = "pastor") {
    const path = `${financeRoot(c)}/settings`;
    const before = (await p.call(path)).payload.data.settings;
    const r = await p.call(
      path,
      {
        approverRole,
        proposerRoles: ["ministry_lead", "treasurer"],
        ...(threshold === undefined ? {} : { approvalThreshold: threshold }),
      },
      { method: "PATCH", version: before.version },
    );
    expect(r.status).toBe(200);
    return (await p.call(path)).payload.data.settings;
  }
  const scope = (who: SyntheticClient, view = "review", extra = "") =>
    who.call(`${root()}?scope=${view}${extra}`);
  const data = async (who: SyntheticClient, id: string) =>
    (await who.call(`${root()}/${id}`)).payload.data;

  test("73-01–03: versioned routing, case ACL, atomic decision and attached payment", async () => {
    await configure(null);
    const fundId = await newFund();
    const filter = `&fundId=${fundId}`;
    const base = { fundId };
    await receipt("30000000", fundId);
    const legacy = await submit(l, { ...base, amount: "123" });
    const stale = draft({ ...base, amount: "4999999" });
    const oldPreview = (await l.call(`${root()}/preview`, stale)).payload.data.previewToken;
    const threshold = { amount: "5000000", belowRole: "secretary", atOrAboveRole: "pastor" };
    const config = await configure(threshold);
    const settingsPath = `${financeRoot(c)}/settings`;
    for (const [amount, belowRole] of [
      ["0", "secretary"],
      ["2.5", "secretary"],
      ["5000000", "owner"],
    ]) {
      expect(
        (
          await p.call(
            settingsPath,
            {
              approverRole: "pastor",
              proposerRoles: ["ministry_lead"],
              approvalThreshold: { ...threshold, amount, belowRole },
            },
            { method: "PATCH", version: config.version },
          )
        ).status,
      ).toBe(422);
    }
    expect(
      (
        await t.call(
          settingsPath,
          {
            approverRole: "pastor",
            proposerRoles: [],
            approvalThreshold: threshold,
          },
          { method: "PATCH", version: config.version },
        )
      ).status,
    ).toBe(403);
    expect((await l.call(root(), { proposal: stale, previewToken: oldPreview })).status).toBe(409);

    const { default: sharp } = await import("sharp");
    const image = await sharp({
      create: {
        width: 120,
        height: 80,
        channels: 3,
        background: "#fff5dc",
      },
    })
      .png()
      .toBuffer();
    const upload = await l.call(`${root()}/attachments`, image, {
      headers: { "content-type": "image/png" },
    });
    expect(upload.status).toBe(201);
    const below = await submit(l, {
      ...base,
      amount: "4999999",
      attachmentId: upload.payload.data.id,
    });
    const exact = await submit(l, { ...base, amount: "5000000" });
    const above = await submit(l, {
      ...base,
      amount: "5000001",
      attachmentId: (
        await l.call(`${root()}/attachments`, image, { headers: { "content-type": "image/png" } })
      ).payload.data.id,
    });
    for (const [id, band, approver] of [
      [below.id, "below", "secretary"],
      [exact.id, "at_or_above", "pastor"],
      [above.id, "at_or_above", "pastor"],
    ] as const) {
      const row = await data(p, id);
      expect(row.approvalBand).toBe(band);
      expect(row.currentApproverRole).toBe(approver);
      expect(row.approvalRuleVersion).toBe(config.version);
    }
    const only = await s.call(`${root()}/context`);
    expect(only.payload.data).toMatchObject({
      canReadAll: false,
      canReadOwn: false,
      canDecide: true,
      canSubmit: false,
    });
    const queue = await scope(s, "review", filter);
    expect(queue.payload.data.items.map((r: { id: string }) => r.id)).toEqual([below.id]);
    expect(queue.payload.data.summary.pending).toEqual({ count: 1, total: "4999999" });
    expect((await scope(s, "all", filter)).status).toBe(403);
    expect((await s.call(`${root()}/funds`)).status).toBe(403);
    expect(
      (await scope(s, "review", `${filter}&q=${(await data(p, above.id)).code}`)).payload.data
        .items,
    ).toEqual([]);
    expect((await s.call(`${root()}/${above.id}`)).status).toBe(404);
    expect((await s.call(`${root()}/${above.id}/history`)).status).toBe(404);
    expect((await s.call(`${root()}/${above.id}/attachment`)).status).toBe(404);
    const allowed = await app(
      new Request(`${conf.origin}/api/v1/${root()}/${below.id}/attachment`, {
        headers: { cookie: s.cookie() },
      }),
      { ip: crypto.randomUUID() },
    );
    expect(allowed.status).toBe(200);
    expect(allowed.headers.get("content-type")).toBe("image/png");
    expect(new Uint8Array(await allowed.arrayBuffer()).length).toBeGreaterThan(0);

    const self = await submit(p, { ...base, amount: "5000000" });
    const decision = { decision: "approved", reason: "" };
    const selfResult = await p.call(`${root()}/${self.id}/preview`, decision, { version: 1 });
    expect(selfResult.payload.error.code).toBe("EXPENSE_SELF_DECISION");
    expect(
      (await scope(p, "review", filter)).payload.data.items.some(
        (r: { id: string }) => r.id === self.id,
      ),
    ).toBe(false);
    expect((await p.call(`${root()}/${below.id}/preview`, decision, { version: 1 })).status).toBe(
      403,
    );

    const next = { amount: "9007199254740993", belowRole: "treasurer", atOrAboveRole: "pastor" };
    const changed = await configure(next, "secretary");
    expect(changed.version).toBeGreaterThan(config.version);
    expect((await data(s, legacy.id)).currentApproverRole).toBe("secretary");
    expect((await data(s, below.id)).currentApproverRole).toBe("secretary");
    expect((await s.call(`${root()}/${exact.id}`)).status).toBe(404);
    expect(
      (await scope(s, "all", filter)).payload.data.items.map((r: { id: string }) => r.id).sort(),
    ).toEqual([legacy.id, below.id].sort());
    expect((await configure(undefined, "treasurer")).approvalThreshold).toEqual(next);
    for (const [amount, role] of [
      ["9007199254740992", "treasurer"],
      ["9007199254740993", "pastor"],
    ]) {
      const v = await l.call(`${root()}/preview`, draft({ ...base, amount }));
      expect(v.payload.data.approverRole).toBe(role);
    }
    const unfunded = await submit(l, { ...base, amount: "40000000" });
    expect((await decide(unfunded.id, "approved", t)).r.status).toBe(200);
    expect((await previewPay(unfunded.id)).r.payload.error.code).toBe(
      "FINANCE_INSUFFICIENT_BALANCE",
    );
    const fresh = await submit(l, { ...base, amount: "90" });
    expect((await data(t, fresh.id)).currentApproverRole).toBe("treasurer");
    await configure(null, "pastor");
    const off = await submit(l, { ...base, amount: "91" });
    expect(await data(p, off.id)).toMatchObject({
      approvalRuleVersion: null,
      currentApproverRole: "pastor",
    });
    expect((await data(s, below.id)).currentApproverRole).toBe("secretary");
    expect((await data(t, fresh.id)).currentApproverRole).toBe("treasurer");

    const revoker = client();
    const removed = await syntheticUser(owner, revoker, c, "secretary");
    const revokePreview = (
      await revoker.call(`${root()}/${below.id}/preview`, decision, { version: 1 })
    ).payload.data.previewToken;
    await db.db.collection("accounts").updateOne(
      { _id: new ObjectId(removed.id) },
      {
        $set: { role: "ministry_lead", scope: { kind: "assigned_units", unitIds: [c.unitId] } },
        $inc: { version: 1 },
      },
    );
    expect(
      (
        await revoker.call(
          `${root()}/${below.id}/decision`,
          {
            decision,
            previewToken: revokePreview,
          },
          { version: 1 },
        )
      ).status,
    ).toBeGreaterThanOrEqual(400);
    expect((await data(p, below.id)).state).toBe("pending");

    const previews = await Promise.all(
      [s, s2].map((who) => who.call(`${root()}/${below.id}/preview`, decision, { version: 1 })),
    );
    expect(previews.every(({ status }) => status === 200)).toBe(true);
    const decided = await Promise.all(
      [s, s2].map((who, i) =>
        who.call(
          `${root()}/${below.id}/decision`,
          {
            decision,
            previewToken: previews[i]?.payload.data.previewToken,
          },
          { version: 1 },
        ),
      ),
    );
    expect(decided.map(({ status }) => status).sort()).toEqual([200, 412]);
    expect((await data(s, below.id)).decision.actorRole).toBe("secretary");
    expect((await scope(s, "review", filter)).payload.data.summary.pending.count).toBe(0);

    const payment = await pay(below.id);
    expect(payment.r.status).toBe(201);
    expect(
      (
        await t.call(`${root()}/${below.id}/payment`, payment.body, {
          version: 2,
          key: payment.key,
        })
      ).status,
    ).toBe(200);
    const pid = new ObjectId(payment.r.payload.data.paymentId);
    expect(
      await db.db
        .collection("finance_payments")
        .countDocuments({ proposalId: new ObjectId(below.id) }),
    ).toBe(1);
    const row = await db.db.collection("finance_ledger").findOne({ paymentId: pid });
    expect(row?.amount.toString()).toBe("-4999999");
    const ledger = await t.call(`${financeRoot(c)}/ledger?fundId=${fundId}&kind=payment`);
    expect(ledger.status).toBe(200);
    expect(ledger.payload.data.items).toHaveLength(1);
    expect(ledger.payload.data.items[0].proposalId).toBe(below.id);
    expect(ledger.payload.data.netExpense).toBe("4999999");
    expect(ledger.payload.data.closingBalance).toBe("25000001");
    expect((await data(l, below.id)).hasAttachment).toBe(true);
    expect((await data(l, below.id)).state).toBe("paid");
    expect((await decide(fresh.id, "approved", t)).r.status).toBe(200);
    const month = (await data(p, fresh.id)).businessDate.slice(0, 7);
    await db.db
      .collection("finance_periods")
      .updateOne({ _id: `${c.id}:${month}` as never }, { $set: { state: "closed" } });
    expect((await previewPay(fresh.id)).r.payload.error.code).toBe("FINANCE_PERIOD_CLOSED");
    await db.db
      .collection("finance_periods")
      .updateOne({ _id: `${c.id}:${month}` as never }, { $set: { state: "open" } });
    const currentFund = (await p.call(`${financeRoot(c)}/funds/${fundId}`)).payload.data;
    expect(
      (
        await p.call(
          `${financeRoot(c)}/funds/${fundId}/status`,
          { status: "inactive", reason: "Kiểm thử P7.3" },
          { method: "PATCH", version: currentFund.version },
        )
      ).status,
    ).toBe(200);
    expect((await previewPay(fresh.id)).r.payload.error.code).toBe("FINANCE_SOURCE_UNAVAILABLE");
  });
});
