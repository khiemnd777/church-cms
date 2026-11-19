import { mkdir } from "node:fs/promises";
import { expect, firefox, type Page } from "@playwright/test";
import { createApp } from "../api/app";
import type { Config } from "../api/config";
import { Identity } from "../api/identity/service";
import { Database, initialize } from "../api/infrastructure/database";
import { RateLimit } from "../api/infrastructure/rate-limit";
import { assertComposition } from "./browser-composition";
import { localTls } from "./local-tls";
import { SyntheticClient, syntheticOwner, syntheticUser } from "./p2-fixtures";
import { financeChurch, financeRoot } from "./p51-fixtures";

if (process.platform !== "linux" || !process.env.CHURCH_BROWSER_CONTAINER)
  throw Error("Use isolated browser container");
const evidence = process.env.CHURCH_EVIDENCE_DIR ?? "output/p5.4/browser";
await mkdir(evidence, { recursive: true });
const tls = await localTls("/tmp/church-finance-tls"),
  conf: Config = {
    ...tls,
    cert: tls.cert,
    key: tls.key,
    origin: "https://localhost:3500",
    port: 3500,
    mongoUrl: "mongodb://host.docker.internal:27119/?replicaSet=church-local&directConnection=true",
    redisUrl: "redis://host.docker.internal:6391",
    database: `church_cms_test_browser_p54_${crypto.randomUUID().replaceAll("-", "")}`,
    csrfKey: crypto.randomUUID() + crypto.randomUUID(),
  };
const db = new Database(conf),
  rate = new RateLimit(conf.redisUrl, conf.csrfKey);
await mkdir("/tmp/church-finance-firefox", { recursive: true });
for (const args of [
  ["certutil", "-N", "--empty-password", "-d", "sql:/tmp/church-finance-firefox"],
  [
    "certutil",
    "-A",
    "-d",
    "sql:/tmp/church-finance-firefox",
    "-n",
    "Church private verification CA",
    "-t",
    "C,,",
    "-i",
    tls.ca,
  ],
])
  if (Bun.spawnSync(args).exitCode !== 0) throw Error("Private CA import failed");
const context = await firefox.launchPersistentContext("/tmp/church-finance-firefox", {
  headless: true,
  viewport: { width: 1440, height: 1000 },
});
context.setDefaultTimeout(15000);
context.setDefaultNavigationTimeout(15000);
const page = await context.newPage(),
  errors: string[] = [],
  checks: string[] = [];
context.on("page", (p) => p.on("pageerror", (e) => errors.push(e.message)));
page.on("pageerror", (e) => errors.push(e.message));
const assert = (condition: unknown, label: string) => {
  if (!condition) throw Error(label);
  checks.push(label);
  console.info(label);
};
let server: ReturnType<typeof Bun.serve> | undefined,
  loseNext = false,
  lost = false,
  reauthNext = false;
const logs: object[] = [],
  secrets: string[] = [];
const client = (realm: "owner" | "church" = "church") => {
  const ip = crypto.randomUUID();
  return new SyntheticClient(realm, conf.origin, (req) => app(req, { ip }));
};
let app: ReturnType<typeof createApp>;
async function login(
  p: Page,
  c: { code: string },
  account: { email: string; password: string },
  openExpense = true,
) {
  // Actor switches use isolated browser cookies; logout behavior belongs to the existing identity suite.
  await p.goto("about:blank");
  await context.clearCookies();
  await p.goto(`${conf.origin}/h/${c.code}/login`);
  await p.getByLabel("Email", { exact: true }).fill(account.email);
  await p.getByLabel("Mật khẩu", { exact: true }).fill(account.password);
  await p.getByRole("button", { name: "Đăng nhập", exact: true }).click();
  try {
    if (openExpense)
      await p.getByRole("button", { name: "Thông tin truy cập", exact: true }).waitFor();
    else await p.getByRole("heading", { name: "Cổng tín hữu", exact: true }).waitFor();
  } catch (error) {
    await Bun.write(
      `${evidence}/login-diagnostic.json`,
      JSON.stringify({ url: p.url(), text: await p.locator("body").innerText() }, null, 2),
    );
    await p.screenshot({
      path: `${evidence}/login-failure.png`,
      fullPage: true,
      mask: [p.locator('input[type="password"]')],
    });
    throw error;
  }
  const identity = await p.evaluate(
    async () => (await (await fetch("/api/v1/auth/me")).json()).data,
  );
  assert(identity.email === account.email, "browser-actor-identity-matches-fixture");
  if (openExpense) {
    await p.getByRole("button", { name: "Đề xuất chi & Duyệt", exact: true }).click();
    await p.getByRole("heading", { name: "Đề xuất chi & Duyệt", exact: true }).waitFor();
  }
}
async function capture(p: Page, name: string) {
  for (const theme of ["light", "dark"] as const) {
    await p.emulateMedia({ colorScheme: theme });
    for (const width of [1440, 901, 900, 560, 390]) {
      await p.setViewportSize({ width, height: 1000 });
      await assertComposition(p, `${name}-${theme}-${width}`, assert, evidence);
      await p.evaluate(async () => {
        await document.fonts.ready;
        scrollTo(0, 0);
      });
      const state = await p.evaluate(() => {
        const visible = (e: HTMLElement) => e.getClientRects().length > 0;
        const controls = Array.from(
          document.querySelectorAll<HTMLElement>(
            ".finance-layout button,.finance-layout input,.finance-layout select,dialog[open] input,dialog[open] textarea,dialog[open] button",
          ),
        ).filter(visible);
        return {
          page: document.documentElement.scrollWidth <= innerWidth + 1,
          contained: controls.every((e) => {
            const r = e.getBoundingClientRect();
            return e.closest(".tbl-wrap") || (r.left >= -1 && r.right <= innerWidth + 1);
          }),
          heights:
            innerWidth > 560 ||
            controls
              .filter((e) => !e.matches('[type="checkbox"]'))
              .every((e) => e.getBoundingClientRect().height >= 43),
          inputHeight: controls
            .filter((e) => e.matches('input:not([type="checkbox"]),select'))
            .every((e) => e.getBoundingClientRect().height < 55),
        };
      });
      assert(state.page && state.contained, `${name}-${theme}-${width}-contained`);
      assert(state.heights, `${name}-${theme}-${width}-touch`);
      assert(state.inputHeight, `${name}-${theme}-${width}-input-geometry`);
      if (width === 1440 || width === 390)
        await p.screenshot({ path: `${evidence}/${name}-${theme}-${width}.png`, fullPage: true });
    }
  }
  await p.setViewportSize({ width: 1440, height: 1000 });
  await p.emulateMedia({ colorScheme: "light" });
}
try {
  await db.client.connect();
  await initialize(db.db);
  await rate.connect();
  const identity = new Identity(db, rate, conf);
  await identity.initialize();
  app = createApp(identity, conf, { log: (r) => logs.push(r) });
  server = Bun.serve({
    hostname: "127.0.0.1",
    port: conf.port,
    tls: { cert: Bun.file(tls.cert), key: Bun.file(tls.key) },
    fetch: async (req) => {
      const path = new URL(req.url).pathname;
      if (reauthNext && req.method === "POST" && path.endsWith("/payment")) {
        reauthNext = false;
        return Response.json(
          { error: { code: "REAUTH_REQUIRED", message: "Xác thực lại để tiếp tục." } },
          { status: 401 },
        );
      }
      const response = await app(req, { ip: "browser-payments" });
      if (
        loseNext &&
        req.method === "POST" &&
        path.endsWith("/payment") &&
        response.status === 201
      ) {
        loseNext = false;
        lost = true;
        const p = await response.clone().json();
        return Response.json(
          {
            error: {
              code: "OUTCOME_UNKNOWN",
              message: "Chưa nhận được xác nhận chi.",
              operationId: p.data.operationId,
            },
            meta: {},
          },
          { status: 503 },
        );
      }
      return response;
    },
  });
  const owner = client("owner");
  await syntheticOwner(db, owner);
  const c = await financeChurch(owner, "P54 synthetic"),
    ps = client(),
    ss = client(),
    ts = client(),
    ms = client();
  const pastor = await syntheticUser(owner, ps, c, "pastor"),
    secretary = await syntheticUser(owner, ss, c, "secretary"),
    treasurer = await syntheticUser(owner, ts, c, "treasurer"),
    member = await syntheticUser(owner, ms, c, "member");
  secrets.push(pastor.password, secretary.password, treasurer.password, member.password);
  const finance = financeRoot(c),
    base = `${finance}/expense-proposals`;
  assert(
    (
      await ps.call(`${finance}/settings`, {
        proposerRoles: ["secretary", "treasurer", "ministry_lead"],
        approverRole: "pastor",
        approvalThreshold: { amount: "1", belowRole: "treasurer", atOrAboveRole: "pastor" },
      })
    ).status === 201,
    "explicit-config",
  );
  const f = await ps.call(`${finance}/funds`, { name: "Quỹ chi synthetic" });
  assert(f.status === 201, "public-fund");
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const rb = {
      submissionId: crypto.randomUUID(),
      businessDate: today,
      fundId: f.payload.data.fundId,
      sourceReference: `P54-${crypto.randomUUID()}`,
      purpose: "Thu synthetic",
      mode: "aggregate",
      amount: "900719925474099999",
    },
    rp = await ts.call(`${finance}/receipts/preview`, rb),
    receipt = await ts.call(`${finance}/receipts`, {
      receipt: rb,
      previewToken: rp.payload.data.previewToken,
    });
  assert(receipt.status === 201, "public-income");
  async function approved(label: string, amount = "123") {
    const b = {
        submissionId: crypto.randomUUID(),
        fundId: f.payload.data.fundId,
        amount,
        purpose: label,
      },
      pre = await ss.call(`${base}/preview`, b),
      created = await ss.call(base, { proposal: b, previewToken: pre.payload.data.previewToken });
    assert(created.status === 201, "public-proposal");
    const id = created.payload.data.proposalId;
    const d = { decision: "approved", reason: "Synthetic approved" },
      dp = await ps.call(`${base}/${id}/preview`, d, { version: 1 });
    assert(
      (
        await ps.call(
          `${base}/${id}/decision`,
          { decision: d, previewToken: dp.payload.data.previewToken },
          { version: 1 },
        )
      ).status === 200,
      "public-approval",
    );
    const proposal = (await ss.call(`${base}/${id}`)).payload.data;
    assert(
      proposal.approvalBand === "at_or_above" &&
        proposal.approvalRuleVersion === 1 &&
        proposal.decision.actorRole === "pastor",
      "P73-payment-fixture-is-threshold-approved",
    );
    return proposal;
  }
  const first = await approved("Mục đích chi riêng synthetic", "9007199254740993"),
    second = await approved("Chi uncertain synthetic"),
    third = await approved("Chi reauth synthetic");
  await login(page, c, treasurer);
  await expect(page.getByRole("button", { name: `Xem ${first.code}`, exact: true })).toBeVisible();
  await capture(page, "treasurer-before-payment");
  async function openPay(code: string) {
    await page.getByRole("button", { name: `Xem ${code}`, exact: true }).click();
    const d = page.getByRole("dialog", { name: "Chi tiết đề xuất chi", exact: true });
    await d.getByRole("button", { name: "Lập phiếu chi", exact: true }).click();
    return page.getByRole("dialog", { name: "Lập phiếu chi", exact: true });
  }
  let d = await openPay(first.code);
  await expect(d.getByText(/Thời điểm duyệt:/)).toBeVisible();
  await expect(d.getByRole("button", { name: "Hủy", exact: true })).toBeVisible();
  assert(true, "approved-time-and-explicit-cancel-visible");
  await capture(page, "payment-form");
  await d.getByRole("button", { name: "Xem trước", exact: true }).click();
  await expect(d.getByText(/Số dư sổ hiện tại/)).toBeVisible();
  await capture(page, "payment-preview");
  assert(
    await page.evaluate(() => !!document.activeElement?.closest("dialog[open]")),
    "payment-keyboard-focus",
  );
  await d.getByRole("button", { name: "Xác nhận lập phiếu chi", exact: true }).click();
  d = page.getByRole("dialog", { name: "Chi tiết đề xuất chi", exact: true });
  await expect(d.getByText("Đã chi", { exact: true })).toBeVisible();
  const paid = (await ts.call(`${base}/${first.id}`)).payload.data;
  assert(paid.state === "paid" && paid.payment.businessDate === today, "paid-date-readback");
  await expect(d.getByText("Đã chi", { exact: true })).toHaveClass(/p-good/);
  assert(true, "paid-state-shared-success-tone");
  await capture(page, "paid-proposal");
  await d.getByRole("button", { name: `Xem ${paid.payment.code}`, exact: true }).click();
  d = page.getByRole("dialog", { name: "Chi tiết phiếu chi", exact: true });
  await expect(d.getByText(/Lịch sử phiếu chi/)).toBeVisible();
  await capture(page, "payment-detail");
  await d.getByRole("button", { name: "Đóng", exact: true }).click();
  await page.getByRole("button", { name: "Dâng hiến & Quỹ", exact: true }).click();
  await page.getByLabel("Xem", { exact: true }).selectOption("ledger");
  await expect(
    page.getByRole("button", { name: `Xem ${paid.payment.code}`, exact: true }),
  ).toBeVisible();
  await capture(page, "mixed-ledger");
  await page.getByLabel("Loại giao dịch", { exact: true }).selectOption("payment");
  await expect(
    page.getByRole("button", { name: `Xem ${paid.payment.code}`, exact: true }),
  ).toBeVisible();
  assert((await page.getByRole("table").locator("tbody tr").count()) === 1, "ledger-type-filter");
  await capture(page, "ledger-payments-only");
  await page.getByRole("button", { name: `Xem ${paid.payment.code}`, exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Chi tiết phiếu chi", exact: true })).toBeVisible();
  await page
    .getByRole("dialog", { name: "Chi tiết phiếu chi", exact: true })
    .getByRole("button", { name: "Đóng", exact: true })
    .click();
  await page.getByRole("button", { name: "Đề xuất chi & Duyệt", exact: true }).click();
  d = await openPay(second.code);
  await d.getByRole("button", { name: "Xem trước", exact: true }).click();
  await expect(d.getByText(/Số dư sổ hiện tại/)).toBeVisible();
  loseNext = true;
  await d.getByRole("button", { name: "Xác nhận lập phiếu chi", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Kiểm tra kết quả / thử lại", exact: true }),
  ).toBeVisible();
  await expect.poll(() => lost).toBe(true);
  assert(lost, "lost-confirmation-injected-after-real-commit");
  await capture(page, "payment-uncertain");
  await d.getByRole("button", { name: "Đóng", exact: true }).click();
  await page.getByRole("button", { name: "Kiểm tra kết quả / thử lại", exact: true }).click();
  await expect(
    page
      .getByRole("dialog", { name: "Chi tiết đề xuất chi", exact: true })
      .getByText("Đã chi", { exact: true }),
  ).toBeVisible();
  assert(
    (await db.db
      .collection("finance_payments")
      .countDocuments({ proposalId: new (await import("mongodb")).ObjectId(second.id) })) === 1,
    "uncertain-retry-one-payment",
  );
  await page
    .getByRole("dialog", { name: "Chi tiết đề xuất chi", exact: true })
    .getByRole("button", { name: "Đóng", exact: true })
    .click();
  d = await openPay(third.code);
  await d.getByRole("button", { name: "Xem trước", exact: true }).click();
  await expect(d.getByText(/Số dư sổ hiện tại/)).toBeVisible();
  reauthNext = true;
  await d.getByRole("button", { name: "Xác nhận lập phiếu chi", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Xác thực lại", exact: true })).toBeVisible();
  assert(
    (await ts.call(`${base}/${third.id}`)).payload.data.state === "approved",
    "reauth-no-auto-payment",
  );
  await capture(page, "payment-reauth-required");
  await login(page, c, secretary);
  await page.getByRole("button", { name: `Xem ${first.code}`, exact: true }).click();
  d = page.getByRole("dialog", { name: "Chi tiết đề xuất chi", exact: true });
  await expect(d.getByText(/PC-/)).toBeVisible();
  assert(
    (await d.getByRole("button", { name: /Xem PC-/ }).count()) === 0,
    "proposer-minimal-paid-link-no-finance-detail",
  );
  assert(
    (await page.getByRole("button", { name: "Dâng hiến & Quỹ", exact: true }).count()) === 0,
    "proposer-no-book-menu",
  );
  await capture(page, "proposer-paid-minimal");
  await login(page, c, pastor);
  await page.getByRole("button", { name: `Xem ${third.code}`, exact: true }).click();
  d = page.getByRole("dialog", { name: "Chi tiết đề xuất chi", exact: true });
  assert(
    (await d.getByRole("button", { name: "Lập phiếu chi", exact: true }).count()) === 0,
    "pastor-read-only-no-pay",
  );
  await capture(page, "pastor-readonly");
  await login(page, c, member, false);
  await page.goto(`${conf.origin}/h/${c.code}/expense`);
  await expect(page.getByRole("heading", { name: "Cổng tín hữu", exact: true })).toBeVisible();
  assert(
    new URL(page.url()).pathname.endsWith("/portal"),
    "member-expense-deeplink-returns-to-portal",
  );
  assert((await ms.call(base)).status === 403, "member-expense-api-denied");
  assert((await page.getByRole("table").count()) === 0, "member-no-financial-data");
  await capture(page, "member-denied");
  assert(errors.length === 0, "no-page-errors");
  assert(!secrets.some((s) => JSON.stringify(logs).includes(s)), "logs-no-passwords");
  await Bun.write(
    `${evidence}/browser-results.json`,
    JSON.stringify(
      {
        status: "PASS",
        checks,
        errors,
        limits: [
          "Firefox/private CA/local synthetic only",
          "No main runtime/UAT/production/Safari/physical/independent-review proof",
          "UI-POSTP8-01 remains AFTER_P8",
        ],
      },
      null,
      2,
    ),
  );
} catch (e) {
  await page.screenshot({ path: `${evidence}/failure.png`, fullPage: true });
  await Bun.write(
    `${evidence}/browser-failure.json`,
    JSON.stringify({ checks, error: e instanceof Error ? e.message : String(e) }, null, 2),
  );
  throw e;
} finally {
  await context.close();
  if (server) await server.stop(true);
  await db.db.dropDatabase();
  const removed = !(await db.db.admin().listDatabases()).databases.some(
    (d) => d.name === conf.database,
  );
  await Bun.write(
    `${evidence}/browser-cleanup.json`,
    JSON.stringify({ removed, database: conf.database }),
  );
  await db.client.close();
  if (rate.client.isOpen) rate.client.destroy();
}
