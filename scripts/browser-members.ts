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

const evidence = process.env.CHURCH_EVIDENCE_DIR ?? "output/p2.2";
// Only executed in the disposable browser container; CA trust is private to its Firefox profile.
if (process.platform !== "linux" || !process.env.CHURCH_BROWSER_CONTAINER)
  throw new Error("Use the isolated browser container");
const conf: Config = {
  cert: "/tmp/church-cert.pem",
  key: "/tmp/church-key.pem",
  origin: "https://localhost:3449",
  port: 3449,
  mongoUrl: "mongodb://host.docker.internal:27119/?replicaSet=church-local&directConnection=true",
  redisUrl: "redis://host.docker.internal:6391",
  database: `church_cms_test_browser_p22_${crypto.randomUUID().replaceAll("-", "")}`,
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
const spacingEvidence: unknown[] = [];
function assert(condition: unknown, label: string): asserts condition {
  if (!condition) throw new Error(label);
  result.push({ check: label, status: "PASS" });
  console.info(label);
}
const secrets: string[] = [];
async function api(
  path: string,
  body?: object,
  version?: number,
  realm: "owner" | "church" = "owner",
  subject = page,
  method?: string,
) {
  return subject.evaluate(
    async ({ path, body, version, realm, method }) => {
      const token = (await (await fetch(`/api/v1/auth/csrf?realm=${realm}`)).json()).data.csrfToken;
      const r = await fetch(`/api/v1/${path}`, {
        method: method ?? (body ? (version ? "PATCH" : "POST") : "GET"),
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
      return { status: r.status, payload: r.status === 204 ? null : await r.json() };
    },
    { path, body, version, realm, method },
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
        document.querySelectorAll<HTMLElement>("dialog[open]").forEach((d) => {
          d.scrollTop = 0;
        });
      });
      const layout = await subject.evaluate(() => {
        const visible = (e: Element) =>
          e.getClientRects().length > 0 &&
          getComputedStyle(e).visibility !== "hidden" &&
          !e.closest("[inert]");
        const controls = Array.from(
          document.querySelectorAll<HTMLElement>(
            "main button,dialog[open] button,input,select,textarea",
          ),
        ).filter(visible);
        const fields = Array.from(document.querySelectorAll(".ui-field"))
          .filter(visible)
          .flatMap((f) => {
            const label = f.firstElementChild,
              control = f.querySelector(".input,.select");
            return label && control && visible(control)
              ? [control.getBoundingClientRect().top - label.getBoundingClientRect().bottom]
              : [];
          });
        const heights = controls
          .filter((e) => e.matches('input:not([type="radio"]):not([type="checkbox"]),select'))
          .map((e) => e.getBoundingClientRect().height);
        const groups = Array.from(document.querySelectorAll(".member-form-group")).filter(visible);
        const gaps = groups.slice(1).flatMap((g, i) => {
          const before = groups[i] as Element;
          return before.parentElement === g.parentElement
            ? [g.getBoundingClientRect().top - before.getBoundingClientRect().bottom]
            : [];
        });
        const toolbar = document.querySelector(".members-section .toolbar"),
          table = document.querySelector(".members-section .tbl-wrap");
        return {
          page: document.documentElement.scrollWidth <= innerWidth,
          bounds: controls.every(
            (e) =>
              !!e.closest(".tbl-wrap") ||
              (e.getBoundingClientRect().left >= -1 &&
                e.getBoundingClientRect().right <= innerWidth + 1),
          ),
          mobile:
            innerWidth > 560 ||
            controls.every(
              (e) =>
                (e.matches('input[type="radio"],input[type="checkbox"]')
                  ? (e.closest("label") ?? e)
                  : e
                ).getBoundingClientRect().height >= 44,
            ),
          fields,
          heights,
          gaps,
          tableGap:
            toolbar && table
              ? table.getBoundingClientRect().top - toolbar.getBoundingClientRect().bottom
              : null,
          names: controls
            .filter((e) => e.tagName === "BUTTON")
            .every((e) => e.textContent?.trim() || e.getAttribute("aria-label")),
        };
      });
      spacingEvidence.push({ name, theme, width, ...layout });
      assert(
        layout.page && layout.bounds && layout.mobile && layout.names,
        `${name}-${theme}-${width}-bounds-touch-names`,
      );
      assert(
        layout.fields.every((g) => g >= 4.5),
        `${name}-${theme}-${width}-field-gap5`,
      );
      assert(
        layout.heights.every((h) => h >= 32 && h <= 48),
        `${name}-${theme}-${width}-control-height32-48`,
      );
      assert(
        layout.gaps.every((g) => g >= 11.5) &&
          (layout.tableGap === null || layout.tableGap >= 17.5),
        `${name}-${theme}-${width}-group-table-spacing`,
      );
      if ([1440, 390].includes(width))
        await subject.screenshot({
          path: `${evidence}/${name}-${width}-${theme}.png`,
          fullPage: true,
        });
    }
  }
  await subject.setViewportSize({ width: 1440, height: 1000 });
  await subject.emulateMedia({ colorScheme: "light" });
}
async function createViaForm(name: string, type = "believer") {
  await page.getByRole("button", { name: "Thêm thuộc viên", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Thêm thuộc viên", exact: true });
  await dialog.getByLabel("Họ và tên", { exact: true }).fill(name);
  await dialog.getByLabel("Loại thuộc viên", { exact: true }).selectOption(type);
  await dialog.getByLabel("Điện thoại", { exact: true }).fill("0900123456");
  await dialog.getByLabel("Đã xác nhận đồng ý lưu trữ thông tin", { exact: true }).check();
  return dialog;
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
    port: 3449,
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
  const church = (
      await api("owner/churches", { name: "Hội Thánh P2.2 — synthetic", province: "Đà Nẵng" })
    ).payload.data.church,
    base = `owner/churches/${church.id}`,
    members = `${base}/members`;
  await page.goto(`${conf.origin}/owner/churches/${church.id}`);
  await page.getByRole("main").getByRole("button", { name: "Thuộc viên", exact: true }).click();
  await page
    .getByText("Cần owner hoặc Mục sư thiết lập Cấu hình Hội Thánh trước khi thêm hồ sơ.")
    .waitFor();
  assert(
    await page.getByRole("button", { name: "Thêm thuộc viên", exact: true }).isDisabled(),
    "unconfigured-members-no-write",
  );
  await capture("w02-unconfigured");
  assert(
    (
      await api(`${base}/organization/settings`, {
        unitType: "area",
        defaultAssignmentMode: "auto",
      })
    ).status === 201,
    "configured-without-member-seeds",
  );
  const area = (await api(`${base}/organization/units`, { kind: "area", name: "Khu vực An Bình" }))
      .payload.data.unit,
    _service = (
      await api(`${base}/organization/units`, { kind: "service_ministry", name: "Ban Âm nhạc" })
    ).payload.data.unit;
  await page.reload();
  await page.getByRole("button", { name: "Thêm thuộc viên", exact: true }).waitFor();
  await page.getByText("Chưa có hồ sơ thuộc viên trong Hội Thánh này.").waitFor();
  await capture("w02-empty");
  let dialog = await createViaForm("Nguyễn An synthetic");
  await dialog.getByLabel("Khu vực", { exact: true }).selectOption(area.id);
  await capture("w15-create-unknown");
  await dialog.getByRole("button", { name: "Lưu hồ sơ", exact: true }).focus();
  await page.keyboard.press("Tab");
  assert(
    await dialog
      .getByRole("button", { name: "Đóng", exact: true })
      .evaluate((e) => e === document.activeElement),
    "W15-focus-trap",
  );
  await dialog.getByRole("button", { name: "Lưu hồ sơ", exact: true }).click();
  await dialog.waitFor({ state: "hidden" });
  const drawer = page
    .getByRole("dialog")
    .filter({ has: page.getByRole("heading", { name: /Nguyễn An synthetic · TH-/ }) });
  await drawer.waitFor();
  assert(
    await drawer
      .getByText("Tuổi", { exact: true })
      .locator("..")
      .getByText("Chưa rõ", { exact: true })
      .isVisible(),
    "unknown-age-display",
  );
  assert(await drawer.getByText("0900123456", { exact: true }).isVisible(), "phone-leading-zero");
  assert(
    (await drawer.getByText("Chưa khả dụng.", { exact: true }).count()) === 3,
    "attendance-giving-qr-unavailable",
  );
  await drawer.getByRole("button", { name: "Lịch sử hồ sơ", exact: true }).click();
  await drawer.getByText("Tạo hồ sơ", { exact: true }).waitFor();
  await capture("w14-profile-history");
  const original = await db.db
    .collection("members")
    .findOne({ churchId: new ObjectId(church.id), fullName: "Nguyễn An synthetic" });
  assert(!!original, "real-member-family-created");
  const family = await db.db.collection("families").findOne({ _id: original.familyId });
  assert(!!family, "real-family-created-atomically");
  await drawer.getByRole("button", { name: "Đóng", exact: true }).click();
  dialog = await createViaForm("Trần Bình synthetic", "visitor");
  await dialog.getByLabel("Chọn gia đình có sẵn", { exact: true }).check();
  await dialog
    .getByLabel("Gia đình có sẵn", { exact: true })
    .selectOption(original.familyId.toHexString());
  await dialog.getByLabel("Thủ công", { exact: true }).check();
  await dialog.getByLabel("Ban Âm nhạc", { exact: true }).check();
  await dialog.getByLabel("Tìm người chăm sóc", { exact: true }).fill("Nguyễn An");
  await dialog.getByRole("button", { name: "Tra cứu người", exact: true }).click();
  await dialog
    .getByLabel("Người chăm sóc", { exact: true })
    .selectOption(original._id.toHexString());
  await capture("w15-existing-family-visitor-manual");
  await dialog.getByRole("button", { name: "Lưu hồ sơ", exact: true }).click();
  await dialog.waitFor({ state: "hidden" });
  await page.getByRole("heading", { name: /Trần Bình synthetic · TH-/ }).waitFor();
  const selectedDrawer = page.getByRole("dialog", { name: /Trần Bình synthetic · TH-/ });
  assert(
    await selectedDrawer.getByText("Ban Âm nhạc", { exact: true }).isVisible(),
    "manual-unit-label",
  );
  assert(
    (await selectedDrawer.getByText("Nguyễn An synthetic", { exact: true }).count()) >= 1,
    "family-and-caregiver-wired",
  );
  await selectedDrawer.getByRole("button", { name: "Cập nhật giai đoạn", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "Cập nhật giai đoạn", exact: true });
  await dialog.getByLabel("Giai đoạn", { exact: true }).selectOption("exploring");
  await dialog.getByLabel("Lý do", { exact: true }).fill("Đã thăm hỏi synthetic");
  await dialog.getByRole("button", { name: "Xác nhận", exact: true }).click();
  await dialog.waitFor({ state: "hidden" });
  await selectedDrawer.getByText("Đang tìm hiểu", { exact: true }).waitFor();
  await selectedDrawer.getByRole("button", { name: "Chuyển thành tín hữu", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "Chuyển thành tín hữu", exact: true });
  await dialog.getByLabel("Lý do", { exact: true }).fill("Xác nhận tin Chúa synthetic");
  await capture("w14-conversion-confirm");
  await dialog.getByRole("button", { name: "Xác nhận", exact: true }).click();
  await dialog.waitFor({ state: "hidden" });
  await selectedDrawer.getByRole("heading", { name: "Nguồn thân hữu", exact: true }).waitFor();
  assert(
    await selectedDrawer.getByText("Dự bị", { exact: true }).isVisible(),
    "conversion-preparatory",
  );
  const converted = await db.db
    .collection("members")
    .findOne({ churchId: new ObjectId(church.id), fullName: "Trần Bình synthetic" });
  assert(
    converted?.type === "believer" && converted.familyId.equals(original.familyId),
    "conversion-identity-family-preserved",
  );
  for (const status of ["transferred", "active"]) {
    await selectedDrawer.getByRole("button", { name: "Thay đổi sinh hoạt", exact: true }).click();
    dialog = page.getByRole("dialog", { name: "Thay đổi sinh hoạt", exact: true });
    await dialog.getByLabel("Sinh hoạt mới", { exact: true }).selectOption(status);
    await dialog.getByLabel("Lý do", { exact: true }).fill(`Synthetic ${status}`);
    await dialog.getByRole("button", { name: "Xác nhận", exact: true }).click();
    await dialog.waitFor({ state: "hidden" });
    await selectedDrawer
      .getByText(status === "active" ? "Đang sinh hoạt" : "Chuyển đi", { exact: true })
      .waitFor();
  }
  assert(true, "participation-transfer-and-explicit-restore");
  await selectedDrawer.getByRole("button", { name: "Sửa hồ sơ", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "Sửa hồ sơ", exact: true });
  await dialog.getByLabel("Ngày sinh", { exact: true }).fill("2000-02-29");
  await dialog.getByLabel("Báp-têm", { exact: true }).selectOption("baptized");
  await dialog.getByLabel("Nơi Báp-têm", { exact: true }).fill("Hội Thánh synthetic");
  await capture("w15-edit");
  await dialog.getByRole("button", { name: "Lưu hồ sơ", exact: true }).click();
  await dialog.waitFor({ state: "hidden" });
  await selectedDrawer.getByText("Hội Thánh synthetic", { exact: true }).waitFor();
  await selectedDrawer.getByRole("button", { name: "Lịch sử hồ sơ", exact: true }).click();
  await selectedDrawer.getByText("Chuyển thành tín hữu", { exact: true }).waitFor();
  await capture("w14-converted-history");
  await selectedDrawer.getByRole("button", { name: "Đóng", exact: true }).click();
  // Pagination is read from a real tenant-specific collection, never a client-side mock.
  const options = (await api(`${members}/options?limit=100`)).payload.data;
  const seed = (fullName: string) => ({
    fullName,
    gender: "unknown",
    birthDate: null,
    phone: null,
    type: "believer",
    membership: "member",
    householdRole: "other",
    baptism: { status: "unknown", date: null, place: null },
    visitor: null,
    family: { kind: "existing", id: original.familyId.toHexString() },
    assignment: { mode: "auto", unitIds: [] },
    assignmentContext: { settingsVersion: options.settings.version, asOfDate: options.asOfDate },
    consent: true,
  });
  for (let i = 0; i < 26; i++)
    assert(
      (await api(members, seed(`Synthetic phân trang ${String(i).padStart(2, "0")}`))).status ===
        201,
      `seed-bounded-${i}`,
    );
  await page.reload();
  await page.getByRole("button", { name: "Xem thêm", exact: true }).waitFor();
  assert((await page.locator(".members-table tbody tr").count()) === 25, "default-page25");
  await page.getByRole("button", { name: "Xem thêm", exact: true }).click();
  await page.waitForFunction(
    () => document.querySelectorAll(".members-table tbody tr").length === 28,
  );
  assert(true, "keyset-next-page28-no-duplicates");
  await capture("w02-list");
  await page.getByLabel("Tìm mã, tên, điện thoại", { exact: true }).fill("0900");
  await page.getByRole("button", { name: "Tìm", exact: true }).click();
  await page.waitForFunction(
    () => document.querySelectorAll(".members-table tbody tr").length === 2,
  );
  assert(true, "phone-prefix-filter-two-profiles");
  await page.getByLabel("Sinh hoạt", { exact: true }).selectOption("deceased");
  await page.getByText("Không có thuộc viên khớp bộ lọc.", { exact: true }).waitFor();
  assert(true, "search-does-not-widen-participation");
  await page.getByRole("button", { name: "Xóa bộ lọc", exact: true }).click();
  // A stale editor must retain the draft, ask for refresh, then save against a fresh version.
  await page.getByRole("button", { name: "Nguyễn An synthetic", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Sửa hồ sơ", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "Sửa hồ sơ", exact: true });
  await dialog.getByLabel("Họ và tên", { exact: true }).fill("Bản nháp tab cũ");
  const current = (await api(`${members}/${original._id}`)).payload.data;
  assert(
    (
      await api(
        `${members}/${original._id}`,
        { fullName: "Nguyễn An mới synthetic" },
        current.version,
      )
    ).status === 200,
    "second-tab-profile-write",
  );
  await dialog.getByRole("button", { name: "Lưu hồ sơ", exact: true }).click();
  await dialog.getByRole("button", { name: "Tải bản mới", exact: true }).waitFor();
  assert(
    (await dialog.getByLabel("Họ và tên", { exact: true }).inputValue()) === "Bản nháp tab cũ",
    "stale-draft-preserved",
  );
  await dialog.getByRole("button", { name: "Tải bản mới", exact: true }).click();
  await page.waitForFunction(
    () =>
      document.querySelector<HTMLInputElement>("dialog[open] input")?.value ===
      "Nguyễn An mới synthetic",
  );
  await dialog.getByRole("button", { name: "Hủy", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Đóng", exact: true }).click();
  // Lose the response after a real commit; reauthenticate and reconcile without creating a second profile.
  dialog = await createViaForm("Mất phản hồi synthetic");
  const intentKeys: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().endsWith(`/api/v1/${members}`))
      intentKeys.push(request.headers()["idempotency-key"] ?? "");
  });
  let forwarded = () => {};
  const forwardDone = new Promise<void>((resolve) => {
    forwarded = resolve;
  });
  await page.route(
    `**/api/v1/${members}`,
    async (route) => {
      if (route.request().method() !== "POST") {
        await route.continue();
        return;
      }
      const req = route.request(),
        headers = await req.allHeaders();
      delete headers.host;
      const status = await new Promise<number>((resolve, reject) => {
        const forward = httpsRequest(
          req.url(),
          {
            method: req.method(),
            headers,
            ca: readFileSync(tls.ca),
            servername: "localhost",
            family: 4,
          },
          (res) => {
            res.resume();
            res.on("end", () => resolve(res.statusCode ?? 0));
          },
        );
        forward.on("error", () => reject(new Error("Private-CA forwarding failed")));
        forward.end(req.postData());
      });
      assert(status === 201, "lost-response-after-real-member-commit");
      await route.abort("failed");
      forwarded();
    },
    { times: 1 },
  );
  await dialog.getByRole("button", { name: "Lưu hồ sơ", exact: true }).click();
  await forwardDone;
  await dialog.getByRole("button", { name: "Kiểm tra kết quả", exact: true }).waitFor();
  assert(
    await dialog.getByRole("button", { name: "Lưu hồ sơ", exact: true }).isDisabled(),
    "pending-disables-new-intent",
  );
  await page.keyboard.press("Escape");
  assert(await dialog.isVisible(), "pending-prevents-Escape");
  assert(
    await page
      .getByRole("navigation")
      .getByRole("button", { name: "Hội Thánh", exact: true })
      .isDisabled(),
    "pending-prevents-navigation",
  );
  await db.sessions.updateMany(
    { realm: "owner", revokedAt: { $exists: false } },
    { $set: { lastActivityAt: new Date(Date.now() - 16 * 60_000) } },
  );
  await dialog.getByRole("button", { name: "Kiểm tra kết quả", exact: true }).click();
  await page.getByRole("heading", { name: "Xác thực lại", exact: true }).waitFor();
  const attemptsBeforeAuth = intentKeys.length;
  assert(attemptsBeforeAuth === 2, "expired-session-retry-recorded");
  await page.getByLabel("Mật khẩu", { exact: true }).fill(ownerPassword);
  await page.getByRole("button", { name: "Tiếp tục", exact: true }).click();
  await page.getByRole("button", { name: "Kiểm tra kết quả", exact: true }).waitFor();
  assert(intentKeys.length === attemptsBeforeAuth, "reauth-does-not-auto-replay");
  await page.getByRole("button", { name: "Kiểm tra kết quả", exact: true }).click();
  await page.getByRole("heading", { name: /Mất phản hồi synthetic · TH-/ }).waitFor();
  assert(
    new Set(intentKeys).size === 1 && Number(intentKeys.length) === 3,
    "pending-reuses-key-on-expired-attempt-and-explicit-replay",
  );
  assert(
    (await db.db.collection("members").countDocuments({
      churchId: new ObjectId(church.id),
      fullName: "Mất phản hồi synthetic",
    })) === 1,
    "lost-response-reauth-exact-intent-one-member",
  );
  await page.getByRole("dialog").getByRole("button", { name: "Đóng", exact: true }).click();
  const userPage = await context.newPage();
  userPage.on("pageerror", (e) => errors.push(e.message));
  for (const role of ["secretary", "pastor", "treasurer"]) {
    const account = (
      await api(`${base}/accounts`, {
        email: `${role}-${crypto.randomUUID()}@example.test`,
        displayName: `Synthetic ${role}`,
        role,
        scope: { kind: "church" },
      })
    ).payload.data;
    const pw = `User 🕊 ${crypto.randomUUID()}`;
    secrets.push(pw, account.temporaryCredential.password);
    await userPage.goto(`${conf.origin}/h/${church.code}/login`);
    await userPage.getByLabel("Email", { exact: true }).fill(account.account.email);
    await userPage
      .getByLabel("Mật khẩu", { exact: true })
      .fill(account.temporaryCredential.password);
    await userPage.getByRole("button", { name: "Đăng nhập", exact: true }).click();
    await userPage.getByLabel("Mật khẩu mới", { exact: true }).fill(pw);
    await userPage.getByLabel("Nhập lại mật khẩu", { exact: true }).fill(pw);
    await userPage.getByRole("button", { name: "Lưu mật khẩu", exact: true }).click();
    await userPage.getByRole("heading", { name: "Đăng nhập", exact: true }).waitFor();
    await userPage.getByLabel("Mật khẩu", { exact: true }).fill(pw);
    await userPage.getByRole("button", { name: "Đăng nhập", exact: true }).click();
    await userPage
      .getByRole("heading", {
        name: role === "treasurer" ? "Thông tin truy cập" : "Tổng quan",
        exact: true,
        level: 1,
      })
      .waitFor();
    if (role !== "treasurer") {
      await userPage
        .getByRole("navigation", { name: "Điều hướng", exact: true })
        .getByRole("button", { name: "Thuộc viên", exact: true })
        .click();
      await userPage.getByRole("button", { name: "Thêm thuộc viên", exact: true }).waitFor();
      assert(true, `${role}-members-menu-and-write`);
      await capture(`w02-${role}`, userPage);
      if (role === "secretary")
        assert(
          (
            await api(
              `churches/${church.id}/organization/units`,
              { kind: "area", name: "Không cho secretary" },
              undefined,
              "church",
              userPage,
            )
          ).status === 403,
          "secretary-members-write-not-org-write",
        );
    } else {
      assert(
        (await userPage.getByRole("button", { name: "Thuộc viên", exact: true }).count()) === 0,
        "treasurer-no-member-menu",
      );
      await userPage.goto(`${conf.origin}/h/${church.code}/members`);
      await userPage
        .getByRole("alert")
        .filter({ hasText: "Bạn không có quyền xem hồ sơ Hội Thánh." })
        .waitFor();
      assert(
        (await api(`churches/${church.id}/members`, undefined, undefined, "church", userPage))
          .status === 403,
        "treasurer-deep-link-backend-denied",
      );
      await capture("w02-denied", userPage);
    }
    await userPage.getByRole("button", { name: "Đăng xuất", exact: true }).click();
    await userPage.getByRole("heading", { name: "Đăng nhập", exact: true }).waitFor();
  }
  await userPage.close();
  assert((await api("owner/auth/me")).status === 200, "separate-realms-preserve-owner");
  assert(errors.length === 0, "no-browser-script-errors");
  await Bun.write(
    `${evidence}/browser-results.json`,
    JSON.stringify(
      {
        status: "PASS",
        engine: "Firefox Playwright",
        checks: result,
        spacing: spacingEvidence,
        bundleIndexSha256: new Bun.CryptoHasher("sha256")
          .update(await Bun.file("dist/index.html").arrayBuffer())
          .digest("hex"),
        limits: [
          "Local synthetic + private CA",
          "Viewport emulation; no physical devices/Safari/production",
          "Response loss injected after actual HTTP commit",
        ],
      },
      null,
      2,
    ),
  );
  console.info(JSON.stringify({ status: "PASS", checks: result.length }));
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
