import { mkdir } from "node:fs/promises";
import { expect, firefox, type Page } from "@playwright/test";
import { Decimal128, ObjectId } from "mongodb";
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
const evidence = process.env.CHURCH_EVIDENCE_DIR ?? "output/p5.5/browser";
await mkdir(evidence, { recursive: true });
const tls = await localTls("/tmp/church-finance-tls"),
  conf: Config = {
    ...tls,
    cert: tls.cert,
    key: tls.key,
    origin: "https://localhost:3502",
    port: 3502,
    mongoUrl: "mongodb://host.docker.internal:27119/?replicaSet=church-local&directConnection=true",
    redisUrl: "redis://host.docker.internal:6391",
    database: `church_cms_test_browser_p55_${crypto.randomUUID().replaceAll("-", "")}`,
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
  loseNext: "void" | "close" | null = null,
  lost = false,
  reauthNext: "void" | "close" | null = null;
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
  await p.goto(`${conf.origin}/${c.code}/login`);
  await p.getByLabel("Email", { exact: true }).fill(account.email);
  await p.getByLabel("Mật khẩu", { exact: true }).fill(account.password);
  await p.getByRole("button", { name: "Đăng nhập", exact: true }).click();
  try {
    await p.getByRole("button", { name: "Thông tin truy cập", exact: true }).waitFor();
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
      const composition = await assertComposition(p, `${name}-${theme}-${width}`, assert, evidence);
      if (
        [
          "reconciliation-open",
          "close-preview-all-funds-inline",
          "closed-cutline-expanded",
        ].includes(name)
      )
        assert(
          composition.headings > 0 &&
            [6, 12, 18].every((gap) => composition.gaps.some((g) => g.expected === gap)),
          `${name}-${theme}-${width}-section-spacing-nonvacuous`,
        );
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
      if (width === 1440 || width === 390) {
        await p.screenshot({ path: `${evidence}/${name}-${theme}-${width}.png`, fullPage: true });
        if (["reconciliation-open", "close-preview-all-funds-inline"].includes(name))
          await p
            .locator('[data-ui="period-panel"]')
            .screenshot({ path: `${evidence}/${name}-${theme}-${width}-panel.png` });
      }
    }
  }
  await p.setViewportSize({ width: 1440, height: 1000 });
  await p.emulateMedia({ colorScheme: "light" });
}
let blockPeriodRead = false,
  failPeriodRead = false;
let releasePeriodRead: (() => void) | null = null;
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
      const path = new URL(req.url).pathname,
        stage = path.endsWith("/void") ? "void" : path.endsWith("/close") ? "close" : null;
      if (reauthNext && stage === reauthNext && req.method === "POST") {
        reauthNext = null;
        return Response.json(
          { error: { code: "REAUTH_REQUIRED", message: "Xác thực lại để tiếp tục." } },
          { status: 401 },
        );
      }
      if (req.method === "GET" && /\/periods\/\d{4}-\d{2}$/.test(path)) {
        if (blockPeriodRead) {
          blockPeriodRead = false;
          await new Promise<void>((resolve) => {
            releasePeriodRead = resolve;
          });
        }
        if (failPeriodRead) {
          failPeriodRead = false;
          return Response.json(
            {
              error: {
                code: "DEPENDENCY_UNAVAILABLE",
                message: "Nguồn đối chiếu tạm không khả dụng.",
              },
            },
            { status: 503 },
          );
        }
      }
      const response = await app(req, { ip: "browser-periods" });
      if (
        loseNext &&
        stage === loseNext &&
        req.method === "POST" &&
        [200, 201].includes(response.status)
      ) {
        loseNext = null;
        lost = true;
        const data = await response.clone().json();
        return Response.json(
          {
            error: {
              code: "OUTCOME_UNKNOWN",
              message: "Chưa nhận được xác nhận.",
              operationId: data.data.operationId,
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
  const c = await financeChurch(owner, "P55 synthetic"),
    ps = client(),
    ts = client(),
    ss = client(),
    ms = client();
  const pastor = await syntheticUser(owner, ps, c, "pastor"),
    treasurer = await syntheticUser(owner, ts, c, "treasurer"),
    secretary = await syntheticUser(owner, ss, c, "secretary"),
    member = await syntheticUser(owner, ms, c, "member");
  secrets.push(pastor.password, treasurer.password, secretary.password, member.password);
  const finance = financeRoot(c),
    base = `${finance}/expense-proposals`,
    today = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Ho_Chi_Minh",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date()),
    period = today.slice(0, 7),
    privateReason = "Lý do hủy riêng synthetic";
  assert(
    (
      await ps.call(`${finance}/settings`, {
        proposerRoles: ["secretary", "treasurer"],
        approverRole: "pastor",
      })
    ).status === 201,
    "public-config",
  );
  const fund = (await ps.call(`${finance}/funds`, { name: "Quỹ A synthetic" })).payload.data
      .fundId as string,
    otherFund = (await ps.call(`${finance}/funds`, { name: "Quỹ B synthetic" })).payload.data
      .fundId as string;
  async function income(fundId: string, amount: string) {
    const receipt = {
        submissionId: crypto.randomUUID(),
        businessDate: today,
        fundId,
        sourceReference: `P55-${crypto.randomUUID()}`,
        purpose: "Synthetic income",
        mode: "aggregate",
        amount,
      },
      pre = await ts.call(`${finance}/receipts/preview`, receipt);
    assert(pre.status === 200, "public-income-preview");
    assert(
      (
        await ts.call(`${finance}/receipts`, {
          receipt,
          previewToken: pre.payload.data.previewToken,
        })
      ).status === 201,
      "public-income",
    );
  }
  await income(fund, "9007199254740993");
  await income(otherFund, "1000");
  async function paid(amount: string) {
    const proposal = {
        submissionId: crypto.randomUUID(),
        fundId: fund,
        amount,
        purpose: "Chi synthetic",
      },
      sp = await ss.call(`${base}/preview`, proposal),
      created = await ss.call(base, { proposal, previewToken: sp.payload.data.previewToken });
    assert(created.status === 201, "public-proposal");
    const id = created.payload.data.proposalId as string,
      decision = { decision: "approved", reason: "Approved synthetic" },
      dp = await ps.call(`${base}/${id}/preview`, decision, { version: 1 });
    assert(
      (
        await ps.call(
          `${base}/${id}/decision`,
          { decision, previewToken: dp.payload.data.previewToken },
          { version: 1 },
        )
      ).status === 200,
      "public-approval",
    );
    const payment = { submissionId: crypto.randomUUID() },
      pp = await ts.call(`${base}/${id}/payment-preview`, payment, { version: 2 }),
      r = await ts.call(
        `${base}/${id}/payment`,
        { payment, previewToken: pp.payload.data.previewToken, confirmed: true },
        { version: 2 },
      );
    assert(r.status === 201, "public-payment");
    return {
      proposal: (await ts.call(`${base}/${id}`)).payload.data,
      payment: (await ts.call(`${finance}/payments/${r.payload.data.paymentId}`)).payload.data,
    };
  }
  const first = await paid("100"),
    second = await paid("200"),
    third = await paid("300");
  await login(page, c, treasurer, false);
  await page.getByRole("button", { name: "Dâng hiến & Quỹ", exact: true }).click();
  await page.getByRole("button", { name: "Đối chiếu kỳ", exact: true }).click();
  await expect(page.getByText("Phiếu và sổ khớp", { exact: true })).toBeVisible();
  await expect(page.getByText("Quỹ có giao dịch đến hết kỳ:", { exact: true })).toBeVisible();
  await capture(page, "reconciliation-open");
  await page.getByLabel("Kỳ", { exact: true }).fill("2020-01");
  await page.getByRole("button", { name: "Đối chiếu kỳ", exact: true }).click();
  await expect(page.getByText("Chưa có giao dịch đến hết kỳ.", { exact: true })).toBeVisible();
  await capture(page, "reconciliation-empty");
  blockPeriodRead = true;
  await page.getByLabel("Kỳ", { exact: true }).fill(period);
  await expect.poll(() => !!releasePeriodRead).toBe(true);
  await capture(page, "reconciliation-loading");
  const resume = releasePeriodRead as (() => void) | null;
  if (!resume) throw Error("Missing synthetic request gate");
  resume();
  await page.getByRole("button", { name: "Đối chiếu kỳ", exact: true }).click();
  await expect(page.getByText("Phiếu và sổ khớp", { exact: true })).toBeVisible();
  const original = await db.db
    .collection("finance_ledger")
    .findOne({ churchId: new ObjectId(c.id), kind: "receipt" });
  if (!original) throw Error("Missing synthetic debit fixture");
  await db.db
    .collection("finance_ledger")
    .updateOne({ _id: original._id }, { $set: { amount: Decimal128.fromString("2") } });
  await page.getByRole("button", { name: "Đối chiếu kỳ", exact: true }).click();
  await page.getByRole("button", { name: "Đối chiếu kỳ", exact: true }).click();
  await expect(
    page.getByText("Có sai lệch phiếu–sổ. Chưa thể khóa.", { exact: true }),
  ).toBeVisible();
  await capture(page, "reconciliation-mismatch");
  await db.db
    .collection("finance_ledger")
    .updateOne({ _id: original._id }, { $set: { amount: original.amount } });
  failPeriodRead = true;
  await page.getByRole("button", { name: "Đối chiếu kỳ", exact: true }).click();
  await expect(
    page
      .locator('[data-ui="period-panel"]')
      .getByText("Nguồn đối chiếu tạm không khả dụng.", { exact: true }),
  ).toBeVisible();
  await capture(page, "reconciliation-error");
  await page.reload();
  await page.getByRole("button", { name: "Đối chiếu kỳ", exact: true }).click();
  await expect(page.getByText("Phiếu và sổ khớp", { exact: true })).toBeVisible();

  await page.getByLabel("Xem", { exact: true }).selectOption("ledger");
  async function openVoid(code: string) {
    await page
      .getByRole("button", { name: `Xem ${code}`, exact: true })
      .first()
      .click();
    const detail = page.getByRole("dialog", { name: "Chi tiết phiếu chi", exact: true });
    await detail.getByRole("button", { name: "Hủy phiếu chi", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Hủy phiếu chi", exact: true });
    await dialog.getByLabel("Lý do hủy phiếu chi", { exact: true }).fill(privateReason);
    await dialog.getByRole("button", { name: "Xem trước", exact: true }).click();
    await expect(
      dialog.getByRole("button", { name: "Xác nhận hủy phiếu", exact: true }),
    ).toBeVisible();
    return dialog;
  }
  let d = await openVoid(first.payment.code);
  assert(
    await page.evaluate(() => !!document.activeElement?.closest("dialog[open]")),
    "void-confirm-keyboard-focus",
  );
  await capture(page, "payment-void-preview");
  await d.getByRole("button", { name: "Xác nhận hủy phiếu", exact: true }).click();
  d = page.getByRole("dialog", { name: "Chi tiết phiếu chi", exact: true });
  await expect(d.getByText(/Đã hủy bởi/)).toBeVisible();
  await capture(page, "payment-voided");
  await d.getByRole("button", { name: "Đóng", exact: true }).click();
  await page.getByLabel("Loại giao dịch", { exact: true }).selectOption("payment_void");
  await expect(page.getByRole("cell", { name: /Đối ứng hủy chi/ })).toBeVisible();
  await capture(page, "payment-void-reversal-ledger");
  const totals = (await ts.call(`${finance}/ledger`)).payload.data;
  assert(
    totals.netIncome === "9007199254741993" && totals.netExpense === "500",
    "reversal-reduces-expense-never-income",
  );
  await page.getByLabel("Loại giao dịch", { exact: true }).selectOption("all");
  d = await openVoid(second.payment.code);
  loseNext = "void";
  lost = false;
  await d.getByRole("button", { name: "Xác nhận hủy phiếu", exact: true }).click();
  await expect.poll(() => lost).toBe(true);
  await capture(page, "void-outcome-unknown");
  await d.getByRole("button", { name: "Đóng", exact: true }).click();
  d = page.getByRole("dialog", { name: "Chi tiết phiếu chi", exact: true });
  await d.getByRole("button", { name: "Đối soát phiếu", exact: true }).click();
  await expect(
    d.getByRole("button", { name: "Đã đối soát, bỏ thao tác đang chờ", exact: true }),
  ).toBeVisible();
  await d.getByRole("button", { name: "Đã đối soát, bỏ thao tác đang chờ", exact: true }).click();
  assert(true, "manual-reconciliation-can-release-pending-without-replay");
  await expect(d.getByText(/Đã hủy bởi/)).toBeVisible();
  assert(
    (await ts.call(`${finance}/payments/${second.payment.id}`)).payload.data.state === "voided",
    "uncertain-void-reconciled",
  );
  await d.getByRole("button", { name: "Đóng", exact: true }).click();
  d = await openVoid(third.payment.code);
  reauthNext = "void";
  await d.getByRole("button", { name: "Xác nhận hủy phiếu", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Xác thực lại", exact: true })).toBeVisible();
  assert(
    (await ts.call(`${finance}/payments/${third.payment.id}`)).payload.data.state === "posted",
    "reauth-does-not-void",
  );
  await capture(page, "void-reauth-required");
  await page.getByLabel("Mật khẩu", { exact: true }).fill(treasurer.password);
  await page.getByRole("button", { name: "Tiếp tục", exact: true }).click();
  d = page.getByRole("dialog", { name: "Chi tiết phiếu chi", exact: true });
  await expect(
    d.getByRole("button", { name: "Kiểm tra kết quả / thử lại", exact: true }),
  ).toBeVisible();
  assert(
    (await ts.call(`${finance}/payments/${third.payment.id}`)).payload.data.state === "posted",
    "reauth-restores-void-intent-without-replay",
  );
  await capture(page, "void-restored-pending");
  await d.getByRole("button", { name: "Kiểm tra kết quả / thử lại", exact: true }).click();
  await expect(d.getByText(/Đã hủy bởi/)).toBeVisible();
  await d.getByRole("button", { name: "Đóng", exact: true }).click();
  await page.getByRole("button", { name: "Đề xuất chi & Duyệt", exact: true }).click();
  await page.getByLabel("Trạng thái", { exact: true }).selectOption("payment_voided");
  await expect(page.getByText(/Phiếu đã hủy: 3/)).toBeVisible();
  await capture(page, "expense-voided-effective-kpi");
  await login(page, c, secretary);
  await page.getByRole("button", { name: `Xem ${first.proposal.code}`, exact: true }).click();
  d = page.getByRole("dialog", { name: "Chi tiết đề xuất chi", exact: true });
  await expect(d.getByText("Phiếu chi đã hủy", { exact: true })).toBeVisible();
  assert(
    (await d.getByRole("button", { name: /Xem PC-/ }).count()) === 0,
    "proposer-no-private-payment-detail",
  );
  assert(
    !(await page.locator("body").innerText()).includes(privateReason),
    "proposer-no-void-private-reason",
  );
  await capture(page, "proposer-voided-minimal");
  await d.getByRole("button", { name: "Lịch sử đề xuất", exact: true }).click();
  const ownHistory = page.getByRole("dialog", { name: "Lịch sử đề xuất", exact: true });
  await expect(ownHistory.getByText(/Hủy phiếu chi/)).toBeVisible();
  assert(
    !(await ownHistory.innerText()).includes(privateReason),
    "proposer-history-translated-without-private-reason",
  );
  await capture(page, "proposer-voided-history");
  await ownHistory.getByRole("button", { name: "Đóng", exact: true }).click();
  await login(page, c, pastor, false);
  await page.getByRole("button", { name: "Dâng hiến & Quỹ", exact: true }).click();
  await expect(page.getByRole("button", { name: "Đối chiếu kỳ", exact: true })).toBeVisible();
  assert(
    (await page.getByRole("button", { name: "Khóa sổ", exact: true }).count()) === 0,
    "pastor-readonly-no-close",
  );
  await capture(page, "pastor-reconcile-readonly");
  await login(page, c, treasurer, false);
  await page.getByRole("button", { name: "Dâng hiến & Quỹ", exact: true }).click();
  await page.getByRole("button", { name: "Tất cả quỹ", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Chọn quỹ", exact: true })
    .getByRole("button", { name: "Quỹ A synthetic", exact: true })
    .click();
  await page.getByRole("button", { name: "Khóa sổ", exact: true }).click();
  await page.getByLabel("Lý do khóa sổ", { exact: true }).fill("Khóa kỳ synthetic toàn Hội Thánh");
  await page.getByRole("button", { name: "Đối chiếu & Xem trước", exact: true }).click();
  await expect(page.getByRole("button", { name: "Xác nhận khóa sổ", exact: true })).toBeVisible();
  assert(
    (await ts.call(`${finance}/periods/${period}`)).payload.data.inspection.summary.netIncome ===
      "9007199254741993",
    "close-scope-ignores-fund-filter",
  );
  await capture(page, "close-preview-all-funds-inline");
  reauthNext = "close";
  await page.getByRole("button", { name: "Xác nhận khóa sổ", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Xác thực lại", exact: true })).toBeVisible();
  assert(
    (await ts.call(`${finance}/periods/${period}`)).payload.data.state === "open",
    "close-reauth-no-write",
  );
  await capture(page, "close-reauth-required");
  await page.getByLabel("Mật khẩu", { exact: true }).fill(treasurer.password);
  await page.getByRole("button", { name: "Tiếp tục", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Kiểm tra kết quả khóa / thử lại", exact: true }),
  ).toBeVisible();
  assert(
    (await ts.call(`${finance}/periods/${period}`)).payload.data.state === "open",
    "close-no-auto-replay-after-reauth",
  );
  loseNext = "close";
  lost = false;
  await page.getByRole("button", { name: "Kiểm tra kết quả khóa / thử lại", exact: true }).click();
  await expect.poll(() => lost).toBe(true);
  await capture(page, "close-outcome-unknown");
  await page.getByRole("button", { name: "Kiểm tra kết quả khóa / thử lại", exact: true }).click();
  await expect(page.getByText(`Đã khóa đến hết ${period}`, { exact: true })).toBeVisible();
  await capture(page, "closed-cutline");
  await page.getByRole("button", { name: "Đối chiếu kỳ", exact: true }).click();
  await expect(page.getByText("Phiếu và sổ khớp", { exact: true })).toBeVisible();
  await capture(page, "closed-cutline-expanded");
  const closed = (await ts.call(`${finance}/periods/${period}`)).payload.data;
  assert(
    closed.state === "closed" &&
      closed.closure.summary.netExpense === "0" &&
      closed.closure.summary.closingBalance === "9007199254741993",
    "closed-summary-exact",
  );
  assert(
    (await db.db.collection("finance_period_closures").countDocuments()) === 1,
    "uncertain-close-one-KS",
  );
  assert(
    (await db.db.collection("finance_ledger").countDocuments({ kind: "payment_void" })) === 3,
    "one-reversal-per-PC",
  );
  await page.getByRole("button", { name: "Xem lịch sử khóa sổ", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Biên bản khóa sổ", exact: true })).toBeVisible();
  await capture(page, "closure-history");
  await page
    .getByRole("dialog", { name: "Biên bản khóa sổ", exact: true })
    .getByRole("button", { name: "Đóng", exact: true })
    .click();
  await page.reload();
  await expect(page.getByText(`Đã khóa đến hết ${period}`, { exact: true })).toBeVisible();
  assert(true, "closed-cutline-survives-reload");
  const old = {
    submissionId: crypto.randomUUID(),
    businessDate: "2020-01-01",
    fundId: fund,
    sourceReference: `LATE-${crypto.randomUUID()}`,
    purpose: "Blocked",
    mode: "aggregate",
    amount: "1",
  };
  assert(
    (await ts.call(`${finance}/receipts/preview`, old)).payload.error.code ===
      "FINANCE_PERIOD_CLOSED",
    "old-missing-period-blocked",
  );
  await login(page, c, member, false);
  await page.goto(`${conf.origin}/${c.code}/giving`);
  await expect(
    page.getByText("Không có quyền xem tài chính.", { exact: true }).first(),
  ).toBeVisible();
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
          "No UAT/physical/Safari/mainruntime/production/independent review",
          "UI-POSTP8-01 AFTER_P8 unchanged",
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
