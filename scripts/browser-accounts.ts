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
  database: `church_cms_test_browser_p13_${crypto.randomUUID().replaceAll("-", "")}`,
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
const secrets: string[] = [];
async function api(path: string, body?: object, version?: number) {
  return page.evaluate(
    async ({ path, body, version }) => {
      const token = (await (await fetch("/api/v1/auth/csrf?realm=owner")).json()).data.csrfToken;
      const res = await fetch(`/api/v1/${path}`, {
        method: body
          ? path.endsWith("/permissions") || path.endsWith("/status")
            ? "PATCH"
            : "POST"
          : "GET",
        headers: body
          ? {
              "content-type": "application/json",
              "x-csrf-token": token,
              "idempotency-key": crypto.randomUUID(),
              ...(version ? { "if-match": `"${version}"` } : {}),
            }
          : {},
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      return { status: res.status, payload: res.status === 204 ? null : await res.json() };
    },
    { path, body, version },
  );
}
async function capture(name: string, subject = page) {
  for (const theme of ["light", "dark"] as const) {
    await subject.emulateMedia({ colorScheme: theme });
    for (const width of [1440, 901, 900, 560, 390]) {
      await subject.setViewportSize({ width, height: width === 1440 ? 1000 : 844 });
      await subject.evaluate(async () => {
        await document.fonts.ready;
        window.scrollTo(0, 0);
      });
      const layout = await subject.evaluate(() => {
        const visible = (el: HTMLElement) =>
          el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden";
        const controls = Array.from(
          document.querySelectorAll<HTMLElement>(
            "main button,dialog button,.auth button,input,select",
          ),
        ).filter(visible);
        return {
          page: document.documentElement.scrollWidth <= innerWidth,
          contained: controls.every((el) => {
            const r = el.getBoundingClientRect();
            const frame = el.closest(".tbl-wrap");
            return !!frame || (r.left >= 0 && r.right <= innerWidth + 1);
          }),
          mobile:
            innerWidth > 560 || controls.every((el) => el.getBoundingClientRect().height >= 44),
          names: controls
            .filter((el) => el.tagName === "BUTTON")
            .every((el) => !!(el.textContent?.trim() || el.getAttribute("aria-label"))),
          labels: Array.from(document.querySelectorAll<HTMLElement>(".nav-label"))
            .filter(visible)
            .every((el) => el.scrollWidth <= el.clientWidth + 1),
        };
      });
      assert(
        layout.page && layout.contained && layout.mobile && layout.names && layout.labels,
        `${name}-${theme}-${width}-text-controls-bounds`,
      );
      if ([1440, 390].includes(width))
        await subject.screenshot({
          path: `${evidence}/${name}-${width}-${theme}.png`,
          style: "input[readonly] { visibility: hidden !important; }",
        });
    }
  }
  await subject.setViewportSize({ width: 1440, height: 1000 });
  await subject.emulateMedia({ colorScheme: "light" });
}
async function manage(name: string) {
  await page.getByRole("button", { name: `Quản lý ${name}`, exact: true }).click();
  await page.getByRole("button", { name: "Sửa quyền", exact: true }).waitFor();
}
async function createForm(email: string, name: string) {
  await page.getByRole("button", { name: "Thêm tài khoản", exact: true }).click();
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Họ tên", { exact: true }).fill(name);
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
  const ownerPassword = `Mật khẩu owner 🌿 ${crypto.randomUUID()}`;
  secrets.push(ownerPassword, fixture.temporaryPassword);
  await page.goto(`${conf.origin}/owner/login`);
  await page.getByLabel("Email", { exact: true }).fill(fixture.email);
  await page.getByLabel("Mật khẩu", { exact: true }).fill(fixture.temporaryPassword);
  await page.getByRole("button", { name: "Đăng nhập", exact: true }).click();
  await page.getByLabel("Mật khẩu mới", { exact: true }).fill(ownerPassword);
  await page.getByLabel("Nhập lại mật khẩu", { exact: true }).fill(ownerPassword);
  await page.getByRole("button", { name: "Lưu mật khẩu", exact: true }).click();
  await page.getByRole("heading", { name: "Đăng nhập", exact: true }).waitFor();
  await page.getByLabel("Mật khẩu", { exact: true }).fill(ownerPassword);
  await page.getByRole("button", { name: "Đăng nhập", exact: true }).click();
  await page.getByRole("button", { name: "Thêm Hội Thánh", exact: true }).waitFor();
  const churchResult = await api("owner/churches", {
    name: "Hội Thánh Bình An — thử nghiệm",
    province: "Đà Nẵng",
  });
  assert(churchResult.status === 201, "real-owner-create-church");
  const church = churchResult.payload.data.church;
  const prefix = `owner/churches/${church.id}/accounts`;
  await page.goto(`${conf.origin}/owner/churches/${church.id}`);
  await page.getByRole("main").getByRole("button", { name: "Tài khoản", exact: true }).click();
  await page.getByText("Chưa có tài khoản trong Hội Thánh này.", { exact: true }).waitFor();
  assert(page.url().endsWith("/accounts"), "O02-to-O03-explicit-church-route");
  await capture("o03-empty");
  const email = "an.nguyen@example.test",
    name = "Nguyễn Văn An";
  await createForm(email, name);
  assert(
    await page
      .getByLabel("Vai trò", { exact: true })
      .locator('option[value="ministry_lead"]')
      .evaluate((el) => (el as HTMLOptionElement).disabled),
    "no-fake-P2-unit-role",
  );
  await capture("account-create");
  await page.getByRole("button", { name: "Lưu tài khoản", exact: true }).click();
  const temp = await page.getByLabel("Mật khẩu tạm", { exact: true }).inputValue();
  secrets.push(temp);
  assert(temp.length === 20, "first-response-temporary-secret-visible");
  await capture("credential-masked");
  await page.getByRole("button", { name: "Đóng", exact: true }).last().click();
  assert(
    (await page.getByLabel("Mật khẩu tạm", { exact: true }).count()) === 0,
    "close-destroys-secret-input",
  );
  const accountRecord = await db.db.collection("accounts").findOne({
    churchId: new ObjectId(church.id),
    emailKey: email,
  });
  assert(!!accountRecord, "account-real-database");
  const accountId = accountRecord._id.toHexString();
  await capture("o03");
  await page.setViewportSize({ width: 390, height: 844 });
  const rowAction = page.getByRole("button", { name: `Quản lý ${name}`, exact: true });
  await rowAction.focus();
  assert(
    await rowAction.evaluate((el) => {
      const a = el.getBoundingClientRect(),
        b = el.closest(".tbl-wrap")?.getBoundingClientRect();
      return !!b && a.left >= b.left && a.right <= b.right + 1;
    }),
    "mobile-table-action-reachable-by-focus-and-local-scroll",
  );
  await page.setViewportSize({ width: 1440, height: 1000 });
  // User and owner coexist in the same Firefox cookie jar, but use separate realm contracts.
  const user = await context.newPage();
  user.setDefaultTimeout(15000);
  user.on("pageerror", (e) => errors.push(e.message));
  await user.goto(`${conf.origin}/h/${church.code}/login`);
  await user.getByRole("heading", { name: "Đăng nhập", exact: true }).waitFor();
  await capture("user-login", user);
  await user.getByLabel("Email", { exact: true }).fill(email);
  await user.getByLabel("Mật khẩu", { exact: true }).fill(temp);
  await user.getByRole("button", { name: "Đăng nhập", exact: true }).click();
  await user.getByRole("heading", { name: "Đổi mật khẩu", exact: true }).waitFor();
  assert(user.url().endsWith("/change-password"), "user-temp-forces-A04");
  await capture("user-change", user);
  const password = ` ${crypto.randomUUID()}${"ế".repeat(90)} `;
  secrets.push(password);
  await user.getByLabel("Mật khẩu mới", { exact: true }).focus();
  await user.keyboard.insertText(password);
  assert([...password].length === 128, "user-password-128-codepoints-with-boundary-whitespace");
  assert(
    (await user.getByLabel("Mật khẩu mới", { exact: true }).inputValue()) === password,
    "native-text-insertion-no-trim-or-truncation",
  );
  await user.getByLabel("Nhập lại mật khẩu", { exact: true }).fill(password);
  await user.route(
    "**/api/v1/auth/change-initial-password",
    async (route) => {
      const req = route.request(),
        headers = await req.allHeaders();
      delete headers.host;
      const status = await new Promise<number>((resolve, reject) => {
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
            response.resume();
            response.on("end", () => resolve(response.statusCode ?? 0));
          },
        );
        forwarded.on("error", reject);
        forwarded.end(req.postData());
      });
      assert(status === 204, "F05-lost-response-after-real-password-change");
      await route.abort("failed");
    },
    { times: 1 },
  );
  await user.getByRole("button", { name: "Lưu mật khẩu", exact: true }).click();
  await user.getByRole("button", { name: "Về đăng nhập", exact: true }).waitFor();
  assert(
    (
      await db.credentials.findOne({
        principalKind: "church_user",
        principalId: new ObjectId(accountId),
      })
    )?.credentialVersion === 2,
    "F05-unknown-outcome-no-automatic-repeat",
  );
  await user.getByRole("button", { name: "Về đăng nhập", exact: true }).click();
  await user.getByRole("heading", { name: "Đăng nhập", exact: true }).waitFor();
  assert(
    (await user.getByLabel("Email", { exact: true }).inputValue()) === email,
    "user-password-change-keeps-email-church",
  );
  await user.getByLabel("Mật khẩu", { exact: true }).fill(password);
  await user.getByRole("button", { name: "Đăng nhập", exact: true }).click();
  await user.getByText("Thư ký Ban Chấp sự", { exact: true }).waitFor();
  assert((await api("owner/auth/me")).status === 200, "user-login-keeps-owner-cookie");
  await manage(name);
  await page.getByRole("button", { name: "Sửa quyền", exact: true }).click();
  await page.getByLabel("Vai trò", { exact: true }).selectOption("member");
  await page.getByRole("button", { name: "Lưu quyền", exact: true }).click();
  await page.getByRole("button", { name: "Sửa quyền", exact: true }).waitFor();
  await page.getByRole("button", { name: "Đóng", exact: true }).last().click();
  await user.reload();
  await user.getByText("Chưa liên kết", { exact: true }).waitFor();
  assert(
    await user.getByText("Của mình", { exact: true }).isVisible(),
    "fresh-user-context-member-self-not-owner",
  );
  for (const theme of ["light", "dark"] as const) {
    await user.emulateMedia({ colorScheme: theme });
    for (const width of [1440, 901, 900, 560, 390]) {
      await user.setViewportSize({ width, height: 844 });
      assert(
        await user.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        `user-context-${theme}-${width}-bounded`,
      );
      if ([1440, 390].includes(width))
        await user.screenshot({ path: `${evidence}/user-context-${width}-${theme}.png` });
    }
  }
  const userSessionBefore = await db.sessions.findOne({
    realm: "church",
    principalId: new ObjectId(accountId),
    kind: "full",
    revokedAt: { $exists: false },
  });
  assert(!!userSessionBefore, "full-user-session-present");
  await db.sessions.updateOne(
    { _id: userSessionBefore._id },
    { $set: { lastActivityAt: new Date(Date.now() - 16 * 60_000) } },
  );
  await user.reload();
  await user.getByRole("heading", { name: "Xác thực lại", exact: true }).waitFor();
  await capture("user-reauth", user);
  await user.getByLabel("Mật khẩu", { exact: true }).fill(password);
  await user.getByRole("button", { name: "Tiếp tục", exact: true }).click();
  await user.getByText("Chưa liên kết", { exact: true }).waitFor();
  const userSessionAfter = await db.sessions.findOne({
    realm: "church",
    principalId: new ObjectId(accountId),
    kind: "full",
    revokedAt: { $exists: false },
  });
  assert(
    userSessionAfter?._id.toHexString() !== userSessionBefore._id.toHexString() &&
      userSessionAfter?.absoluteExpiresAt.getTime() ===
        userSessionBefore.absoluteExpiresAt.getTime(),
    "user-reauth-rotates-keeps-absolute-deadline",
  );
  // CAS conflict: an independent HTTP writer changes the same account after the dialog was opened.
  await manage(name);
  await page.getByRole("button", { name: "Sửa quyền", exact: true }).click();
  const current = await api(`${prefix}/${accountId}`);
  assert(
    (
      await api(
        `${prefix}/${accountId}/permissions`,
        { role: "treasurer", scope: { kind: "church" } },
        current.payload.data.version,
      )
    ).status === 200,
    "concurrent-writer-real-commit",
  );
  await page.getByLabel("Vai trò", { exact: true }).selectOption("pastor");
  await page.getByRole("button", { name: "Lưu quyền", exact: true }).click();
  await page.getByRole("button", { name: "Tải lại tài khoản", exact: true }).waitFor();
  assert(
    (await api(`${prefix}/${accountId}`)).payload.data.role === "treasurer",
    "stale-dialog-does-not-overwrite",
  );
  await page.getByRole("button", { name: "Tải lại tài khoản", exact: true }).click();
  await page.waitForFunction(
    () => document.querySelector<HTMLSelectElement>("dialog select")?.value === "treasurer",
  );
  await page.getByRole("button", { name: "Hủy", exact: true }).click();
  await manage(name);
  await page.getByRole("button", { name: "Khóa tài khoản", exact: true }).click();
  await page.getByLabel("Lý do", { exact: true }).fill("Khóa để kiểm tra thu hồi phiên");
  await capture("account-lock");
  await page.getByRole("button", { name: "Khóa", exact: true }).click();
  await page.getByRole("button", { name: "Sửa quyền", exact: true }).waitFor();
  await page.getByRole("button", { name: "Đóng", exact: true }).last().click();
  await user.reload();
  await user.getByRole("heading", { name: "Đăng nhập", exact: true }).waitFor();
  assert((await api("owner/auth/me")).status === 200, "lock-user-does-not-revoke-owner");
  await manage(name);
  await page.getByRole("button", { name: "Mở tài khoản", exact: true }).click();
  await page.getByLabel("Lý do", { exact: true }).fill("Mở lại sau kiểm tra");
  await page.getByRole("button", { name: "Mở tài khoản", exact: true }).click();
  await page.getByRole("button", { name: "Sửa quyền", exact: true }).waitFor();
  await page.getByRole("button", { name: "Đóng", exact: true }).last().click();
  // Recent owner authentication must return to confirmation and must not auto-reset.
  const before = await db.db.collection("accounts").findOne({ _id: new ObjectId(accountId) });
  await db.sessions.updateMany(
    {
      realm: "owner",
      principalId: new ObjectId(fixture.employeeId),
      revokedAt: { $exists: false },
    },
    { $set: { lastPasswordVerifiedAt: new Date(Date.now() - 6 * 60_000) } },
  );
  await manage(name);
  await page.getByRole("button", { name: "Cấp lại mật khẩu tạm", exact: true }).click();
  await page.getByLabel("Tham chiếu hỗ trợ", { exact: true }).fill("SUPPORT-SYNTHETIC-1");
  await page.getByRole("button", { name: "Cấp lại", exact: true }).click();
  await page.getByRole("heading", { name: "Xác thực lại", exact: true }).waitFor();
  await page.getByLabel("Mật khẩu", { exact: true }).fill(ownerPassword);
  await page.getByRole("button", { name: "Tiếp tục", exact: true }).click();
  await page.getByLabel("Tham chiếu hỗ trợ", { exact: true }).waitFor();
  assert(
    (await db.db.collection("accounts").findOne({ _id: new ObjectId(accountId) }))?.version ===
      before?.version,
    "reauth-never-auto-resets",
  );
  assert(
    (await page.getByLabel("Tham chiếu hỗ trợ", { exact: true }).inputValue()) ===
      "SUPPORT-SYNTHETIC-1",
    "reauth-retains-reference-only",
  );
  await page.getByRole("button", { name: "Cấp lại", exact: true }).click();
  await page.getByLabel("Mật khẩu tạm", { exact: true }).waitFor();
  const reset = await page.getByLabel("Mật khẩu tạm", { exact: true }).inputValue();
  secrets.push(reset);
  assert(reset !== temp, "explicit-confirm-reset-rotates-secret");
  await page.getByRole("button", { name: "Đóng", exact: true }).last().click();
  // Lost first response after an actual Mongo commit: retry uses original key and never recovers secret.
  for (const known of [false, true]) {
    const faultEmail = `lost-${known}@example.test`;
    await createForm(faultEmail, `Mất phản hồi ${known}`);
    let key = "";
    await page.route(
      `**/api/v1/${prefix}`,
      async (route) => {
        const req = route.request(),
          headers = await req.allHeaders();
        key = headers["idempotency-key"] ?? "";
        delete headers.host;
        const real = await new Promise<{ status: number; operationId: string }>(
          (resolve, reject) => {
            const forward = httpsRequest(
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
                  const payload = JSON.parse(body);
                  resolve({
                    status: response.statusCode ?? 0,
                    operationId: payload.data.operationId,
                  });
                });
              },
            );
            forward.on("error", reject);
            forward.end(req.postData());
          },
        );
        assert(real.status === 201, `fault-${known}-after-real-account-commit`);
        if (known)
          await route.fulfill({
            status: 503,
            contentType: "application/json",
            body: JSON.stringify({
              error: { code: "OUTCOME_UNKNOWN", message: "Chưa xác định kết quả." },
              meta: { requestId: "synthetic", operationId: real.operationId },
            }),
          });
        else await route.abort("failed");
      },
      { times: 1 },
    );
    await page.getByRole("button", { name: "Lưu tài khoản", exact: true }).click();
    await page.getByRole("button", { name: "Kiểm tra kết quả", exact: true }).waitFor();
    assert(
      await page.getByLabel("Email", { exact: true }).isDisabled(),
      `fault-${known}-freezes-intent`,
    );
    const wait = page.waitForResponse((r) =>
      known
        ? r.url().includes("/owner/operations/")
        : r.url().endsWith(prefix) && r.request().method() === "POST",
    );
    await page.getByRole("button", { name: "Kiểm tra kết quả", exact: true }).click();
    const response = await wait;
    if (!known)
      assert(response.request().headers()["idempotency-key"] === key, "retry-original-key");
    await page.getByRole("button", { name: "Sửa quyền", exact: true }).waitFor();
    assert(
      (await page.getByLabel("Mật khẩu tạm", { exact: true }).count()) === 0,
      `fault-${known}-no-secret-replay`,
    );
    assert(
      (await db.db.collection("accounts").countDocuments({
        churchId: new ObjectId(church.id),
        emailKey: faultEmail,
      })) === 1,
      `fault-${known}-no-duplicate`,
    );
    await page.getByRole("button", { name: "Đóng", exact: true }).last().click();
  }
  // Duplicate creation opens the existing account instead of resetting it.
  await createForm(email, "Trùng email");
  await page.getByRole("button", { name: "Lưu tài khoản", exact: true }).click();
  await page.getByRole("button", { name: "Mở tài khoản hiện có", exact: true }).click();
  await page.getByRole("button", { name: "Sửa quyền", exact: true }).waitFor();
  assert(
    (await page.getByLabel("Mật khẩu tạm", { exact: true }).count()) === 0,
    "duplicate-ui-never-resets",
  );
  await page.getByRole("button", { name: "Đóng", exact: true }).last().click();
  for (let i = 0; i < 24; i++) {
    const r = await api(prefix, {
      email: `page-${i}@example.test`,
      displayName: `Phân trang ${String(i).padStart(2, "0")}`,
      role: "member",
      scope: { kind: "self" },
    });
    assert(r.status === 201, `seed-http-${i}`);
  }
  await page.reload();
  await page.getByRole("button", { name: "Xem thêm", exact: true }).click();
  await page.getByRole("button", { name: "Quản lý Phân trang 23", exact: true }).waitFor();
  assert(
    (await page.locator("tbody tr").count()) === 27,
    "keyset-loads-27-real-accounts-without-duplicate",
  );
  await page.getByLabel("Lọc vai trò", { exact: true }).selectOption("member");
  await page.waitForFunction(() => document.querySelectorAll("tbody tr").length === 24);
  assert((await page.locator("tbody tr").count()) === 24, "role-filter-at-source");
  await page.getByLabel("Lọc vai trò", { exact: true }).selectOption("");
  await page.getByLabel("Tìm tài khoản", { exact: true }).fill(email);
  await page.waitForFunction(() => document.querySelectorAll("tbody tr").length === 1);
  assert(
    await page.getByRole("button", { name: `Quản lý ${name}`, exact: true }).isVisible(),
    "exact-email-search",
  );
  await capture("o03-search");
  await page.getByRole("button", { name: "← Chi tiết Hội Thánh", exact: true }).click();
  await page.getByRole("button", { name: "Sửa Hội Thánh", exact: true }).waitFor();
  assert(
    (await page.locator(".ui-stats .big").allTextContents()).at(-1) === "27",
    "O02-live-active-account-count",
  );
  await page.getByRole("button", { name: "Vào quản lý Hội Thánh", exact: true }).click();
  await page.getByText("Quản trị nhà cung cấp", { exact: true }).waitFor();
  assert(
    (await page
      .getByText(
        "Cấu hình Hội Thánh đã khả dụng trong menu Cấu hình. Các chức năng nghiệp vụ khác chưa khả dụng.",
        { exact: true },
      )
      .isVisible()) &&
      (await page.getByRole("navigation").getByText("Cấu hình", { exact: true }).isVisible()) &&
      (await page
        .getByRole("navigation")
        .getByRole("button", { name: "Tổng quan", exact: true })
        .count()) === 0,
    "F24-provider-context-config-available-dashboard-unavailable",
  );
  // No user tenant picker: opening a different church URL clears content and requires explicit logout.
  await user.goto(`${conf.origin}/h/${church.code}/login`);
  await user.getByLabel("Email", { exact: true }).fill(email);
  await user.getByLabel("Mật khẩu", { exact: true }).fill(reset);
  await user.getByRole("button", { name: "Đăng nhập", exact: true }).click();
  await user.getByRole("heading", { name: "Đổi mật khẩu", exact: true }).waitFor();
  await user.getByLabel("Mật khẩu mới", { exact: true }).fill(password);
  await user.getByLabel("Nhập lại mật khẩu", { exact: true }).fill(password);
  await user.getByRole("button", { name: "Lưu mật khẩu", exact: true }).click();
  await user.getByRole("heading", { name: "Đăng nhập", exact: true }).waitFor();
  await user.getByLabel("Mật khẩu", { exact: true }).fill(password);
  await user.getByRole("button", { name: "Đăng nhập", exact: true }).click();
  await user.getByText("Thủ quỹ", { exact: true }).waitFor();
  const anotherChurch = await api("owner/churches", { name: "Hội Thánh khác", province: "Huế" });
  const secondOwner = await context.newPage();
  secondOwner.setDefaultTimeout(15000);
  await secondOwner.goto(
    `${conf.origin}/owner/churches/${anotherChurch.payload.data.church.id}/accounts`,
  );
  await secondOwner.getByText("Chưa có tài khoản trong Hội Thánh này.", { exact: true }).waitFor();
  assert(
    (await secondOwner.getByRole("main").getByText(church.name, { exact: true }).count()) === 0,
    "owner-second-tab-B-does-not-show-A-records",
  );
  await page.reload();
  await page.getByRole("main").getByText(church.name, { exact: true }).waitFor();
  assert(
    page.url().includes(church.id) &&
      (await secondOwner.locator("body").innerText()).includes("Hội Thánh khác"),
    "owner-two-tabs-keep-explicit-separate-targets-with-dual-cookies",
  );
  await secondOwner.close();
  const mismatch = await context.newPage();
  mismatch.setDefaultTimeout(15000);
  await mismatch.goto(`${conf.origin}/h/${anotherChurch.payload.data.church.code}/login`);
  await mismatch
    .getByRole("heading", { name: "Phiên đăng nhập đã thay đổi", exact: true })
    .waitFor();
  assert(
    (await mismatch.getByText(email, { exact: true }).count()) === 0,
    "different-user-url-clears-previous-identity",
  );
  assert((await mismatch.locator("select").count()) === 0, "no-user-tenant-selector");
  await mismatch.getByRole("button", { name: "Đăng xuất", exact: true }).click();
  await mismatch.getByRole("heading", { name: "Đăng nhập", exact: true }).waitFor();
  assert((await api("owner/auth/me")).status === 200, "user-logout-keeps-owner-session");
  await mismatch.close();
  // Native dialog keyboard trap and Escape restore the real trigger.
  await page.goto(`${conf.origin}/owner/churches/${church.id}/accounts`);
  await page.getByRole("button", { name: "Thêm tài khoản", exact: true }).click();
  await page.getByLabel("Email", { exact: true }).waitFor();
  await page.waitForFunction(
    () => document.activeElement === document.querySelector('dialog input[type="email"]'),
  );
  assert(true, "create-dialog-focuses-email");
  await page.getByRole("button", { name: "Lưu tài khoản", exact: true }).focus();
  await page.keyboard.press("Tab");
  assert(
    await page
      .getByRole("button", { name: "Đóng", exact: true })
      .evaluate((el) => el === document.activeElement),
    "dialog-Tab-wraps-to-close",
  );
  await page.keyboard.press("Escape");
  await page.locator("dialog").waitFor({ state: "hidden" });
  assert(
    await page
      .getByRole("button", { name: "Thêm tài khoản", exact: true })
      .evaluate((el) => el === document.activeElement),
    "Escape-restores-create-trigger",
  );
  assert(errors.length === 0, "no-browser-script-errors");
  await Bun.write(
    `${evidence}/browser-results.json`,
    JSON.stringify(
      {
        status: "PASS",
        engine: "Firefox Playwright",
        checks: result,
        bundleIndexSha256: new Bun.CryptoHasher("sha256")
          .update(await Bun.file("dist/index.html").arrayBuffer())
          .digest("hex"),
        limits: [
          "Synthetic database, private CA, viewport emulation",
          "No physical device/Safari/human acceptance/production",
          "Fault injected after real commit",
        ],
      },
      null,
      2,
    ),
  );
  console.info(JSON.stringify({ status: "PASS", checks: result.length }));
  await user.close();
} catch (error) {
  const safe = secrets.reduce((s, secret) => s.replaceAll(secret, "[REDACTED]"), String(error));
  await Bun.write(
    `${evidence}/browser-failure.json`,
    JSON.stringify({ error: safe, errors, checks: result }, null, 2),
  );
  await page.screenshot({
    path: `${evidence}/browser-failure.png`,
    style: "input { visibility: hidden !important; }",
  });
  throw new Error(safe);
} finally {
  await context.close();
  if (server) await server.stop(true);
  if (db.db.databaseName === conf.database) await db.db.dropDatabase();
  await db.client.close();
  if (rate.client.isOpen) rate.client.destroy();
}
