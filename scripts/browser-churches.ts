import { readFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { request as httpsRequest } from "node:https";
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
  database: `church_cms_test_browser_p12_${crypto.randomUUID().replaceAll("-", "")}`,
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
async function captureScreen(name: string) {
  for (const theme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: theme });
    for (const width of [1440, 1024, 901, 900, 768, 561, 560, 390]) {
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
        await page.screenshot({ path: `${evidence}/p12-${name}-${width}-${theme}.png` });
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
  await page.getByLabel("Email", { exact: true }).fill(fixture.email);
  await page.getByLabel("Mật khẩu", { exact: true }).fill(fixture.temporaryPassword);
  await page.getByRole("button", { name: "Đăng nhập", exact: true }).click();
  await page.getByRole("heading", { name: "Đổi mật khẩu", exact: true }).waitFor();
  await page.getByLabel("Mật khẩu mới", { exact: true }).fill(secret);
  await page.getByLabel("Nhập lại mật khẩu", { exact: true }).fill(secret);
  await page.getByRole("button", { name: "Lưu mật khẩu", exact: true }).click();
  await page.getByRole("heading", { name: "Đăng nhập", exact: true }).waitFor();
  await page.getByLabel("Mật khẩu", { exact: true }).fill(secret);
  await page.getByRole("button", { name: "Đăng nhập", exact: true }).click();
  await page.getByText("Chưa có dữ liệu Hội Thánh để hiển thị.", { exact: true }).waitFor();
  assert(
    !(await page.getByRole("button", { name: "Mở điều hướng", exact: true }).isVisible()),
    "desktop-keeps-sidebar-without-mobile-menu",
  );
  assert(
    await page.getByRole("button", { name: "Thêm Hội Thánh", exact: true }).isVisible(),
    "O01-empty-create-available",
  );
  await page.getByRole("button", { name: "Thêm Hội Thánh", exact: true }).click();
  await page.getByLabel("Tên Hội Thánh", { exact: true }).fill("Hội Thánh Bình An — thử nghiệm");
  await page.getByLabel("Tỉnh/Thành", { exact: true }).fill("Đà Nẵng");
  await page.getByLabel("Địa hạt", { exact: true }).fill("Miền Trung");
  await page.getByLabel("Địa chỉ", { exact: true }).fill("12 Đường thử nghiệm");
  await page.getByLabel("Người liên hệ", { exact: true }).fill("Liên hệ synthetic");
  await page.getByLabel("Điện thoại", { exact: true }).fill("0900123456");
  await page.getByLabel("Email liên hệ", { exact: true }).fill("contact@example.test");
  await page.screenshot({
    path: `${evidence}/p12-create-desktop.png`,
    fullPage: false,
  });
  await page.getByRole("button", { name: "Lưu", exact: true }).click();
  await page.locator("dialog").waitFor({ state: "hidden" });
  await page.getByRole("button", { name: "Sửa Hội Thánh", exact: true }).waitFor();
  const id = page.url().split("/").at(-1) as string;
  assert(/^[a-f0-9]{24}$/.test(id), "UI-create-opens-O02-with-resource-route");
  assert(
    await page.getByText("0900123456", { exact: true }).isVisible(),
    "phone-leading-zero-preserved",
  );
  assert(
    await page
      .locator(".ui-stats .big")
      .allTextContents()
      .then((x) => x.join(",") === "—,—,—,—,0"),
    "P2-unavailable-dashes-account-real-zero",
  );
  assert(
    await page.getByRole("button", { name: "Vào quản lý Hội Thánh", exact: true }).isEnabled(),
    "owner-context-entry-enabled-without-fake-P2",
  );
  await page.screenshot({
    path: `${evidence}/p12-o02-desktop.png`,
    fullPage: false,
  });
  await captureScreen("o02");
  await page.reload();
  await page.getByRole("button", { name: "Sửa Hội Thánh", exact: true }).waitFor();
  assert(page.url().endsWith(id), "O02-reload-keeps-explicit-tenant-route");
  await page.getByRole("button", { name: "Sửa Hội Thánh", exact: true }).click();
  await page.getByLabel("Địa chỉ", { exact: true }).fill("");
  await page.getByRole("button", { name: "Lưu", exact: true }).click();
  await page.locator("dialog").waitFor({ state: "hidden" });
  await page.getByRole("button", { name: "Sửa Hội Thánh", exact: true }).waitFor();
  const persisted = await db.db.collection("churches").findOne({ _id: new ObjectId(id) });
  assert(
    persisted?.address === undefined && persisted?.contact?.phone === "0900123456",
    "UI-edit-null-clear-and-preserve-phone",
  );
  const other = await context.newPage();
  await other.goto(`${conf.origin}/owner/churches/${id}`);
  await other.getByRole("button", { name: "Sửa Hội Thánh", exact: true }).waitFor();
  await page.getByRole("button", { name: "Sửa Hội Thánh", exact: true }).click();
  await page.getByLabel("Địa chỉ", { exact: true }).fill("Bản sửa tab một");
  await other.getByRole("button", { name: "Sửa Hội Thánh", exact: true }).click();
  await other.getByLabel("Địa chỉ", { exact: true }).fill("Bản sửa tab hai");
  await other.getByRole("button", { name: "Lưu", exact: true }).click();
  await other.locator("dialog").waitFor({ state: "hidden" });
  await other.getByRole("button", { name: "Sửa Hội Thánh", exact: true }).waitFor();
  await page.getByRole("button", { name: "Lưu", exact: true }).click();
  await page
    .getByText("Dữ liệu đã thay đổi. Tải lại và kiểm tra trước khi lưu.", { exact: true })
    .waitFor();
  assert(
    (await db.db.collection("churches").findOne({ _id: new ObjectId(id) }))?.address ===
      "Bản sửa tab hai",
    "two-tab-stale-edit-does-not-overwrite",
  );
  await page.getByRole("button", { name: "Tải lại dữ liệu", exact: true }).click();
  await page.waitForFunction(() =>
    Array.from(document.querySelectorAll<HTMLInputElement>("dialog input")).some(
      (input) => input.value === "Bản sửa tab hai",
    ),
  );
  await page.getByLabel("Địa chỉ", { exact: true }).fill("Bản sửa đã đối chiếu");
  await page.getByRole("button", { name: "Lưu", exact: true }).click();
  await page.locator("dialog").waitFor({ state: "hidden" });
  await page.getByRole("button", { name: "Sửa Hội Thánh", exact: true }).waitFor();
  assert(
    await page.getByText("Bản sửa đã đối chiếu", { exact: true }).isVisible(),
    "explicit-reload-review-save-after-conflict",
  );
  await other.close();
  await page.getByRole("button", { name: "Tạm ngưng Hội Thánh", exact: true }).click();
  await page.getByLabel("Lý do", { exact: true }).fill("Bảo trì synthetic");
  await page.getByRole("button", { name: "Tạm ngưng", exact: true }).click();
  await page.getByRole("button", { name: "Mở lại Hội Thánh", exact: true }).waitFor();
  assert(
    (await db.db.collection("churches").findOne({ _id: new ObjectId(id) }))?.status === "suspended",
    "UI-suspend-real-status",
  );
  await page.getByRole("button", { name: "Mở lại Hội Thánh", exact: true }).click();
  await page.getByLabel("Lý do", { exact: true }).fill("Đã hoàn tất bảo trì");
  await page.getByRole("button", { name: "Mở lại", exact: true }).click();
  await page.getByRole("button", { name: "Tạm ngưng Hội Thánh", exact: true }).waitFor();
  assert(true, "UI-resume-admin-can-read-suspended");
  await page.getByRole("main").getByRole("button", { name: "Hội Thánh", exact: true }).click();
  await page.getByRole("button", { name: "Thêm Hội Thánh", exact: true }).click();
  await page.getByLabel("Tên Hội Thánh", { exact: true }).fill("Hội Thánh Bình An");
  await page.getByLabel("Tỉnh/Thành", { exact: true }).fill("Đà Nẵng");
  await page.getByRole("note").waitFor();
  assert(
    await page
      .getByRole("note")
      .getByText(/tương tự/)
      .isVisible(),
    "UI-similar-name-warning-not-hard-unique",
  );
  await page.getByRole("button", { name: "Hủy", exact: true }).click();
  async function lostResponse(knownOperation: boolean) {
    const name = knownOperation ? "Đối soát F22 synthetic" : "Mất phản hồi synthetic";
    await page.getByRole("button", { name: "Thêm Hội Thánh", exact: true }).click();
    await page.getByLabel("Tên Hội Thánh", { exact: true }).fill(name);
    await page.getByLabel("Tỉnh/Thành", { exact: true }).fill("Đà Nẵng");
    let originalKey = "";
    await page.route(
      "**/api/v1/owner/churches",
      async (route) => {
        const req = route.request();
        originalKey = req.headers()["idempotency-key"] ?? "";
        const headers = await req.allHeaders();
        delete headers.host;
        const real = await new Promise<{
          status: number;
          payload: { data: { operationId: string } };
        }>((resolve, reject) => {
          const forwarded = httpsRequest(
            req.url(),
            {
              method: req.method(),
              headers,
              ca: readFileSync(tls.ca),
              servername: "localhost",
              family: 4,
            },
            (response) => {
              let body = "";
              response.on("data", (chunk) => {
                body += chunk;
              });
              response.on("end", () => {
                try {
                  resolve({ status: response.statusCode ?? 0, payload: JSON.parse(body) });
                } catch (error) {
                  reject(error);
                }
              });
            },
          );
          forwarded.on("error", reject);
          forwarded.end(req.postData());
        });
        const payload = real.payload;
        assert(real.status === 201, "fault-boundary-real-create-committed");
        if (knownOperation)
          await route.fulfill({
            status: 503,
            contentType: "application/json",
            body: JSON.stringify({
              error: {
                code: "OUTCOME_UNKNOWN",
                message: "Chưa xác định kết quả. Kiểm tra trước khi thử lại.",
              },
              meta: { requestId: "synthetic-fault", operationId: payload.data.operationId },
            }),
          });
        else await route.abort("failed");
      },
      { times: 1 },
    );
    await page.getByRole("button", { name: "Lưu", exact: true }).click();
    await page.getByRole("button", { name: "Kiểm tra kết quả", exact: true }).waitFor();
    assert(
      await page.getByLabel("Tên Hội Thánh", { exact: true }).isDisabled(),
      "unknown-response-freezes-original-intent",
    );
    const resolved = page.waitForResponse((r) =>
      knownOperation
        ? r.url().includes("/owner/operations/")
        : r.url().endsWith("/owner/churches") && r.request().method() === "POST",
    );
    await page.getByRole("button", { name: "Kiểm tra kết quả", exact: true }).click();
    const response = await resolved;
    if (!knownOperation) {
      assert(
        response.request().headers()["idempotency-key"] === originalKey,
        "explicit-retry-reuses-same-key",
      );
      assert((await response.json()).meta.replayed === true, "explicit-retry-gets-safe-replay");
    }
    await page.getByRole("button", { name: "Sửa Hội Thánh", exact: true }).waitFor();
    assert(
      (await db.db.collection("churches").countDocuments({ name })) === 1,
      knownOperation ? "UI-F22-reconciles-real-commit" : "UI-lost-response-no-duplicate-church",
    );
    await page.getByRole("main").getByRole("button", { name: "Hội Thánh", exact: true }).click();
  }
  await lostResponse(false);
  await lostResponse(true);
  // Seed through real HTTP contracts for pagination, with browser cookies/CSRF, no synthetic UI rows.
  const seeded = await page.evaluate(async () => {
    const token = (await (await fetch("/api/v1/auth/csrf?realm=owner")).json()).data.csrfToken;
    const ids: string[] = [];
    for (let i = 0; i < 27; i++) {
      const response = await fetch("/api/v1/owner/churches", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-csrf-token": token,
          "idempotency-key": crypto.randomUUID(),
        },
        body: JSON.stringify({
          name: `Phân trang synthetic ${String(i).padStart(2, "0")}`,
          province: "Đà Nẵng",
        }),
      });
      if (!response.ok) throw new Error("Pagination fixture HTTP create failed");
      ids.push((await response.json()).data.church.id);
    }
    return ids;
  });
  assert(seeded.length === 27, "pagination-fixtures-created-through-real-API");
  await page
    .getByRole("textbox", { name: "Tìm Hội Thánh", exact: true })
    .fill("Phân trang synthetic");
  await page.getByRole("button", { name: "Xem thêm", exact: true }).waitFor();
  assert((await page.locator("tbody tr").count()) === 25, "O01-first-page25");
  await page.getByRole("button", { name: "Xem thêm", exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll("tbody tr").length === 27);
  assert(
    new Set(await page.locator(".church-name").allTextContents()).size === 27,
    "O01-load-more-stable-no-duplicate",
  );
  await page.screenshot({
    path: `${evidence}/p12-o01-desktop.png`,
    fullPage: false,
  });
  await captureScreen("o01");
  await page.getByLabel("Trạng thái", { exact: true }).selectOption("suspended");
  await page.getByText("Không tìm thấy Hội Thánh phù hợp.", { exact: true }).waitFor();
  assert(
    (await page.locator("tbody tr").count()) === 0,
    "O01-status-filter-suspended-excludes-active-records",
  );
  await page.getByLabel("Trạng thái", { exact: true }).selectOption("active");
  await page.getByRole("button", { name: "Xem thêm", exact: true }).waitFor();
  assert(
    (await page.locator("tbody tr").count()) === 25,
    "O01-status-filter-active-restores-first-page",
  );
  await page.getByLabel("Trạng thái", { exact: true }).selectOption("");
  await page.getByRole("button", { name: "Xem thêm", exact: true }).waitFor();
  await page
    .getByRole("textbox", { name: "Tìm Hội Thánh", exact: true })
    .fill("Không có kết quả synthetic xyz");
  await page.getByText("Không tìm thấy Hội Thánh phù hợp.", { exact: true }).waitFor();
  assert(true, "O01-no-results-distinct-from-empty");
  await page
    .getByRole("textbox", { name: "Tìm Hội Thánh", exact: true })
    .fill("Phân trang synthetic");
  await page.getByRole("button", { name: "Xem thêm", exact: true }).waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  assert(
    await page.getByRole("button", { name: "Mở điều hướng", exact: true }).isVisible(),
    "mobile-navigation-menu-available",
  );
  await page.emulateMedia({ colorScheme: "dark" });
  await page.screenshot({ path: `${evidence}/p12-o01-mobile-dark.png`, fullPage: false });
  await Bun.write(
    `${evidence}/p12-layout-diagnostics.json`,
    JSON.stringify(
      await page.evaluate(() => ({
        viewport: innerWidth,
        root: document.documentElement.scrollWidth,
        boxes: Array.from(document.querySelectorAll<HTMLElement>("body *"))
          .map((el) => ({
            tag: el.tagName,
            cls: el.className,
            right: Math.round(el.getBoundingClientRect().right),
            width: Math.round(el.getBoundingClientRect().width),
            display: getComputedStyle(el).display,
            overflow: getComputedStyle(el).overflowX,
          }))
          .filter((x) => x.width > 0 && x.right > innerWidth),
      })),
      null,
      2,
    ),
  );
  assert(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    "O01-mobile-page-no-overflow-table-scrolls",
  );
  await page.locator(".church-name").first().click();
  await page.getByRole("button", { name: "Sửa Hội Thánh", exact: true }).waitFor();
  await page.screenshot({ path: `${evidence}/p12-o02-mobile-dark.png`, fullPage: false });
  await page.getByRole("button", { name: "Sửa Hội Thánh", exact: true }).click();
  assert(
    await page.evaluate(() => {
      const r = document.querySelector("dialog")?.getBoundingClientRect();
      return r && r.left >= 0 && r.right <= innerWidth;
    }),
    "mobile-dialog-fits-viewport",
  );
  await page.screenshot({ path: `${evidence}/p12-edit-mobile-dark.png`, fullPage: false });
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => !document.querySelector("dialog")?.open);
  assert(
    await page
      .getByRole("button", { name: "Sửa Hội Thánh", exact: true })
      .evaluate((e) => e === document.activeElement),
    "dialog-Escape-restores-trigger-focus",
  );
  assert(errors.length === 0, "no-browser-script-errors");
  await Bun.write(
    `${evidence}/p12-browser-results.json`,
    JSON.stringify(
      {
        status: "PASS",
        engine: "Playwright Firefox",
        bundleIndexSha256: new Bun.CryptoHasher("sha256")
          .update(await Bun.file("dist/index.html").arrayBuffer())
          .digest("hex"),
        tls: "Verification enabled; CA only in disposable Firefox profile",
        limits: [
          "Synthetic database only",
          "Viewport emulation, not physical mobile/Safari",
          "Fault responses injected at transport boundary after real database commits",
          "No human UAT or production proof",
        ],
        checks: result,
      },
      null,
      2,
    ),
  );
  console.info(JSON.stringify({ status: "PASS", checks: result.length }));
} catch (error) {
  await Bun.write(
    `${evidence}/p12-failure.json`,
    JSON.stringify(
      { message: String(error), errors, body: await page.locator("body").innerText() },
      null,
      2,
    ),
  );
  await page.screenshot({ path: `${evidence}/p12-failure.png` });
  throw error;
} finally {
  await context.close();
  if (server) await server.stop(true);
  if (db.db.databaseName === conf.database) await db.db.dropDatabase();
  await db.client.close();
  if (rate.client.isOpen) rate.client.destroy();
}
