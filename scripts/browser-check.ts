import { mkdir } from "node:fs/promises";
import { firefox } from "@playwright/test";
import { ObjectId } from "mongodb";
import { createApp } from "../api/app";
import type { Config } from "../api/config";
import { OwnerOperations } from "../api/identity/owner-operations";
import { Identity } from "../api/identity/service";
import { Database, initialize } from "../api/infrastructure/database";
import { RateLimit } from "../api/infrastructure/rate-limit";
import { localTls } from "./local-tls";

const evidence = process.env.CHURCH_EVIDENCE_DIR ?? "output/p1.3";
// Only executed in the disposable browser container; CA trust is private to its Firefox profile.
if (process.platform !== "linux" || !process.env.CHURCH_BROWSER_CONTAINER)
  throw new Error("Use the isolated browser container");
const conf: Config = {
  cert: "/tmp/church-cert.pem",
  key: "/tmp/church-key.pem",
  origin: "https://localhost:3448",
  port: 3448,
  mongoUrl: "mongodb://host.docker.internal:27119/?replicaSet=church-local&directConnection=true",
  redisUrl: "redis://host.docker.internal:6391",
  database: `church_cms_test_browser_${crypto.randomUUID().replaceAll("-", "")}`,
  csrfKey: crypto.randomUUID() + crypto.randomUUID(),
};
const tls = await localTls("/tmp/church-tls");
conf.cert = tls.cert;
conf.key = tls.key;
const db = new Database(conf),
  rate = new RateLimit(conf.redisUrl, conf.csrfKey);
let server: ReturnType<typeof Bun.serve> | undefined;
await mkdir("/tmp/church-firefox", { recursive: true });
for (const command of [
  ["certutil", "-N", "--empty-password", "-d", "sql:/tmp/church-firefox"],
  [
    "certutil",
    "-A",
    "-d",
    "sql:/tmp/church-firefox",
    "-n",
    "Church local verification CA",
    "-t",
    "C,,",
    "-i",
    tls.ca,
  ],
]) {
  const result = Bun.spawnSync(command);
  if (result.exitCode !== 0) throw new Error("Isolated certificate import failed");
}
const context = await firefox.launchPersistentContext("/tmp/church-firefox", {
  headless: true,
  viewport: { width: 1440, height: 1000 },
});
const page = await context.newPage();
page.setDefaultTimeout(15000);
page.setDefaultNavigationTimeout(15000);
const errors: string[] = [];
page.on("pageerror", (error) => errors.push(error.message));
const result: { check: string; status: string }[] = [];
function assert(condition: unknown, label: string): asserts condition {
  if (!condition) throw new Error(label);
  result.push({ check: label, status: "PASS" });
  console.info(label);
}
async function checkVisibleNavigation() {
  for (const theme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: theme });
    for (const width of [1440, 901, 900, 560, 390]) {
      await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 });
      await page.evaluate(async () => {
        window.scrollTo(0, 0);
        await document.fonts.ready;
      });
      if (width <= 900) {
        await page.getByRole("button", { name: "Mở điều hướng", exact: true }).click();
        await page.locator(".side.open").waitFor();
        await page
          .locator(".side")
          .evaluate((el) => Promise.all(el.getAnimations().map((animation) => animation.finished)));
      }
      const labels = page.locator(".side .ui-nav-label"),
        description = page.locator(".side .ui-nav-description");
      const expectedLabels = [
        "Tổng quan",
        "Hội Thánh",
        "Tài khoản",
        "Thuộc viên",
        "Gia đình",
        "Ban ngành & Khu vực",
        "Phân quyền",
        "Điểm danh",
        "Sổ lễ nghi",
        "Cấu hình",
      ];
      assert(
        (await labels.count()) === expectedLabels.length &&
          (
            await Promise.all(
              expectedLabels.map(
                async (label, i) =>
                  (await labels.nth(i).isVisible()) && (await labels.nth(i).innerText()) === label,
              ),
            )
          ).every(Boolean),
        `nav-${theme}-${width}-real-visible-text`,
      );
      assert(
        (await description.count()) === expectedLabels.length - 1 &&
          (
            await Promise.all(
              Array.from(
                { length: expectedLabels.length - 1 },
                async (_, i) =>
                  (await description.nth(i).isVisible()) &&
                  (await description.nth(i).innerText()) === "Chọn Hội Thánh trước",
              ),
            )
          ).every(Boolean),
        `nav-${theme}-${width}-disabled-description-visible`,
      );
      const buttons = page.locator(".side .nav-a");
      assert(
        (await buttons.count()) === expectedLabels.length &&
          (
            await Promise.all(
              Array.from({ length: expectedLabels.length }, async (_, i) =>
                i === 1
                  ? (await buttons.nth(i).isEnabled()) &&
                    (await buttons.nth(i).getAttribute("aria-current")) === "page"
                  : await buttons.nth(i).isDisabled(),
              ),
            )
          ).every(Boolean),
        `nav-${theme}-${width}-active-disabled-preserved`,
      );
      assert(
        await page.locator(".side").evaluate((side) => {
          const bounds = side.getBoundingClientRect();
          return Array.from(
            side.querySelectorAll<HTMLElement>(".ui-nav-label,.ui-nav-description"),
          ).every((label) => {
            const r = label.getBoundingClientRect(),
              button = label.closest("button");
            if (!button) return false;
            const b = button.getBoundingClientRect();
            return (
              r.width > 0 &&
              r.height > 0 &&
              label.scrollWidth <= label.clientWidth + 1 &&
              r.left >= b.left &&
              r.right <= b.right &&
              r.left >= bounds.left &&
              r.right <= bounds.right &&
              getComputedStyle(label).color === getComputedStyle(button).color
            );
          });
        }),
        `nav-${theme}-${width}-labels-contained-and-inherit-colors`,
      );
      assert(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        `nav-${theme}-${width}-no-page-overflow`,
      );
      await page.mouse.move(0, 0);
      if ([1440, 390].includes(width)) {
        await page.screenshot({ path: `${evidence}/regression/nav-${width}-${theme}.png` });
        await page.screenshot({
          path: `${evidence}/regression/nav-crop-${width}-${theme}.png`,
          clip: { x: 0, y: 0, width: width <= 900 ? 272 : 256, height: 260 },
        });
      }
      if (width <= 900) {
        await page.keyboard.press("Escape");
        await page.waitForFunction(
          () => document.activeElement?.getAttribute("aria-label") === "Mở điều hướng",
        );
        assert(
          await page
            .getByRole("button", { name: "Mở điều hướng", exact: true })
            .evaluate((el) => el === document.activeElement),
          `nav-${theme}-${width}-Escape-focus-preserved`,
        );
      }
    }
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.emulateMedia({ colorScheme: "light" });
  const refreshed = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/v1/owner/churches" &&
      response.request().method() === "GET",
  );
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Hội Thánh", exact: true })
    .click();
  assert((await refreshed).ok(), "visible-navigation-keeps-real-O01-caller");
}
async function captureScreen(name: string) {
  for (const theme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: theme });
    for (const width of [1440, 900, 560, 390]) {
      await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 });
      await page.evaluate(async () => {
        window.scrollTo(0, 0);
        await document.fonts.ready;
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      });
      await page.mouse.move(0, 0);
      assert(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        `${name}-${theme}-${width}-page-bounded`,
      );
      if (width <= 560) {
        const mobile = await page.evaluate(() => {
          const visible = (el: HTMLElement) =>
            el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden";
          return {
            targets: Array.from(document.querySelectorAll<HTMLElement>("button, .opt"))
              .filter(visible)
              .every((el) => el.getBoundingClientRect().height >= 44),
            fields: Array.from(document.querySelectorAll<HTMLElement>(".input,.select"))
              .filter(visible)
              .every(
                (el) =>
                  el.getBoundingClientRect().height >= 44 &&
                  Number.parseFloat(getComputedStyle(el).fontSize) >= 16,
              ),
          };
        });
        assert(
          mobile.targets && mobile.fields,
          `${name}-${theme}-${width}-shared-mobile-targets-font`,
        );
      }
      if (name === "o02") {
        assert(
          (await page
            .locator(".church-record-columns")
            .evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(" ").length)) ===
            (width <= 900 ? 1 : 2),
          `${name}-${theme}-${width}-info-columns`,
        );
      }
      if ([1440, 390].includes(width))
        await page.screenshot({
          path: `${evidence}/regression/ui-std-owner-${name}-${width}-${theme}.png`,
        });
    }
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.emulateMedia({ colorScheme: "light" });
}
try {
  await db.client.connect();
  await initialize(db.db);
  await rate.connect();
  const identity = new Identity(db, rate, conf);
  await identity.initialize();
  const app = createApp(identity, conf, { log: () => {} });
  server = Bun.serve({
    hostname: "127.0.0.1",
    port: 3448,
    tls: { cert: Bun.file(conf.cert), key: Bun.file(conf.key) },
    fetch: (req) => app(req, { ip: "browser-container" }),
  });
  const fixture = await new OwnerOperations(db).create({
    email: `ui-${crypto.randomUUID()}@example.test`,
    displayName: "Owner kiểm thử",
  });
  const secret = `Mật khẩu mới 🌿 ${crypto.randomUUID()}`;
  await page.goto(`${conf.origin}/owner/login`);
  await page.getByRole("heading", { name: "Đăng nhập", exact: true }).waitFor();
  await page.evaluate(() => document.fonts.ready);
  await captureScreen("a01");
  await page.screenshot({
    path: `${evidence}/regression/ui-std-owner-login-desktop.png`,
    fullPage: false,
  });
  await page.getByLabel("Email", { exact: true }).fill(fixture.email);
  await page.getByLabel("Mật khẩu", { exact: true }).fill(fixture.temporaryPassword);
  await page.getByLabel("Mật khẩu", { exact: true }).press("Enter");
  await page.getByRole("heading", { name: "Đổi mật khẩu", exact: true }).waitFor();
  assert(
    await page.getByText("8–128 ký tự", { exact: true }).isVisible(),
    "temp-login-limited-A04",
  );
  await captureScreen("a04");
  // Capture before entering secrets; all identities in this suite are synthetic.
  await page.screenshot({
    path: `${evidence}/regression/ui-std-owner-change-desktop.png`,
    fullPage: false,
  });
  await page.getByLabel("Mật khẩu mới", { exact: true }).fill(secret);
  await page.getByLabel("Nhập lại mật khẩu", { exact: true }).fill(secret);
  await page.getByRole("button", { name: "Lưu mật khẩu", exact: true }).click();
  await page.getByText("Đã đổi mật khẩu.", { exact: true }).waitFor();
  assert(
    (await page.getByLabel("Email", { exact: true }).inputValue()) === fixture.email,
    "changed-return-login-email-preserved",
  );
  assert(
    (await page.getByLabel("Mật khẩu", { exact: true }).inputValue()) === "",
    "password-fields-cleared",
  );
  await page.getByLabel("Mật khẩu", { exact: true }).fill(secret);
  await page.getByRole("button", { name: "Đăng nhập", exact: true }).click();
  await page.getByRole("heading", { name: "Hội Thánh", exact: true }).waitFor();
  // The heading renders before the asynchronous church list finishes loading.
  await page.getByText("Chưa có dữ liệu Hội Thánh để hiển thị.", { exact: true }).waitFor();
  assert(
    await page.getByText("Chưa có dữ liệu Hội Thánh để hiển thị.", { exact: true }).isVisible(),
    "full-login-O01-empty",
  );
  await checkVisibleNavigation();
  await page.screenshot({
    path: `${evidence}/regression/ui-std-owner-owner-desktop.png`,
    fullPage: false,
  });
  // Network failure after login must recover the existing full session without bootstrap confusion.
  await page.route(
    "**/api/v1/owner/auth/me",
    async (route) =>
      route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({
          error: { code: "DEPENDENCY_UNAVAILABLE", message: "Dịch vụ tạm thời không khả dụng." },
          meta: { requestId: "synthetic-network-fault" },
        }),
      }),
    { times: 1 },
  );
  await page.reload();
  await page.getByRole("heading", { name: "Đăng nhập", exact: true }).waitFor();
  await page.getByLabel("Email", { exact: true }).fill(fixture.email);
  await page.getByLabel("Mật khẩu", { exact: true }).fill(secret);
  await page.getByRole("button", { name: "Đăng nhập", exact: true }).click();
  await page.getByRole("heading", { name: "Hội Thánh", exact: true }).waitFor();
  assert(true, "recover-existing-session-after-me-network-failure");
  const browserCookies = await context.cookies();
  assert(
    browserCookies
      .filter((c) => c.name === "__Host-qlht_owner_session")
      .every((c) => c.secure && c.httpOnly && c.sameSite === "Lax"),
    "browser-secure-cookie",
  );
  const current = await db.sessions.findOne({
    realm: "owner",
    principalId: new ObjectId(fixture.employeeId),
    kind: "full",
    revokedAt: { $exists: false },
  });
  assert(current, "full-session-persisted");
  await db.sessions.updateOne(
    { _id: current._id },
    { $set: { lastActivityAt: new Date(Date.now() - 16 * 60_000) } },
  );
  await page.reload();
  await page.getByRole("heading", { name: "Xác thực lại", exact: true }).waitFor();
  await captureScreen("reauth");
  await page.getByLabel("Mật khẩu", { exact: true }).fill(secret);
  await page.getByRole("button", { name: "Tiếp tục", exact: true }).click();
  await page.getByRole("heading", { name: "Hội Thánh", exact: true }).waitFor();
  assert(true, "idle-reauth-browser");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme: "dark" });
  await page.screenshot({
    path: `${evidence}/regression/ui-std-owner-owner-mobile-dark.png`,
    fullPage: false,
  });
  await page.getByRole("button", { name: "Mở điều hướng", exact: true }).click();
  assert(await page.locator(".side").isVisible(), "mobile-sidebar-opens");
  await page.keyboard.press("Escape");
  await page.waitForFunction(
    () => document.activeElement?.getAttribute("aria-label") === "Mở điều hướng",
  );
  assert(
    await page
      .getByRole("button", { name: "Mở điều hướng", exact: true })
      .evaluate((el) => el === document.activeElement),
    "mobile-Escape-restores-focus",
  );
  await page.getByRole("button", { name: "Mở điều hướng", exact: true }).click();
  await page
    .getByRole("button", { name: "Đóng điều hướng", exact: true })
    .click({ position: { x: 375, y: 300 } });
  await page.getByRole("button", { name: "Đăng xuất", exact: true }).click();
  await page.getByRole("heading", { name: "Đăng nhập", exact: true }).waitFor();
  assert(true, "browser-logout");
  await page.screenshot({
    path: `${evidence}/regression/ui-std-owner-login-mobile-dark.png`,
    fullPage: false,
  });
  await page.emulateMedia({ colorScheme: "light" });
  await page.screenshot({
    path: `${evidence}/regression/ui-std-owner-login-mobile-light.png`,
    fullPage: false,
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.emulateMedia({ colorScheme: "dark" });
  await page.screenshot({
    path: `${evidence}/regression/ui-std-owner-login-desktop-dark.png`,
    fullPage: false,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .getByRole("button", { name: "Quên mật khẩu hoặc mất tài khoản?", exact: true })
    .click();
  await page.getByRole("heading", { name: "Hỗ trợ tài khoản", exact: true }).waitFor();
  await captureScreen("support");
  assert(
    await page.getByText("Dịch vu chăm sóc và hỗ trợ", { exact: true }).isVisible(),
    "support-no-invented-contact",
  );
  assert(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    "mobile-no-horizontal-overflow",
  );
  await page.screenshot({
    path: `${evidence}/regression/ui-std-owner-support-mobile-dark.png`,
    fullPage: false,
  });
  assert(errors.length === 0, "no-browser-script-errors");
  await Bun.write(
    `${evidence}/regression/ui-std-owner-browser-results.json`,
    JSON.stringify(
      {
        status: "PASS",
        engine: "Playwright Firefox",
        bundleIndexSha256: new Bun.CryptoHasher("sha256")
          .update(await Bun.file("dist/index.html").arrayBuffer())
          .digest("hex"),
        tls: "certificate trusted only in temporary Firefox profile; verification enabled",
        limits: ["Responsive viewport, not physical mobile/Safari", "No production or human UAT"],
        checks: result,
      },
      null,
      2,
    ),
  );
  console.info(JSON.stringify({ status: "PASS", checks: result.length }));
} catch (error) {
  await Bun.write(
    `${evidence}/regression/ui-std-owner-failure.json`,
    JSON.stringify(
      { message: String(error), errors, body: await page.locator("body").innerText() },
      null,
      2,
    ),
  );
  await page.screenshot({ path: `${evidence}/regression/ui-std-owner-failure.png` });
  throw error;
} finally {
  await context.close();
  if (server) await server.stop(true);
  if (db.db.databaseName === conf.database) await db.db.dropDatabase();
  await db.client.close();
  if (rate.client.isOpen) rate.client.destroy();
}
