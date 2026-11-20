import { mkdir } from "node:fs/promises";
import { expect, firefox, type Page } from "@playwright/test";
import { ObjectId } from "mongodb";
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
const evidence = process.env.CHURCH_EVIDENCE_DIR ?? "output/p5.1/browser";
await mkdir(evidence, { recursive: true });
const tls = await localTls("/tmp/church-finance-tls"),
  conf: Config = {
    ...tls,
    cert: tls.cert,
    key: tls.key,
    origin: "https://localhost:3492",
    port: 3492,
    mongoUrl: "mongodb://host.docker.internal:27119/?replicaSet=church-local&directConnection=true",
    redisUrl: "redis://host.docker.internal:6391",
    database: `church_cms_test_browser_p51_${crypto.randomUUID().replaceAll("-", "")}`,
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
  lost = false;
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
  await p.getByRole("button", { name: "Cấu hình", exact: true }).click();
  await p.getByRole("heading", { name: "Quỹ Hội Thánh", exact: true }).waitFor();
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
      const response = await app(req, { ip: "browser-finance" });
      if (
        loseNext &&
        req.method === "POST" &&
        new URL(req.url).pathname.endsWith("/finance/funds") &&
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
    c = await financeChurch(owner, "Hội Thánh kiểm chứng P5.1"),
    ps = client(),
    ts = client(),
    ss = client();
  const pastor = await syntheticUser(owner, ps, c, "pastor"),
    treasurer = await syntheticUser(owner, ts, c, "treasurer"),
    secretary = await syntheticUser(owner, ss, c, "secretary");
  secrets.push(o.password, pastor.password, treasurer.password, secretary.password);
  await login(page, c, pastor);
  await expect(
    page.getByText("Chưa cấu hình. Chưa có quyền nghiệp vụ đề xuất hoặc duyệt được bật."),
  ).toBeVisible();
  assert(true, "unconfigured-no-implicit-policy");
  const finance = page.getByRole("region", { name: "Cấu hình tài chính", exact: true });
  await finance.getByLabel("Thư ký Ban Chấp sự", { exact: true }).check();
  await finance.getByLabel("Vai trò phê duyệt", { exact: true }).selectOption("pastor");
  await finance.getByRole("button", { name: "Lưu", exact: true }).click();
  await finance.getByRole("button", { name: "Lịch sử thay đổi", exact: true }).waitFor();
  assert(
    (await ps.call(`${financeRoot(c)}/settings`)).payload.data.settings.approverRole === "pastor",
    "UI-saved-config-real-readback",
  );
  await page.getByRole("button", { name: "Thêm quỹ", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Tên quỹ", { exact: true }).fill("Quỹ Truyền giáo synthetic");
  await dialog.getByLabel("Tên quỹ", { exact: true }).focus();
  await page.keyboard.press("Shift+Tab");
  assert(
    await page.evaluate(() => !!document.activeElement?.closest("dialog[open]")),
    "modal-focus-contained",
  );
  await page.keyboard.press("Tab");
  await capture(page, "fund-create");
  await dialog.getByRole("button", { name: "Lưu", exact: true }).click();
  await dialog.waitFor({ state: "hidden" });
  await page.getByRole("cell", { name: "Quỹ Truyền giáo synthetic", exact: true }).waitFor();
  assert(
    await page
      .getByRole("button", { name: "Thêm quỹ", exact: true })
      .evaluate((e) => document.activeElement === e),
    "modal-returns-focus",
  );
  await page
    .getByRole("button", { name: "Đổi tên Quỹ Truyền giáo synthetic", exact: true })
    .click();
  await dialog.getByLabel("Tên quỹ", { exact: true }).fill("Quỹ truyền giáo đã đổi");
  await dialog.getByRole("button", { name: "Lưu", exact: true }).click();
  await dialog.waitFor({ state: "hidden" });
  await page.getByRole("cell", { name: "Quỹ truyền giáo đã đổi", exact: true }).waitFor();
  await page
    .getByRole("row")
    .filter({ hasText: "Quỹ truyền giáo đã đổi" })
    .getByRole("button", { name: "Ngừng dùng", exact: true })
    .click();
  await dialog.getByLabel("Lý do", { exact: true }).fill("Ngừng dùng synthetic");
  await dialog.getByRole("button", { name: "Ngừng dùng", exact: true }).click();
  await dialog.waitFor({ state: "hidden" });
  await finance.getByLabel("Trạng thái quỹ", { exact: true }).selectOption("inactive");
  await page.getByRole("cell", { name: "Quỹ truyền giáo đã đổi", exact: true }).waitFor();
  await page
    .getByRole("row")
    .filter({ hasText: "Quỹ truyền giáo đã đổi" })
    .getByRole("button", { name: "Khôi phục", exact: true })
    .click();
  await dialog.getByLabel("Lý do", { exact: true }).fill("Khôi phục synthetic");
  await dialog.getByRole("button", { name: "Khôi phục", exact: true }).click();
  await dialog.waitFor({ state: "hidden" });
  await finance.getByLabel("Trạng thái quỹ", { exact: true }).selectOption("active");
  await page.getByRole("cell", { name: "Quỹ truyền giáo đã đổi", exact: true }).waitFor();
  await page
    .getByRole("row")
    .filter({ hasText: "Quỹ truyền giáo đã đổi" })
    .getByRole("button", { name: "Lịch sử", exact: true })
    .click();
  await dialog.getByText("Lý do: Khôi phục synthetic", { exact: true }).waitFor();
  assert(
    await dialog.getByText("Lý do: Ngừng dùng synthetic", { exact: true }).isVisible(),
    "lifecycle-immutable-history-visible",
  );
  await capture(page, "fund-history");
  await dialog.getByText("Đóng", { exact: true }).click();
  // Same-version conflict is caused by an actual API edit while the UI holds its original revision.
  await page.getByRole("button", { name: "Đổi tên Quỹ truyền giáo đã đổi", exact: true }).click();
  const before = (await ps.call(`${financeRoot(c)}/funds`)).payload.data.items[0];
  await ps.call(
    `${financeRoot(c)}/funds/${before.id}`,
    { name: "Bản khác đã sửa" },
    { method: "PATCH", version: before.version },
  );
  await dialog.getByLabel("Tên quỹ", { exact: true }).fill("Không ghi đè");
  await dialog.getByRole("button", { name: "Lưu", exact: true }).click();
  await dialog.getByRole("button", { name: "Tải bản mới", exact: true }).waitFor();
  assert(
    (await ps.call(`${financeRoot(c)}/funds/${before.id}`)).payload.data.name === "Bản khác đã sửa",
    "CAS-no-overwrite",
  );
  await dialog.getByRole("button", { name: "Tải bản mới", exact: true }).click();
  await expect(dialog.getByLabel("Tên quỹ", { exact: true })).toHaveValue("Bản khác đã sửa");
  assert(true, "CAS-explicit-reload");
  await dialog.getByRole("button", { name: "Hủy", exact: true }).click();
  loseNext = true;
  await page.getByRole("button", { name: "Thêm quỹ", exact: true }).click();
  await dialog.getByLabel("Tên quỹ", { exact: true }).fill("Quỹ mất phản hồi");
  await dialog.getByRole("button", { name: "Lưu", exact: true }).click();
  await dialog.getByRole("button", { name: "Kiểm tra kết quả", exact: true }).waitFor();
  await expect(dialog.getByRole("button", { name: "Kiểm tra kết quả", exact: true })).toBeEnabled();
  assert(lost, "response-lost-after-real-commit");
  await db.sessions.updateMany(
    {
      realm: "church",
      principalId: new ObjectId(pastor.id),
      kind: "full",
      revokedAt: { $exists: false },
    },
    { $set: { lastActivityAt: new Date(Date.now() - 16 * 60000) } },
  );
  await dialog.getByRole("button", { name: "Kiểm tra kết quả", exact: true }).click();
  await page.getByRole("heading", { name: "Xác thực lại", exact: true }).waitFor();
  await page.getByLabel("Mật khẩu", { exact: true }).fill(pastor.password);
  await page.getByRole("button", { name: "Tiếp tục", exact: true }).click();
  await expect(
    page
      .getByRole("region", { name: "Cấu hình tài chính", exact: true })
      .getByRole("button", { name: "Kiểm tra kết quả", exact: true }),
  ).toBeEnabled();
  assert(
    (await page.getByRole("button", { name: "Kiểm tra kết quả", exact: true }).count()) === 1,
    "finance-pending-does-not-enter-organization-reconciliation",
  );
  assert(
    (await db.db
      .collection("finance_funds")
      .countDocuments({ churchId: new ObjectId(c.id), name: "Quỹ mất phản hồi" })) === 1,
    "reauth-no-auto-finance-replay",
  );
  await page.getByRole("button", { name: "Kiểm tra kết quả", exact: true }).click();
  await page.getByRole("cell", { name: "Quỹ mất phản hồi", exact: true }).waitFor();
  assert(
    (await db.db
      .collection("finance_funds")
      .countDocuments({ churchId: new ObjectId(c.id), name: "Quỹ mất phản hồi" })) === 1,
    "same-intent-replay-one-fund",
  );
  await page.reload();
  await page.getByRole("cell", { name: "Quỹ mất phản hồi", exact: true }).waitFor();
  await capture(page, "pastor-config");
  const tp = await context.newPage();
  await login(tp, c, treasurer);
  assert(
    (await tp.getByRole("button", { name: "Thêm quỹ", exact: true }).count()) === 0,
    "treasurer-no-create-control",
  );
  assert(
    await tp.getByLabel("Vai trò phê duyệt", { exact: true }).isDisabled(),
    "treasurer-config-readonly",
  );
  assert(
    (await tp.getByRole("heading", { name: "Ban phục vụ", exact: true }).count()) === 0,
    "treasurer-no-organization-data",
  );
  await capture(tp, "treasurer-config");
  await tp.getByRole("button", { name: "Phân quyền", exact: true }).click();
  await tp.getByRole("cell", { name: /Duyệt\/từ chối người khác; cấm tự quyết định/ }).waitFor();
  assert(true, "W13-current-config-expense-approval-and-payment-unavailable");
  const op = await context.newPage();
  await op.goto(`${conf.origin}/owner/login`);
  await op.getByLabel("Email", { exact: true }).fill(o.email);
  await op.getByLabel("Mật khẩu", { exact: true }).fill(o.password);
  await op.getByRole("button", { name: "Đăng nhập", exact: true }).click();
  await op.getByRole("button", { name: "Thêm Hội Thánh", exact: true }).waitFor();
  await op.goto(`${conf.origin}/owner/churches/${c.id}/config`);
  await op.getByRole("heading", { name: "Ban phục vụ", exact: true }).waitFor();
  assert(
    (await op.getByRole("region", { name: "Cấu hình tài chính", exact: true }).count()) === 0,
    "owner-organization-only",
  );
  assert(
    (await owner.call(`owner/${financeRoot(c)}/settings`)).status === 403,
    "owner-backend-finance-denied",
  );
  const sp = await context.newPage();
  await sp.goto(`${conf.origin}/${c.code}/login`);
  await sp.getByRole("button", { name: "Đăng xuất", exact: true }).click();
  await sp.getByLabel("Email", { exact: true }).fill(secretary.email);
  await sp.getByLabel("Mật khẩu", { exact: true }).fill(secretary.password);
  await sp.getByRole("button", { name: "Đăng nhập", exact: true }).click();
  await sp.getByRole("button", { name: "Cấu hình", exact: true }).click();
  await sp.getByRole("heading", { name: "Ban phục vụ", exact: true }).waitFor();
  assert(
    (await sp.getByRole("region", { name: "Cấu hình tài chính", exact: true }).count()) === 0,
    "secretary-no-finance-data",
  );
  assert(
    await sp.getByLabel("Khác", { exact: true }).isDisabled(),
    "secretary-organization-still-readonly",
  );
  assert(errors.length === 0, "no-page-errors");
  assert(!secrets.some((secret) => JSON.stringify(logs).includes(secret)), "logs-no-passwords");
  const report = {
    status: "PASS",
    checks,
    errors,
    limits: [
      "Firefox/private CA/local synthetic only",
      "No physical/Safari/UAT/main runtime/production proof",
      "No future financial commands",
    ],
  };
  await Bun.write(`${evidence}/browser-results.json`, JSON.stringify(report, null, 2));
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
