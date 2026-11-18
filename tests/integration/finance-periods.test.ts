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
  database: `church_cms_test_p55_${crypto.randomUUID().replaceAll("-", "")}`,
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
  expect(r.status).toBe(201);
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
  c = await financeChurch(owner, "P55 contracts");
  other = await financeChurch(owner, "P55 other");
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
  const f = await p.call(`${financeRoot(c)}/funds`, { name: "Quỹ P55 synthetic" });
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
    sourceReference: `P55-${crypto.randomUUID()}`,
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
  const r = await p.call(`${financeRoot(c)}/funds`, { name: `Quỹ P55 ${crypto.randomUUID()}` });
  expect(r.status).toBe(201);
  return r.payload.data.fundId as string;
}
const paymentRoot = () => `${financeRoot(c)}/payments`;
const month = (n = 0) => {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + n);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .format(d)
    .slice(0, 7);
};
const periods = () => `${financeRoot(c)}/periods`,
  voidReason = "Private cancellation synthetic";
async function voidPreview(id: string, who = t, reason = voidReason) {
  return who.call(`${paymentRoot()}/${id}/void-preview`, { reason }, { version: 1 });
}
async function voidPay(id: string, who = t) {
  const pre = await voidPreview(id, who);
  expect(pre.status).toBe(200);
  const body = {
      void: { reason: voidReason },
      previewToken: pre.payload.data.previewToken,
      confirmed: true,
    },
    key = crypto.randomUUID(),
    r = await who.call(`${paymentRoot()}/${id}/void`, body, { version: 1, key });
  return { r, body, key };
}
async function closing(
  root: string,
  who: SyntheticClient,
  target = month(),
  reason = "Khóa synthetic",
) {
  const closure = { submissionId: crypto.randomUUID(), reason },
    pre = await who.call(`${root}/periods/${target}/close-preview`, closure);
  expect(pre.status).toBe(200);
  return {
    closure,
    pre,
    body: {
      closure,
      previewToken: pre.payload.data.previewToken,
      controlVersion: pre.payload.data.controlVersion,
      confirmed: true,
    },
    key: crypto.randomUUID(),
  };
}
async function smallBook(label: string) {
  const church = await financeChurch(owner, `P55 ${label}`),
    pastor = client(),
    treasurer = client(),
    treasurer2 = client();
  await syntheticUser(owner, pastor, church, "pastor");
  const treasurerAccount = await syntheticUser(owner, treasurer, church, "treasurer");
  await syntheticUser(owner, treasurer2, church, "treasurer");
  const root = financeRoot(church);
  expect(
    (
      await pastor.call(`${root}/settings`, {
        proposerRoles: ["treasurer"],
        approverRole: "pastor",
      })
    ).status,
  ).toBe(201);
  const fund = (await pastor.call(`${root}/funds`, { name: "Quỹ synthetic" })).payload.data
    .fundId as string;
  async function income(amount = "1000", day = `${month()}-01`) {
    const receipt = {
        submissionId: crypto.randomUUID(),
        businessDate: day,
        fundId: fund,
        sourceReference: `P55-${crypto.randomUUID()}`,
        purpose: "Synthetic income",
        mode: "aggregate",
        amount,
      },
      pre = await treasurer.call(`${root}/receipts/preview`, receipt);
    expect(pre.status).toBe(200);
    const body = { receipt, previewToken: pre.payload.data.previewToken };
    return { r: await treasurer.call(`${root}/receipts`, body), body };
  }
  async function approvedPayment() {
    const proposal = {
        submissionId: crypto.randomUUID(),
        fundId: fund,
        amount: "100",
        purpose: "Synthetic payment",
      },
      pre = await treasurer.call(`${root}/expense-proposals/preview`, proposal),
      r = await treasurer.call(`${root}/expense-proposals`, {
        proposal,
        previewToken: pre.payload.data.previewToken,
      });
    expect(r.status).toBe(201);
    const id = r.payload.data.proposalId as string,
      decision = { decision: "approved", reason: "Synthetic approve" },
      dp = await pastor.call(`${root}/expense-proposals/${id}/preview`, decision, { version: 1 });
    expect(
      (
        await pastor.call(
          `${root}/expense-proposals/${id}/decision`,
          { decision, previewToken: dp.payload.data.previewToken },
          { version: 1 },
        )
      ).status,
    ).toBe(200);
    const payment = { submissionId: crypto.randomUUID() },
      pp = await treasurer.call(`${root}/expense-proposals/${id}/payment-preview`, payment, {
        version: 2,
      });
    expect(pp.status).toBe(200);
    return { id, body: { payment, previewToken: pp.payload.data.previewToken, confirmed: true } };
  }
  return {
    church,
    pastor,
    treasurer,
    treasurer2,
    treasurerAccount,
    root,
    fund,
    income,
    approvedPayment,
  };
}
describe("P55 close cutline and full payment reversal", () => {
  test("GET/preview don't seed finance; role/tenant/owner and strict close payload", async () => {
    await setConfig();
    const read = await t.call(`${periods()}/${month()}`);
    expect(read.status).toBe(200);
    expect(read.payload.data.inspection.matches).toBe(true);
    expect(read.payload.data.inspection.summary.closingBalance).toBe("0");
    expect(read.payload.data.closedThrough).toBeNull();
    const pre = await closing(financeRoot(c), t);
    expect(pre.pre.payload.data.controlVersion).toBe(0);
    expect(await db.db.collection("finance_book_controls").countDocuments()).toBe(0);
    expect(await db.db.collection("finance_periods").countDocuments()).toBe(0);
    for (const who of [s, l, m])
      expect((await who.call(`${periods()}/${month()}`)).status).toBe(403);
    expect((await owner.call(`owner/${periods()}/${month()}`)).status).toBe(403);
    expect((await t.call(`churches/${other.id}/finance/periods/${month()}`)).status).toBe(403);
    expect((await p.call(`${periods()}/${month()}/close-preview`, pre.closure)).status).toBe(403);
    expect(
      (await t.call(`${periods()}/${month(1)}/close-preview`, pre.closure)).payload.error.code,
    ).toBe("FINANCE_FUTURE_PERIOD");
    expect((await t.call(`${periods()}/2026-13`)).status).toBe(400);
    expect(
      (await t.call(`${periods()}/${month()}/close-preview`, { ...pre.closure, reason: " " }))
        .status,
    ).toBe(422);
    expect(
      (await t.call(`${periods()}/${month()}/close`, { ...pre.body, confirmed: false })).status,
    ).toBe(422);
  });
  test("whole reversal exact money retains snapshots and minimal own projection, never adds income", async () => {
    const fund = await newFund();
    await receipt("9007199254740993", fund);
    const proposal = await approved("9007199254740993", s, fund),
      paid = await pay(proposal);
    expect(paid.r.status).toBe(201);
    const id = paid.r.payload.data.paymentId,
      original = (await p.call(`${paymentRoot()}/${id}`)).payload.data;
    const x = await voidPay(id);
    expect(x.r.status).toBe(200);
    const detail = (await p.call(`${paymentRoot()}/${id}`)).payload.data;
    expect(detail.state).toBe("voided");
    expect(detail.version).toBe(2);
    expect(detail.amount).toBe(original.amount);
    expect(detail.purpose).toBe(original.purpose);
    expect(detail.decision).toEqual(original.decision);
    expect(detail.voidReason).toBe(voidReason);
    expect(detail.canVoid).toBe(false);
    const own = (await s.call(`${root()}/${proposal}`)).payload.data;
    expect(own.state).toBe("payment_voided");
    expect(own.version).toBe(4);
    expect(own.payment.id).toBe(id);
    expect(own.payment.voidedAt).not.toBeNull();
    expect(JSON.stringify(own)).not.toContain(voidReason);
    const history = await s.call(`${root()}/${proposal}/history`);
    expect(history.payload.data.items[0].event).toBe("payment_voided");
    expect(JSON.stringify(history.payload.data)).not.toContain(voidReason);
    expect(JSON.stringify(history.payload.data)).not.toContain("balance");
    const ledger = (await t.call(`${financeRoot(c)}/ledger?fundId=${fund}`)).payload.data;
    expect(ledger.netIncome).toBe("9007199254740993");
    expect(ledger.netExpense).toBe("0");
    expect(ledger.closingBalance).toBe("9007199254740993");
    expect(ledger.items.filter((r: { kind: string }) => r.kind === "payment_void")).toHaveLength(1);
    const minimal = await l.call(`${paymentRoot()}/${id}`);
    expect(minimal.status).toBe(403);
    expect(
      (
        await t.call(
          `${root()}/${proposal}/payment-preview`,
          { submissionId: crypto.randomUUID() },
          { version: 2 },
        )
      ).payload.error.code,
    ).toBe("PAYMENT_NOT_APPROVED");
    expect(
      await db.db
        .collection("finance_payments")
        .countDocuments({ proposalId: new ObjectId(proposal) }),
    ).toBe(1);
    expect(
      (await t.call(`${root()}?state=payment_voided`)).payload.data.items.some(
        (r: { id: string }) => r.id === proposal,
      ),
    ).toBe(true);
  });
  test("void reason/actor/version/expiry and changed book are checked before writing", async () => {
    await receipt("10000");
    const proposal = await approved(),
      paid = await pay(proposal),
      id = paid.r.payload.data.paymentId;
    for (const who of [p, s, l, m]) expect((await voidPreview(id, who)).status).toBe(403);
    expect((await voidPreview(id, t, " ")).status).toBe(422);
    expect(
      (
        await t.call(
          `${paymentRoot()}/${id}/void-preview`,
          { reason: "x", amount: "1" },
          { version: 1 },
        )
      ).status,
    ).toBe(422);
    expect(
      (await t.call(`${paymentRoot()}/${id}/void-preview`, { reason: "x" }, { version: 2 })).status,
    ).toBe(412);
    const pre = await voidPreview(id),
      body = {
        void: { reason: voidReason },
        previewToken: pre.payload.data.previewToken,
        confirmed: true,
      };
    expect(
      (await t2.call(`${paymentRoot()}/${id}/void`, body, { version: 1 })).payload.error.code,
    ).toBe("PAYMENT_PREVIEW_STALE");
    offset += 301000;
    try {
      expect(
        (await t.call(`${paymentRoot()}/${id}/void`, body, { version: 1 })).payload.error.code,
      ).toBe("PAYMENT_PREVIEW_STALE");
    } finally {
      offset -= 301000;
    }
    await receipt("1");
    expect(
      (await t.call(`${paymentRoot()}/${id}/void`, body, { version: 1 })).payload.error.code,
    ).toBe("PAYMENT_PREVIEW_STALE");
    expect((await t.call(`${paymentRoot()}/${id}`)).payload.data.state).toBe("posted");
  });
  test("durable void replay and original create replay never reopen or duplicate", async () => {
    const proposal = await approved(),
      paid = await pay(proposal),
      id = paid.r.payload.data.paymentId,
      x = await voidPay(id);
    expect(x.r.status).toBe(200);
    expect(
      (await t.call(`${paymentRoot()}/${id}/void`, x.body, { key: x.key, version: 1 })).status,
    ).toBe(200);
    await db.db.collection("idempotency_operations").deleteMany({ "resourceRefs.id": id });
    const replay = await t.call(`${paymentRoot()}/${id}/void`, x.body, { key: x.key, version: 1 });
    expect(replay.payload.data.reconciled).toBe(true);
    expect(
      (await t2.call(`${paymentRoot()}/${id}/void`, x.body, { version: 1 })).payload.error.code,
    ).toBe("PAYMENT_ALREADY_VOIDED");
    expect(
      (await t.call(`${root()}/${proposal}/payment`, paid.body, { key: paid.key, version: 2 }))
        .payload.data.paymentId,
    ).toBe(id);
    expect((await s.call(`${root()}/${proposal}`)).payload.data.state).toBe("payment_voided");
    expect(
      await db.db
        .collection("finance_ledger")
        .countDocuments({ paymentId: new ObjectId(id), kind: "payment_void" }),
    ).toBe(1);
  });
  test("two treasurers can reverse only once; history failure rolls back all layers", async () => {
    const proposal = await approved(),
      paid = await pay(proposal),
      id = paid.r.payload.data.paymentId,
      a = await voidPreview(id, t),
      b = await voidPreview(id, t2);
    const rs = await Promise.all(
      [
        [t, a],
        [t2, b],
      ].map(([who, pre]) =>
        (who as SyntheticClient).call(
          `${paymentRoot()}/${id}/void`,
          {
            void: { reason: voidReason },
            previewToken: (pre as typeof a).payload.data.previewToken,
            confirmed: true,
          },
          { version: 1 },
        ),
      ),
    );
    expect(rs.filter((r) => r.status === 200)).toHaveLength(1);
    const other = await approved(),
      pay2 = await pay(other),
      id2 = pay2.r.payload.data.paymentId,
      pre = await voidPreview(id2),
      spy = spyOn(Finance.prototype, "append").mockImplementation(async () => {
        throw new AppError(503, "DEPENDENCY_UNAVAILABLE");
      });
    try {
      expect(
        (
          await t.call(
            `${paymentRoot()}/${id2}/void`,
            {
              void: { reason: voidReason },
              previewToken: pre.payload.data.previewToken,
              confirmed: true,
            },
            { version: 1 },
          )
        ).status,
      ).toBe(503);
    } finally {
      spy.mockRestore();
    }
    expect((await s.call(`${root()}/${other}`)).payload.data.state).toBe("paid");
    expect((await t.call(`${paymentRoot()}/${id2}`)).payload.data.state).toBe("posted");
    expect(
      await db.db
        .collection("finance_ledger")
        .countDocuments({ paymentId: new ObjectId(id2), kind: "payment_void" }),
    ).toBe(0);
  });
  test("inactive fund allows reversal; legacy closed period still refuses it", async () => {
    const fund = await newFund();
    await receipt("500", fund);
    const proposal = await approved("100", s, fund),
      paid = await pay(proposal),
      id = paid.r.payload.data.paymentId,
      f = (await p.call(`${financeRoot(c)}/funds/${fund}`)).payload.data;
    expect(
      (
        await p.call(
          `${financeRoot(c)}/funds/${fund}/status`,
          { status: "inactive", reason: "Synthetic" },
          { method: "PATCH", version: f.version },
        )
      ).status,
    ).toBe(200);
    expect((await voidPay(id)).r.status).toBe(200);
    const prop2 = await approved(),
      pay2 = await pay(prop2),
      pid = pay2.r.payload.data.paymentId;
    await db.db
      .collection("finance_periods")
      .updateOne({ _id: `${c.id}:${month()}` as never }, { $set: { state: "closed" } });
    try {
      expect((await voidPreview(pid)).payload.error.code).toBe("FINANCE_PERIOD_CLOSED");
      expect((await t.call(`${paymentRoot()}/${pid}`)).payload.data.canVoid).toBe(false);
    } finally {
      await db.db
        .collection("finance_periods")
        .updateOne({ _id: `${c.id}:${month()}` as never }, { $set: { state: "open" } });
    }
  });
  test("reconciliation detects a wrong debit and an orphan, blocks close, then reads restored fixtures", async () => {
    const proposal = await approved(),
      paid = await pay(proposal),
      id = new ObjectId(paid.r.payload.data.paymentId),
      entry = await db.db.collection("finance_ledger").findOne({ paymentId: id, kind: "payment" });
    expect(entry).not.toBeNull();
    if (!entry) throw Error("Fixture missing");
    await db.db
      .collection("finance_ledger")
      .updateOne({ _id: entry._id }, { $set: { amount: Decimal128.fromString("-101") } });
    try {
      const read = await t.call(`${periods()}/${month()}`);
      expect(read.payload.data.inspection.matches).toBe(false);
      expect(read.payload.data.inspection.issues.payments.count).toBeGreaterThan(0);
      expect((await voidPreview(id.toHexString())).payload.error.code).toBe(
        "PAYMENT_PROPOSAL_CONFLICT",
      );
      expect(
        (
          await t.call(`${periods()}/${month()}/close-preview`, {
            submissionId: crypto.randomUUID(),
            reason: "Must block",
          })
        ).payload.error.code,
      ).toBe("FINANCE_RECONCILIATION_FAILED");
    } finally {
      await db.db
        .collection("finance_ledger")
        .updateOne({ _id: entry._id }, { $set: { amount: entry.amount } });
    }
    const orphan = {
      ...entry,
      _id: new ObjectId(),
      paymentId: new ObjectId(),
      paymentCode: "PC-ORPHAN",
    };
    await db.db.collection("finance_ledger").insertOne(orphan);
    try {
      expect(
        (await t.call(`${periods()}/${month()}`)).payload.data.inspection.issues.ledger.count,
      ).toBeGreaterThan(0);
    } finally {
      await db.db.collection("finance_ledger").deleteOne({ _id: orphan._id });
    }
    expect((await t.call(`${periods()}/${month()}`)).payload.data.inspection.matches).toBe(true);
  });
  test("empty prefix close creates one KS, no period docs; durable retry/current ACL", async () => {
    const b = await smallBook("empty"),
      target = month(-1),
      pre = await closing(b.root, b.treasurer, target);
    expect(
      await db.db
        .collection("finance_book_controls")
        .countDocuments({ _id: new ObjectId(b.church.id) }),
    ).toBe(0);
    const r = await b.treasurer.call(`${b.root}/periods/${target}/close`, pre.body, {
      key: pre.key,
    });
    expect(r.status).toBe(201);
    const cid = r.payload.data.closureId;
    expect(
      (await b.pastor.call(`${b.root}/period-closures/${cid}`)).payload.data.summary.closingBalance,
    ).toBe("0");
    expect(
      await db.db
        .collection("finance_periods")
        .countDocuments({ churchId: new ObjectId(b.church.id) }),
    ).toBe(0);
    await db.db.collection("idempotency_operations").deleteMany({ "resourceRefs.id": cid });
    expect(
      (await b.treasurer.call(`${b.root}/periods/${target}/close`, pre.body, { key: pre.key }))
        .payload.data.reconciled,
    ).toBe(true);
    expect(
      (await b.treasurer2.call(`${b.root}/periods/${target}/close`, pre.body)).payload.error.code,
    ).toBe("FINANCE_ALREADY_CLOSED");
    expect(
      (await b.treasurer.call(`${b.root}/periods/${month(-2)}/close-preview`, pre.closure)).payload
        .error.code,
    ).toBe("FINANCE_ALREADY_CLOSED");
    expect((await b.treasurer.call(`${b.root}/periods/${target}/reopen`, {})).status).toBe(404);
    expect(
      (await b.pastor.call(`${b.root}/period-closures/${cid}/history`)).payload.data.items,
    ).toHaveLength(1);
    const op = (
      await b.treasurer.call(`${b.root}/periods/${target}/close`, pre.body, { key: pre.key })
    ).payload.data.operationId;
    expect((await b.treasurer.call(`${b.root}/periods/operations/${op}`)).status).toBe(200);
    expect((await b.pastor.call(`${b.root}/periods/operations/${op}`)).status).toBe(403);
    expect((await b.treasurer2.call(`${b.root}/periods/operations/${op}`)).status).toBe(404);
  });
  test("cutline blocks missing old months and stale prepared income; newer month writes preserve closed summary", async () => {
    const b = await smallBook("prefix"),
      target = month(-1),
      income = await b.income("1000", `${target}-01`);
    expect(income.r.status).toBe(201);
    const oldReceipt = {
        ...income.body.receipt,
        submissionId: crypto.randomUUID(),
        sourceReference: `OLD-${crypto.randomUUID()}`,
        businessDate: `${month(-2)}-01`,
      },
      rp = await b.treasurer.call(`${b.root}/receipts/preview`, oldReceipt);
    expect(rp.status).toBe(200);
    const pre = await closing(b.root, b.treasurer, target),
      closed = await b.treasurer.call(`${b.root}/periods/${target}/close`, pre.body, {
        key: pre.key,
      });
    expect(closed.status).toBe(201);
    const id = closed.payload.data.closureId,
      snap = (await b.pastor.call(`${b.root}/period-closures/${id}`)).payload.data;
    expect(
      (
        await b.treasurer.call(`${b.root}/receipts`, {
          receipt: oldReceipt,
          previewToken: rp.payload.data.previewToken,
        })
      ).payload.error.code,
    ).toBe("FINANCE_PERIOD_CLOSED");
    expect(
      (
        await b.treasurer.call(`${b.root}/receipts/preview`, {
          ...oldReceipt,
          submissionId: crypto.randomUUID(),
        })
      ).payload.error.code,
    ).toBe("FINANCE_PERIOD_CLOSED");
    expect(
      (
        await b.treasurer.call(
          `${b.root}/receipts/${income.r.payload.data.receiptId}/void`,
          { reason: "Late", confirmed: true },
          { version: 1 },
        )
      ).payload.error.code,
    ).toBe("FINANCE_PERIOD_CLOSED");
    expect(
      await db.db
        .collection("finance_periods")
        .countDocuments({ churchId: new ObjectId(b.church.id), period: month(-2) }),
    ).toBe(0);
    expect((await b.treasurer.call(`${b.root}/periods/${month(-2)}`)).payload.data.state).toBe(
      "closed",
    );
    expect((await b.income()).r.status).toBe(201);
    const payment = await b.approvedPayment();
    expect(
      (
        await b.treasurer.call(`${b.root}/expense-proposals/${payment.id}/payment`, payment.body, {
          version: 2,
        })
      ).status,
    ).toBe(201);
    expect((await b.pastor.call(`${b.root}/period-closures/${id}`)).payload.data).toEqual(snap);
  });
  test("changed book invalidates close preview; history failure rolls back cutline and KS", async () => {
    const b = await smallBook("stale"),
      pre = await closing(b.root, b.treasurer);
    expect((await b.income()).r.status).toBe(201);
    expect(
      (await b.treasurer.call(`${b.root}/periods/${month()}/close`, pre.body, { key: pre.key }))
        .payload.error.code,
    ).toBe("VERSION_CONFLICT");
    const stableVersionPreview = await closing(b.root, b.treasurer);
    expect((await b.income("1")).r.status).toBe(201);
    expect(
      (
        await b.treasurer.call(`${b.root}/periods/${month()}/close`, stableVersionPreview.body, {
          key: stableVersionPreview.key,
        })
      ).payload.error.code,
    ).toBe("PERIOD_PREVIEW_STALE");
    const next = await closing(b.root, b.treasurer),
      spy = spyOn(Finance.prototype, "append").mockImplementation(async () => {
        throw new AppError(503, "DEPENDENCY_UNAVAILABLE");
      });
    try {
      expect(
        (await b.treasurer.call(`${b.root}/periods/${month()}/close`, next.body, { key: next.key }))
          .status,
      ).toBe(503);
    } finally {
      spy.mockRestore();
    }
    expect((await b.treasurer.call(`${b.root}/periods/${month()}`)).payload.data.state).toBe(
      "open",
    );
    expect(
      await db.db
        .collection("finance_period_closures")
        .countDocuments({ churchId: new ObjectId(b.church.id) }),
    ).toBe(0);
  });
  test("close preview actor and expiry are bound; two closers have one KS", async () => {
    const b = await smallBook("two-close"),
      a = await closing(b.root, b.treasurer),
      other = await closing(b.root, b.treasurer2);
    expect(
      (await b.treasurer2.call(`${b.root}/periods/${month()}/close`, a.body)).payload.error.code,
    ).toBe("PERIOD_PREVIEW_STALE");
    offset += 301000;
    try {
      expect(
        (await b.treasurer.call(`${b.root}/periods/${month()}/close`, a.body)).payload.error.code,
      ).toBe("PERIOD_PREVIEW_STALE");
    } finally {
      offset -= 301000;
    }
    const rs = await Promise.all([
      b.treasurer.call(`${b.root}/periods/${month()}/close`, a.body, { key: a.key }),
      b.treasurer2.call(`${b.root}/periods/${month()}/close`, other.body, { key: other.key }),
    ]);
    expect(rs.filter((r) => r.status === 201)).toHaveLength(1);
    expect(
      await db.db
        .collection("finance_period_closures")
        .countDocuments({ churchId: new ObjectId(b.church.id) }),
    ).toBe(1);
  });
  test("close racing the first receipt serializes even when control/period documents don't exist", async () => {
    const b = await smallBook("first-race"),
      pre = await closing(b.root, b.treasurer),
      receipt = {
        submissionId: crypto.randomUUID(),
        businessDate: `${month()}-01`,
        fundId: b.fund,
        sourceReference: `RACE-${crypto.randomUUID()}`,
        purpose: "Race",
        mode: "aggregate",
        amount: "100",
      },
      rp = await b.treasurer2.call(`${b.root}/receipts/preview`, receipt);
    expect(rp.status).toBe(200);
    const rs = await Promise.all([
      b.treasurer.call(`${b.root}/periods/${month()}/close`, pre.body, { key: pre.key }),
      b.treasurer2.call(`${b.root}/receipts`, {
        receipt,
        previewToken: rp.payload.data.previewToken,
      }),
    ]);
    expect(rs.filter((r) => r.status === 201)).toHaveLength(1);
    const state = (await b.treasurer.call(`${b.root}/periods/${month()}`)).payload.data;
    expect(state.inspection.matches).toBe(true);
    if (state.state === "closed")
      expect(
        await db.db
          .collection("finance_receipts")
          .countDocuments({ churchId: new ObjectId(b.church.id) }),
      ).toBe(0);
  });
  test("close races receipt void with one serial winner", async () => {
    const b = await smallBook("void-income-race"),
      r = await b.income(),
      pre = await closing(b.root, b.treasurer);
    expect(r.r.status).toBe(201);
    const rs = await Promise.all([
      b.treasurer.call(`${b.root}/periods/${month()}/close`, pre.body, { key: pre.key }),
      b.treasurer2.call(
        `${b.root}/receipts/${r.r.payload.data.receiptId}/void`,
        { reason: "Race", confirmed: true },
        { version: 1 },
      ),
    ]);
    expect(rs.filter((r) => [200, 201].includes(r.status))).toHaveLength(1);
    expect(
      (await b.treasurer.call(`${b.root}/periods/${month()}`)).payload.data.inspection.matches,
    ).toBe(true);
  });
  test("close races payment post; no write enters a closed prefix", async () => {
    const b = await smallBook("pay-race");
    await b.income();
    const payment = await b.approvedPayment(),
      pre = await closing(b.root, b.treasurer2);
    const rs = await Promise.all([
      b.treasurer2.call(`${b.root}/periods/${month()}/close`, pre.body),
      b.treasurer.call(`${b.root}/expense-proposals/${payment.id}/payment`, payment.body, {
        version: 2,
      }),
    ]);
    expect(rs.filter((r) => r.status === 201)).toHaveLength(1);
    expect(
      (await b.treasurer.call(`${b.root}/periods/${month()}`)).payload.data.inspection.matches,
    ).toBe(true);
  });
  test("close races payment void with one serial winner and preserved PC", async () => {
    const b = await smallBook("void-pay-race");
    await b.income();
    const payment = await b.approvedPayment(),
      paid = await b.treasurer.call(
        `${b.root}/expense-proposals/${payment.id}/payment`,
        payment.body,
        { version: 2 },
      );
    expect(paid.status).toBe(201);
    const id = paid.payload.data.paymentId,
      pre = await closing(b.root, b.treasurer),
      vp = await b.treasurer2.call(
        `${b.root}/payments/${id}/void-preview`,
        { reason: "Race" },
        { version: 1 },
      );
    expect(vp.status).toBe(200);
    const rs = await Promise.all([
      b.treasurer.call(`${b.root}/periods/${month()}/close`, pre.body, { key: pre.key }),
      b.treasurer2.call(
        `${b.root}/payments/${id}/void`,
        { void: { reason: "Race" }, previewToken: vp.payload.data.previewToken, confirmed: true },
        { version: 1 },
      ),
    ]);
    expect(rs.filter((r) => [200, 201].includes(r.status))).toHaveLength(1);
    expect(
      (await b.treasurer.call(`${b.root}/periods/${month()}`)).payload.data.inspection.matches,
    ).toBe(true);
    expect(
      await db.db
        .collection("finance_payments")
        .countDocuments({ proposalId: new ObjectId(payment.id) }),
    ).toBe(1);
  });
  test("current prefix denies pay/void but keeps proposal/decision flow; no automatic date move", async () => {
    const b = await smallBook("current-closed");
    const r = await b.income(),
      payment = await b.approvedPayment(),
      paid = await b.treasurer.call(
        `${b.root}/expense-proposals/${payment.id}/payment`,
        payment.body,
        { version: 2 },
      ),
      pre = await closing(b.root, b.treasurer);
    expect(
      (await b.treasurer.call(`${b.root}/periods/${month()}/close`, pre.body, { key: pre.key }))
        .status,
    ).toBe(201);
    expect(
      (
        await b.treasurer.call(
          `${b.root}/payments/${paid.payload.data.paymentId}/void-preview`,
          { reason: "Closed" },
          { version: 1 },
        )
      ).payload.error.code,
    ).toBe("FINANCE_PERIOD_CLOSED");
    expect(
      (await b.treasurer.call(`${b.root}/receipts/${r.r.payload.data.receiptId}`)).payload.data
        .canVoid,
    ).toBe(false);
    const proposal = {
        submissionId: crypto.randomUUID(),
        fundId: b.fund,
        amount: "1",
        purpose: "Waiting after close",
      },
      sp = await b.treasurer.call(`${b.root}/expense-proposals/preview`, proposal),
      submitted = await b.treasurer.call(`${b.root}/expense-proposals`, {
        proposal,
        previewToken: sp.payload.data.previewToken,
      });
    expect(submitted.status).toBe(201);
    const id = submitted.payload.data.proposalId,
      decision = { decision: "approved", reason: "Later actual day" },
      dp = await b.pastor.call(`${b.root}/expense-proposals/${id}/preview`, decision, {
        version: 1,
      });
    expect(
      (
        await b.pastor.call(
          `${b.root}/expense-proposals/${id}/decision`,
          { decision, previewToken: dp.payload.data.previewToken },
          { version: 1 },
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await b.treasurer.call(
          `${b.root}/expense-proposals/${id}/payment-preview`,
          { submissionId: crypto.randomUUID() },
          { version: 2 },
        )
      ).payload.error.code,
    ).toBe("FINANCE_PERIOD_CLOSED");
  });
  test("fund reconciliation pages are bounded, actor/cursor scope-safe; audit omits private reason", async () => {
    const read = await t.call(`${periods()}/${month()}/funds?limit=1`);
    expect(read.status).toBe(200);
    expect(read.payload.data.items).toHaveLength(1);
    expect(read.payload.data).not.toHaveProperty("totalCount");
    const cursor = encodeURIComponent(read.payload.data.nextCursor);
    expect((await p.call(`${periods()}/${month()}/funds?limit=1&cursor=${cursor}`)).status).toBe(
      400,
    );
    expect((await t.call(`${periods()}/${month()}/funds?limit=101`)).status).toBe(400);
    const next = await t.call(`${periods()}/${month()}/funds?limit=1&cursor=${cursor}`);
    expect(next.status).toBe(200);
    expect(next.payload.data.items[0].id).not.toBe(read.payload.data.items[0].id);
    const audit = await db.db
      .collection("audit_events")
      .find({ targetChurchId: new ObjectId(c.id) })
      .toArray();
    expect(audit.length).toBeGreaterThan(0);
    expect(JSON.stringify(audit)).not.toContain(voidReason);
  });
  test("fresh role revocation denies close/void replay and own operation receipts", async () => {
    const b = await smallBook("revoke");
    await b.income();
    const payment = await b.approvedPayment(),
      paid = await b.treasurer.call(
        `${b.root}/expense-proposals/${payment.id}/payment`,
        payment.body,
        { version: 2 },
      );
    expect(paid.status).toBe(201);
    const id = paid.payload.data.paymentId,
      vp = await b.treasurer.call(
        `${b.root}/payments/${id}/void-preview`,
        { reason: "Revoke synthetic" },
        { version: 1 },
      ),
      voidBody = {
        void: { reason: "Revoke synthetic" },
        previewToken: vp.payload.data.previewToken,
        confirmed: true,
      },
      voidKey = crypto.randomUUID(),
      voided = await b.treasurer.call(`${b.root}/payments/${id}/void`, voidBody, {
        key: voidKey,
        version: 1,
      });
    expect(voided.status).toBe(200);
    const pre = await closing(b.root, b.treasurer),
      closed = await b.treasurer.call(`${b.root}/periods/${month()}/close`, pre.body, {
        key: pre.key,
      });
    expect(closed.status).toBe(201);
    const account = (
      await owner.call(`owner/churches/${b.church.id}/accounts/${b.treasurerAccount.id}`)
    ).payload.data;
    expect(
      (
        await owner.call(
          `owner/churches/${b.church.id}/accounts/${b.treasurerAccount.id}/permissions`,
          { role: "pastor", scope: { kind: "church" } },
          { method: "PATCH", version: account.version },
        )
      ).status,
    ).toBe(200);
    const fresh = client();
    expect(
      (await fresh.login(b.treasurerAccount.email, b.treasurerAccount.password, b.church.code))
        .status,
    ).toBe(200);
    expect(
      (await fresh.call(`${b.root}/periods/${month()}/close`, pre.body, { key: pre.key })).status,
    ).toBe(403);
    expect(
      (await fresh.call(`${b.root}/periods/operations/${closed.payload.data.operationId}`)).status,
    ).toBe(403);
    expect(
      (await fresh.call(`${b.root}/payments/${id}/void`, voidBody, { key: voidKey, version: 1 }))
        .status,
    ).toBe(403);
    expect(
      (await fresh.call(`${b.root}/payments/operations/${voided.payload.data.operationId}`)).status,
    ).toBe(403);
    expect(
      (await fresh.call(`${b.root}/period-closures/${closed.payload.data.closureId}`)).status,
    ).toBe(200);
  });
});
