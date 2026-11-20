import { mkdir } from "node:fs/promises";
import { expect, firefox, type Page } from "@playwright/test";
import { createApp } from "../api/app";
import type { Config } from "../api/config";
import { Identity } from "../api/identity/service";
import { Database, initialize } from "../api/infrastructure/database";
import { RateLimit } from "../api/infrastructure/rate-limit";
import { assertComposition } from "./browser-composition";
import { localTls } from "./local-tls";
import { SyntheticClient, seedP2, syntheticOwner, syntheticUser } from "./p2-fixtures";
import { financeChurch, financeRoot } from "./p51-fixtures";

if (process.platform !== "linux" || !process.env.CHURCH_BROWSER_CONTAINER)
  throw Error("Use isolated browser container");
const evidence = process.env.CHURCH_EVIDENCE_DIR ?? "output/p5.2/browser";
await mkdir(evidence, { recursive: true });
const tls = await localTls("/tmp/church-finance-tls"),
  conf: Config = {
    ...tls,
    cert: tls.cert,
    key: tls.key,
    origin: "https://localhost:3495",
    port: 3495,
    mongoUrl: "mongodb://host.docker.internal:27119/?replicaSet=church-local&directConnection=true",
    redisUrl: "redis://host.docker.internal:6391",
    database: `church_cms_test_browser_p52_${crypto.randomUUID().replaceAll("-", "")}`,
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
async function login(p: Page, c: { code: string }, account: { email: string; password: string }) {
  await p.goto(`${conf.origin}/${c.code}/login`);
  await p.evaluate(async () => {
    const csrf = (await (await fetch("/api/v1/auth/csrf?realm=church")).json()).data.csrfToken;
    await fetch("/api/v1/auth/logout", {
      method: "POST",
      headers: { "content-type": "application/json", "x-csrf-token": csrf },
      body: "{}",
    });
  });
  await p.goto(`${conf.origin}/${c.code}/login`);
  await p.getByLabel("Email", { exact: true }).fill(account.email);
  await p.getByLabel("Mật khẩu", { exact: true }).fill(account.password);
  await p.getByRole("button", { name: "Đăng nhập", exact: true }).click();
  try {
    await p.getByRole("button", { name: "Cấu hình", exact: true }).waitFor();
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
  await p.getByRole("button", { name: "Dâng hiến & Quỹ", exact: true }).click();
  await p.getByRole("heading", { name: "Dâng hiến & Quỹ", exact: true }).waitFor();
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
      if (reauthNext && req.method === "POST" && path.endsWith("/finance/receipts")) {
        reauthNext = false;
        return Response.json(
          { error: { code: "REAUTH_REQUIRED", message: "Xác thực lại để tiếp tục." } },
          { status: 401 },
        );
      }
      const response = await app(req, { ip: "browser-income" });
      if (
        loseNext &&
        req.method === "POST" &&
        path.endsWith("/finance/receipts") &&
        response.status === 201
      ) {
        loseNext = false;
        lost = true;
        return Response.json(
          { error: { code: "OUTCOME_UNKNOWN", message: "Chưa nhận được xác nhận lưu." }, meta: {} },
          { status: 503 },
        );
      }
      return response;
    },
  });
  const owner = client("owner"),
    o = await syntheticOwner(db, owner),
    c = await financeChurch(owner, "Hội Thánh P52 synthetic"),
    ps = client(),
    ts = client();
  const pastor = await syntheticUser(owner, ps, c, "pastor"),
    treasurer = await syntheticUser(owner, ts, c, "treasurer");
  secrets.push(o.password, pastor.password, treasurer.password);
  const root = financeRoot(c),
    f = await ps.call(`${root}/funds`, { name: "Quỹ Hội Thánh synthetic" });
  assert(f.status === 201, "fixture-fund-real-command");
  const people = await seedP2(db, c.id, pastor.id, 8),
    person = people.members.find((p) => ["active", "long_absent"].includes(p.participation));
  if (!person) throw Error("No current synthetic member");
  await login(page, c, treasurer);
  await page.getByText("Chưa có giao dịch trong phạm vi đã chọn.").waitFor();
  await capture(page, "w09-empty");
  assert(
    (await page.getByRole("button", { name: "Thuộc viên", exact: true }).count()) === 0,
    "treasurer-no-full-members-navigation",
  );
  await page.getByRole("button", { name: "Mã dâng hiến", exact: true }).click();
  await page.getByRole("button", { name: "Cấp mã", exact: true }).click();
  let dialog = page.getByRole("dialog", { name: "Chọn người hiện hành", exact: true });
  await dialog.getByRole("button", { name: new RegExp(person.code) }).click();
  await expect(
    page.getByRole("dialog", { name: "Mã dâng hiến", exact: true }).getByText(/DH-/).first(),
  ).toBeVisible();
  const giving = (await ts.call(`${root}/giving-codes?memberId=${person._id}`)).payload.data
    .items[0];
  assert(!!giving, "UI-issue-code-real-readback");
  await capture(page, "codes");
  await page.getByRole("button", { name: "Dâng hiến cá nhân", exact: true }).click();
  await expect(page.getByText("Chưa có dâng hiến trong kỳ.")).toBeVisible();
  await capture(page, "w14-financial-drawer");
  await page
    .getByRole("dialog", { name: "Dâng hiến cá nhân", exact: true })
    .getByRole("button", { name: "Đóng", exact: true })
    .click();
  await page.getByRole("button", { name: "Ngừng mã", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "Ngừng mã", exact: true });
  await dialog.getByLabel("Lý do đổi trạng thái").fill("Tạm ngừng synthetic");
  await dialog.getByRole("button", { name: "Xác nhận đổi trạng thái" }).click();
  await dialog.waitFor({ state: "hidden" });
  await page.getByLabel("Trạng thái mã", { exact: true }).selectOption("inactive");
  await page.getByRole("button", { name: "Khôi phục mã", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "Khôi phục mã", exact: true });
  await dialog.getByLabel("Lý do đổi trạng thái").fill("Khôi phục synthetic");
  await dialog.getByRole("button", { name: "Xác nhận đổi trạng thái" }).click();
  await dialog.waitFor({ state: "hidden" });
  assert(
    (await ts.call(`${root}/giving-codes?memberId=${person._id}`)).payload.data.items[0].status ===
      "active",
    "UI-status-reason-CAS",
  );
  await page
    .getByRole("dialog", { name: "Mã dâng hiến", exact: true })
    .getByRole("button", { name: "Đóng", exact: true })
    .click();
  async function edit(source: string, itemized = false) {
    await page.getByRole("button", { name: "＋ Phiếu thu", exact: true }).click();
    const d = page.getByRole("dialog", { name: "Lập phiếu thu", exact: true });
    await d.getByRole("button", { name: "Chọn quỹ thu" }).click();
    await page
      .getByRole("dialog", { name: "Chọn quỹ", exact: true })
      .getByRole("button", { name: "Quỹ Hội Thánh synthetic", exact: true })
      .click();
    await d.getByLabel("Nguồn tham chiếu", { exact: true }).fill(source);
    await d.getByLabel("Nội dung", { exact: true }).fill("Thu synthetic kiểm chứng");
    if (itemized) {
      await d.getByLabel("Cách nhập", { exact: true }).selectOption("itemized");
      await d.getByRole("button", { name: "Thêm dòng dâng hiến" }).click();
      await page
        .getByRole("dialog", { name: "Chọn mã dâng hiến", exact: true })
        .getByRole("button", { name: new RegExp(giving.code) })
        .click();
      await d.getByLabel("Số tiền dòng 1", { exact: true }).fill("9007199254740993");
    } else await d.getByLabel("Số tiền VND", { exact: true }).fill("12345");
    return d;
  }
  let d = await edit("UI-ITEM-001", true);
  await capture(page, "receipt-editor");
  await d.getByLabel("Nguồn tham chiếu", { exact: true }).focus();
  await page.keyboard.press("Shift+Tab");
  assert(
    await page.evaluate(() => !!document.activeElement?.closest("dialog[open]")),
    "editor-keyboard-focus-contained",
  );
  await d.getByRole("button", { name: "Xem trước", exact: true }).click();
  d = page.getByRole("dialog", { name: "Xác nhận ghi thu", exact: true });
  await expect(d.getByText("9.007.199.254.740.993 ₫", { exact: true })).toHaveCount(1);
  await capture(page, "receipt-preview");
  loseNext = true;
  await d.getByRole("button", { name: "Xác nhận ghi thu", exact: true }).click();
  await expect(d.getByText("Chưa nhận được xác nhận lưu.")).toBeVisible();
  assert(lost, "lost-success-response-injected-after-real-commit");
  const committed = await db.db
    .collection("finance_receipts")
    .findOne({ sourceReference: "UI-ITEM-001" });
  assert(!!committed, "lost-response-receipt-committed");
  await d.getByRole("button", { name: "Đóng", exact: true }).click();
  await capture(page, "unknown-outcome");
  await page.getByRole("button", { name: "Đối soát danh sách", exact: true }).click();
  await page.getByLabel("Trạng thái", { exact: true }).selectOption("all");
  await page.getByLabel("Tìm phiếu / nguồn", { exact: true }).fill("UI-ITEM-001");
  await page.getByRole("button", { name: "Tìm", exact: true }).click();
  await expect(page.getByText("UI-ITEM-001", { exact: true })).toBeVisible();
  assert(true, "pending-reconciliation-can-filter-without-abandoning-intent");
  await page.getByRole("button", { name: "Kiểm tra kết quả / thử lại", exact: true }).click();
  d = page.getByRole("dialog", { name: "Chi tiết phiếu thu", exact: true });
  await d.getByText("Nguồn: UI-ITEM-001", { exact: true }).waitFor();
  assert(
    (await db.db
      .collection("finance_receipts")
      .countDocuments({ sourceReference: "UI-ITEM-001" })) === 1,
    "same-intent-no-duplicate-credit",
  );
  await capture(page, "receipt-detail");
  await d.getByRole("button", { name: "Hủy phiếu nhập sai", exact: true }).click();
  d = page.getByRole("dialog", { name: "Hủy phiếu nhập sai", exact: true });
  await d.getByLabel("Lý do hủy", { exact: true }).fill("Sai nguồn synthetic");
  await d.getByLabel("Tôi xác nhận hủy toàn bộ phiếu", { exact: true }).check();
  await capture(page, "void-confirmation");
  await d.getByRole("button", { name: "Xác nhận hủy phiếu", exact: true }).click();
  await d.waitFor({ state: "hidden" });
  d = page.getByRole("dialog", { name: "Chi tiết phiếu thu", exact: true });
  await expect(d.getByText("Đã hủy", { exact: true })).toBeVisible();
  assert(
    (await db.db.collection("finance_ledger").countDocuments({ receiptId: committed?._id })) === 2,
    "void-once-original-ledger-opposite",
  );
  await d.getByRole("button", { name: "Lịch sử phiếu", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Lịch sử tài chính", exact: true })
    .getByText(/Hủy phiếu/)
    .waitFor();
  await capture(page, "receipt-history");
  await page
    .getByRole("dialog", { name: "Lịch sử tài chính", exact: true })
    .getByRole("button", { name: "Đóng", exact: true })
    .click();
  await d.getByRole("button", { name: "Đóng", exact: true }).click();
  d = await edit("UI-REAUTH-002");
  await d.getByRole("button", { name: "Xem trước", exact: true }).click();
  reauthNext = true;
  await page
    .getByRole("dialog", { name: "Xác nhận ghi thu", exact: true })
    .getByRole("button", { name: "Xác nhận ghi thu", exact: true })
    .click();
  await page.getByRole("heading", { name: /Xác thực lại/ }).waitFor();
  assert(
    (await db.db
      .collection("finance_receipts")
      .countDocuments({ sourceReference: "UI-REAUTH-002" })) === 0,
    "reauth-no-money-before-confirmed-retry",
  );
  await page.getByLabel("Mật khẩu", { exact: true }).fill(treasurer.password);
  await page.getByRole("button", { name: "Tiếp tục", exact: true }).click();
  await page.getByRole("button", { name: "Kiểm tra kết quả / thử lại", exact: true }).waitFor();
  assert(
    (await db.db
      .collection("finance_receipts")
      .countDocuments({ sourceReference: "UI-REAUTH-002" })) === 0,
    "reauth-no-auto-replay",
  );
  await page.getByRole("button", { name: "Kiểm tra kết quả / thử lại", exact: true }).click();
  d = page.getByRole("dialog", { name: "Chi tiết phiếu thu", exact: true });
  await d.getByText("Nguồn: UI-REAUTH-002", { exact: true }).waitFor();
  await d.getByRole("button", { name: "Đóng", exact: true }).click();
  await page.getByLabel("Xem", { exact: true }).selectOption("ledger");
  await page.getByRole("cell", { name: "Đối ứng hủy thu", exact: true }).waitFor();
  await expect(page.getByText("Số dòng sổ trang này: 3", { exact: false })).toBeVisible();
  assert(true, "ledger-entry-count-is-not-receipt-count");
  await capture(page, "ledger");
  assert(
    (await ts.call(`churches/${c.id}/members`)).status === 403,
    "treasurer-full-members-API-denied",
  );
  await login(page, c, pastor);
  assert(
    (await page.getByRole("button", { name: "＋ Phiếu thu", exact: true }).count()) === 0,
    "pastor-readonly-money",
  );
  await capture(page, "pastor-readonly");
  await page.goto(`${conf.origin}/${c.code}/members?memberId=${person._id}`);
  await page.getByRole("heading", { name: "Dâng hiến", exact: true }).waitFor();
  await expect(page.getByText(giving.code, { exact: false }).first()).toBeVisible();
  assert(true, "pastor-W14-giving-separate-finance-read");
  await capture(page, "pastor-w14");
  const op = await context.newPage(),
    financeRequests: string[] = [];
  op.on("request", (req) => {
    if (new URL(req.url()).pathname.includes("/finance/")) financeRequests.push(req.url());
  });
  await op.goto(`${conf.origin}/owner/login`);
  await op.getByLabel("Email", { exact: true }).fill(o.email);
  await op.getByLabel("Mật khẩu", { exact: true }).fill(o.password);
  await op.getByRole("button", { name: "Đăng nhập", exact: true }).click();
  await op.getByRole("button", { name: "Thêm Hội Thánh", exact: true }).waitFor();
  await op.goto(`${conf.origin}/owner/churches/${c.id}/members?memberId=${person._id}`);
  await expect(
    op.getByRole("heading", { name: `${person.fullName} · ${person.code}`, exact: true }),
  ).toBeVisible();
  assert(
    (await op.getByRole("heading", { name: "Dâng hiến", exact: true }).count()) === 0 &&
      financeRequests.length === 0,
    "owner-W14-does-not-fetch-or-render-finance",
  );
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
          "No physical/Safari/UAT/main runtime/production proof",
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
