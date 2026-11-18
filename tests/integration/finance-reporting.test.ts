import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { ObjectId } from "mongodb";
import { createApp } from "../../api/app";
import { config } from "../../api/config";
import { AppError } from "../../api/errors";
import type { FinancePeriod } from "../../api/finance/transactions-model";
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
  database: `church_cms_test_p56_${crypto.randomUUID().replaceAll("-", "")}`,
  csrfKey: crypto.randomUUID() + crypto.randomUUID(),
};
localOnly(conf);
const offset = 0;
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
beforeAll(async () => {
  await db.client.connect();
  await initialize(db.db);
  await rate.connect();
  const identity = new Identity(db, rate, conf, () => new Date(Date.now() + offset));
  await identity.initialize();
  app = createApp(identity, conf, { log: (r) => logs.push(r) });
  owner = client("owner");
  await syntheticOwner(db, owner);
  c = await financeChurch(owner, "P56 contracts");
  other = await financeChurch(owner, "P56 other");
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
  const f = await p.call(`${financeRoot(c)}/funds`, { name: "Quỹ P56 synthetic" });
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
  const church = await financeChurch(owner, `P56 ${label}`),
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
        sourceReference: `P56-${crypto.randomUUID()}`,
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
describe("P56 exact scoped finance reporting", () => {
  test("role/tenant/owner ACL, strict query and GET-only", async () => {
    expect((await t.call(`${financeRoot(c)}/summary?fundId=${fundId}`)).status).toBe(200);
    for (const who of [p, p2, t, t2])
      expect((await who.call(`${financeRoot(c)}/summary`)).status).toBe(200);
    for (const who of [s, s2, l, l2, m])
      expect((await who.call(`${financeRoot(c)}/summary`)).status).toBe(403);
    expect((await owner.call(`owner/churches/${c.id}/finance/summary`)).status).toBe(403);
    expect((await t.call(`${financeRoot(other)}/summary`)).status).toBe(403);
    expect((await t.call(`${financeRoot(c)}/summary`, {})).status).toBe(405);
    for (const q of [
      "period=0000-01",
      "period=2026-13",
      "period=2026-01&period=2026-02",
      "unknown=1",
      "fundId=bad",
    ])
      expect((await t.call(`${financeRoot(c)}/summary?${q}`)).status).toBe(400);
    expect((await t.call(`${financeRoot(c)}/summary?fundId=${new ObjectId()}`)).status).toBe(404);
  });
  test("measured empty is zero, GET does not initialize Finance", async () => {
    const x = await smallBook("empty");
    const counts = await Promise.all(
      [
        "finance_periods",
        "finance_book_controls",
        "finance_period_closures",
        "finance_ledger",
        "finance_history",
      ].map((n) => db.db.collection(n).countDocuments({ churchId: new ObjectId(x.church.id) })),
    );
    const r = await x.treasurer.call(`${x.root}/summary`);
    expect(r.status).toBe(200);
    expect(r.payload.data.totals).toEqual({
      netIncome: "0",
      netExpense: "0",
      openingBalance: "0",
      closingBalance: "0",
    });
    expect(r.payload.data.months.length).toBe(12);
    expect(
      await Promise.all(
        [
          "finance_periods",
          "finance_book_controls",
          "finance_period_closures",
          "finance_ledger",
          "finance_history",
        ].map((n) => db.db.collection(n).countDocuments({ churchId: new ObjectId(x.church.id) })),
      ),
    ).toEqual(counts);
  });
  test("exact money beyond2^53 matches ledger; fund scope and annual/month boundaries", async () => {
    const x = await smallBook("exact"),
      year = month().slice(0, 4),
      prior = `${Number(year) - 1}-12-31`;
    expect((await x.income("9007199254740993", prior)).r.status).toBe(201);
    expect((await x.income("1000")).r.status).toBe(201);
    const r = await x.treasurer.call(`${x.root}/summary?period=${month()}&fundId=${x.fund}`),
      ledger = await x.treasurer.call(`${x.root}/ledger?period=${month()}&fundId=${x.fund}`);
    expect(r.payload.data.totals.openingBalance).toBe("9007199254740993");
    expect(r.payload.data.totals.closingBalance).toBe("9007199254741993");
    for (const k of ["netIncome", "netExpense", "openingBalance", "closingBalance"])
      expect(r.payload.data.totals[k]).toBe(ledger.payload.data[k]);
    expect(
      r.payload.data.months.find((m: { period: string }) => m.period === month()).netIncome,
    ).toBe("1000");
    const no = (await x.treasurer.call(`${x.root}/summary?period=${year}-01`)).payload.data;
    if (month().endsWith("-01")) expect(no.totals.netIncome).toBe("1000");
    else expect(no.totals.netIncome).toBe("0");
  });
  test("future months unavailable, open months provisional, no auto carry forward forecast", async () => {
    const x = await smallBook("future");
    await x.income();
    const r = await x.treasurer.call(`${x.root}/summary?period=${month(1)}`);
    expect(r.payload.data.state).toBe("future");
    expect(r.payload.data.totals).toBeNull();
    expect(
      r.payload.data.months
        .filter((m: { period: string }) => m.period > month())
        .every((m: { netIncome: null }) => m.netIncome === null),
    ).toBe(true);
    const max = await x.treasurer.call(`${x.root}/summary?period=9999-12`);
    expect(max.status).toBe(200);
    expect(max.payload.data.months.every((m: { netIncome: null }) => m.netIncome === null)).toBe(
      true,
    );
  });
  test("whole financial workflow, reversal reduces expense, close matches KS", async () => {
    const x = await smallBook("flow");
    await x.income("1000");
    const proposal = await x.approvedPayment();
    const paid = await x.treasurer.call(
      `${x.root}/expense-proposals/${proposal.id}/payment`,
      proposal.body,
      { version: 2 },
    );
    expect(paid.status).toBe(201);
    const paymentId = paid.payload.data.paymentId,
      before = (await x.treasurer.call(`${x.root}/summary`)).payload.data;
    expect(before.totals.netIncome).toBe("1000");
    expect(before.totals.netExpense).toBe("100");
    const reason = { reason: "Private P56 reversal" },
      vp = await x.treasurer.call(`${x.root}/payments/${paymentId}/void-preview`, reason, {
        version: 1,
      }),
      body = { void: reason, previewToken: vp.payload.data.previewToken, confirmed: true };
    expect(
      (await x.treasurer.call(`${x.root}/payments/${paymentId}/void`, body, { version: 1 })).status,
    ).toBe(200);
    const cp = await closing(x.root, x.treasurer),
      closed = await x.treasurer.call(`${x.root}/periods/${month()}/close`, cp.body, {
        key: cp.key,
      });
    expect(closed.status).toBe(201);
    const ks = (
      await x.treasurer.call(`${x.root}/period-closures/${closed.payload.data.closureId}`)
    ).payload.data;
    const r = (await x.treasurer.call(`${x.root}/summary`)).payload.data;
    expect(r.state).toBe("closed");
    expect(r.closedThrough).toBe(month());
    expect(r.totals.netExpense).toBe("0");
    expect(r.totals.netIncome).toBe("1000");
    for (const k of ["netIncome", "netExpense", "openingBalance", "closingBalance"])
      expect(r.totals[k]).toBe(ks.summary[k]);
    expect(JSON.stringify(r)).not.toContain("Private P56 reversal");
    expect(JSON.stringify(r)).not.toContain("actorName");
    expect(
      (await x.treasurer.call(`${x.root}/expense-proposals/${proposal.id}`)).payload.data.state,
    ).toBe("payment_voided");
  });
  test("receipt cancellation nets income once, monthly series equals ledger", async () => {
    const x = await smallBook("receipt void"),
      saved = await x.income();
    const id = saved.r.payload.data.receiptId;
    expect(
      (
        await x.treasurer.call(
          `${x.root}/receipts/${id}/void`,
          { reason: "Private receipt reason", confirmed: true },
          { version: 1 },
        )
      ).status,
    ).toBe(200);
    const data = (await x.treasurer.call(`${x.root}/summary`)).payload.data;
    expect(data.totals.netIncome).toBe("0");
    expect(data.totals.netExpense).toBe("0");
    expect(data.months.find((m: { period: string }) => m.period === month()).netIncome).toBe("0");
    expect(JSON.stringify(data)).not.toContain(id);
    expect(JSON.stringify(data)).not.toContain("Private receipt reason");
  });
  test("inactive/renamed fund stays scoped by ID; other fund excluded", async () => {
    const x = await smallBook("fund scope");
    await x.income();
    const f = (await x.pastor.call(`${x.root}/funds`, { name: "Other fund" })).payload.data.fundId;
    expect(
      (await x.treasurer.call(`${x.root}/summary?fundId=${f}`)).payload.data.totals.closingBalance,
    ).toBe("0");
    expect(
      (
        await x.pastor.call(
          `${x.root}/funds/${x.fund}`,
          { name: "Renamed fund" },
          { method: "PATCH", version: 1 },
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await x.pastor.call(
          `${x.root}/funds/${x.fund}/status`,
          { status: "inactive", reason: "Synthetic inactive" },
          { method: "PATCH", version: 2 },
        )
      ).status,
    ).toBe(200);
    const r = (await x.treasurer.call(`${x.root}/summary?fundId=${x.fund}`)).payload.data;
    expect(r.fund.name).toBe("Renamed fund");
    expect(r.fund.status).toBe("inactive");
    expect(r.totals.closingBalance).toBe("1000");
  });
  test("legacy individually closed month is not treated as a prefix", async () => {
    const x = await smallBook("legacy"),
      prior = month(-1);
    await db.db.collection<FinancePeriod>("finance_periods").insertOne({
      _id: `${x.church.id}:${prior}`,
      churchId: new ObjectId(x.church.id),
      period: prior,
      state: "closed",
      version: 1,
      writeFence: 0,
    });
    const r = (await x.treasurer.call(`${x.root}/summary`)).payload.data;
    expect(r.state).toBe("open");
    expect(r.closedThrough).toBeNull();
    if (prior.slice(0, 4) === r.year)
      expect(r.months.find((m: { period: string }) => m.period === prior).state).toBe("closed");
  });
  test("concurrent summary reads see whole committed snapshots, not half a receipt", async () => {
    const x = await smallBook("atomic");
    await x.income("1000");
    const [a, b, c] = await Promise.all([
      x.treasurer.call(`${x.root}/summary`),
      x.income("100"),
      x.treasurer2.call(`${x.root}/summary`),
    ]);
    expect(b.r.status).toBe(201);
    for (const r of [a, c]) {
      expect(r.status).toBe(200);
      const z = r.payload.data;
      expect(["1000", "1100"]).toContain(z.totals.netIncome);
      expect(z.totals.netIncome).toBe(z.totals.closingBalance);
      expect(z.months.find((m: { period: string }) => m.period === month()).netIncome).toBe(
        z.totals.netIncome,
      );
    }
  });
  test("fresh revocation denies summary and data cannot hide in general owner Overview", async () => {
    const x = await smallBook("revoke");
    await x.income();
    const overview = await owner.call(`owner/churches/${x.church.id}/overview`);
    expect(overview.status).toBe(200);
    expect(JSON.stringify(overview.payload.data)).not.toContain("netIncome");
    expect(overview.payload.data.finance).toBeUndefined();
    const account = (
      await owner.call(`owner/churches/${x.church.id}/accounts/${x.treasurerAccount.id}`)
    ).payload.data;
    expect(
      (
        await owner.call(
          `owner/churches/${x.church.id}/accounts/${x.treasurerAccount.id}/permissions`,
          { role: "secretary", scope: { kind: "church" } },
          { method: "PATCH", version: account.version },
        )
      ).status,
    ).toBe(200);
    const fresh = client();
    expect(
      (await fresh.login(x.treasurerAccount.email, x.treasurerAccount.password, x.church.code))
        .status,
    ).toBe(200);
    expect((await fresh.call(`${x.root}/summary`)).status).toBe(403);
  });
  test("aggregation failure is an error, never a zero summary", async () => {
    const original = db.db.collection.bind(db.db),
      mock = spyOn(db.db, "collection");
    mock.mockImplementation(((name: string, ...args: unknown[]) => {
      const c = original(name, ...(args as []));
      if (name !== "finance_ledger") return c;
      return new Proxy(c, {
        get(target, key, receiver) {
          if (key === "aggregate")
            return () => {
              throw new AppError(503, "DEPENDENCY_UNAVAILABLE");
            };
          return Reflect.get(target, key, receiver);
        },
      });
    }) as typeof db.db.collection);
    try {
      const r = await t.call(`${financeRoot(c)}/summary`);
      expect(r.status).toBe(503);
      expect(r.payload.data).toBeUndefined();
    } finally {
      mock.mockRestore();
    }
  });
});
