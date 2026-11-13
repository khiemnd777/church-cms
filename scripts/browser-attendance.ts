import { mkdir, readdir, readFile } from "node:fs/promises";
import { request as httpsRequest } from "node:https";
import { firefox } from "@playwright/test";
import { ObjectId } from "mongodb";
import { createApp } from "../api/app";
import type { Config } from "../api/config";
import { OwnerOperations } from "../api/identity/owner-operations";
import { Identity } from "../api/identity/service";
import { Database, initialize } from "../api/infrastructure/database";
import { RateLimit } from "../api/infrastructure/rate-limit";
import { businessDay } from "../api/members/dates";
import { localTls } from "./local-tls";
import { seedP2 } from "./p2-fixtures";

const evidence = process.env.CHURCH_EVIDENCE_DIR ?? "output/p3.1";
// Only executed in the disposable browser container; CA trust is private to its Firefox profile.
if (process.platform !== "linux" || !process.env.CHURCH_BROWSER_CONTAINER)
  throw new Error("Use the isolated browser container");
const conf: Config = {
  cert: "/tmp/church-cert.pem",
  key: "/tmp/church-key.pem",
  origin: "https://localhost:3463",
  port: 3463,
  mongoUrl: "mongodb://host.docker.internal:27119/?replicaSet=church-local&directConnection=true",
  redisUrl: "redis://host.docker.internal:6391",
  database: `church_cms_test_browser_p31_${crypto.randomUUID().replaceAll("-", "")}`,
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
          !e.closest("[inert]") &&
          (!e.closest("details:not([open])") || !!e.closest("summary"));
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
        const actions = document.querySelector(".attendance-card-actions"),
          progress = document.querySelector(".ui-attendance-track");
        const rows = Array.from(
          document.querySelectorAll<HTMLElement>(".attendance-person"),
        ).filter(visible);
        return {
          attendanceRowWidths: rows.every(
            (row) =>
              Math.abs(
                row.getBoundingClientRect().width -
                  (row.querySelector(".att-item")?.getBoundingClientRect().width ?? 0),
              ) < 1,
          ),
          attendanceActionsGap:
            actions && progress && visible(actions)
              ? actions.getBoundingClientRect().top +
                parseFloat(getComputedStyle(actions).paddingTop) -
                progress.getBoundingClientRect().bottom
              : null,
          page: document.documentElement.scrollWidth <= innerWidth,
          scrollWidth: document.documentElement.scrollWidth,
          badControls: controls
            .filter(
              (e) =>
                !e.closest(".tbl-wrap") &&
                (e.getBoundingClientRect().left < -1 ||
                  e.getBoundingClientRect().right > innerWidth + 1),
            )
            .map((e) => ({
              tag: e.tagName,
              type: e.getAttribute("type"),
              rect: e.getBoundingClientRect().toJSON(),
            })),
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
          listLines: Array.from(document.querySelectorAll(".overview-section .list .li .t"))
            .filter(visible)
            .every((e) => {
              const name = e.querySelector("b"),
                detail = e.querySelector("span");
              return (
                !name ||
                !detail ||
                detail.getBoundingClientRect().top >= name.getBoundingClientRect().bottom - 0.5
              );
            }),
          names: controls
            .filter((e) => e.tagName === "BUTTON")
            .every((e) => e.textContent?.trim() || e.getAttribute("aria-label")),
        };
      });
      spacingEvidence.push({ name, theme, width, ...layout });
      assert(layout.listLines, `${name}-${theme}-${width}-name-detail-separate-lines`);
      assert(layout.attendanceRowWidths, `${name}-${theme}-${width}-attendance-row-widths`);
      if (layout.attendanceActionsGap !== null)
        assert(
          layout.attendanceActionsGap >= 11.5,
          `${name}-${theme}-${width}-attendance-actions-gap12`,
        );
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
try {
  await db.client.connect();
  await initialize(db.db);
  await rate.connect();
  const identity = new Identity(db, rate, conf);
  await identity.initialize();
  const app = createApp(identity, conf, { log: () => {} });
  const sourceName = (await readdir("reference")).find(
    (n) => n.normalize("NFC") === "Quản lý Hội Thánh Tin Lành(1).html",
  );
  assert(sourceName, "approved-reference-present");
  const reference = await readFile(`reference/${sourceName}`, "utf8");
  assert(
    new Bun.CryptoHasher("sha256").update(reference).digest("hex") ===
      "4bdc4ebdb3bcc7ccb98e675162ef9f14568c46bf9b1ad2d38c9a979cda2dc8b6",
    "approved-reference-hash",
  );
  const cssName = (await readdir("dist/assets")).find((n) => n.endsWith(".css"));
  const compiledCss = await readFile(`dist/assets/${cssName}`, "utf8");
  const fonts = Array.from(compiledCss.matchAll(/@font-face\{[^}]+\}/g), (m) => m[0]).join("\n");
  const sourceHtml = reference
    .replace(/<link[^>]*https:[^>]*>/g, "")
    .replace(/<script src="https:[^"]*"><\/script>/g, "")
    .replace("<style>", `<style>${fonts}</style><style>`);
  server = Bun.serve({
    hostname: "127.0.0.1",
    port: conf.port,
    tls: { cert: Bun.file(conf.cert), key: Bun.file(conf.key) },
    fetch: (req) =>
      new URL(req.url).pathname === "/__p31_source"
        ? new Response(sourceHtml, { headers: { "content-type": "text/html; charset=utf-8" } })
        : app(req, { ip: "browser-p31" }),
  });
  const fixture = await new OwnerOperations(db).create({
    email: `ui-${crypto.randomUUID()}@example.test`,
    displayName: "Owner kiểm thử P3.1",
  });
  const ownerPassword = `Owner 🌿 ${crypto.randomUUID()}`;
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
    await api("owner/churches", { name: "Hội Thánh điểm danh — synthetic", province: "Đà Nẵng" })
  ).payload.data.church;
  const base = `owner/churches/${church.id}`;
  assert(
    (
      await api(`${base}/organization/settings`, {
        unitType: "area",
        defaultAssignmentMode: "auto",
      })
    ).status === 201,
    "configure-church",
  );
  const unit = (
    await api(`${base}/organization/units`, {
      kind: "service_ministry",
      name: "Ban synthetic P3.1",
    })
  ).payload.data.unit;
  await seedP2(db, church.id, fixture.employeeId, 40);
  await db.db
    .collection("members")
    .updateMany(
      { churchId: new ObjectId(church.id) },
      { $set: { participation: "active", "assignment.unitIds": [new ObjectId(unit.id)] } },
    );
  await page.goto(`${conf.origin}/owner/churches/${church.id}/attendance`);
  await page.getByRole("heading", { name: "Điểm danh", level: 1, exact: true }).waitFor();
  await page.getByText("Chưa có buổi phù hợp bộ lọc.", { exact: true }).waitFor();
  assert(
    await page
      .getByRole("navigation")
      .getByRole("button", { name: /^Điểm danh/ })
      .isVisible(),
    "owner-menu-icon-and-label",
  );
  await capture("attendance-empty");
  await page.getByRole("button", { name: "Tạo buổi", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Tên buổi", { exact: true }).fill("Sinh hoạt ban synthetic");
  await dialog.getByLabel("Phạm vi", { exact: true }).selectOption("unit");
  await dialog.getByLabel("Đơn vị", { exact: true }).selectOption(unit.id);
  await capture("attendance-create");
  await dialog.getByRole("button", { name: "Lưu nháp", exact: true }).click();
  await page
    .locator(".att-head strong")
    .getByText("Sinh hoạt ban synthetic", { exact: true })
    .waitFor();
  await page.getByRole("button", { name: "Xem trước danh sách", exact: true }).click();
  await dialog.getByRole("button", { name: "Xác nhận mở", exact: true }).waitFor();
  assert((await dialog.locator(".li").count()) === 25, "preview-source-paged25");
  await dialog.getByRole("button", { name: "Tiếp", exact: true }).click();
  await dialog.locator(".li").last().waitFor();
  await page.waitForFunction(() => document.querySelectorAll("dialog[open] .li").length === 15);
  assert(true, "preview-next15");
  await dialog.getByRole("button", { name: "Trước", exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll("dialog[open] .li").length === 25);
  await capture("attendance-preview");
  await page.keyboard.press("Escape");
  assert((await page.getByRole("dialog").count()) === 0, "preview-escape-closes");
  await page.getByRole("button", { name: "Xem trước danh sách", exact: true }).click();
  await dialog.getByRole("button", { name: "Xác nhận mở", exact: true }).click();
  await page.getByRole("button", { name: "Chốt buổi", exact: true }).waitFor();
  const sessionId = new URL(page.url()).searchParams.get("sessionId") as string;
  const attendance = `${base}/attendance/sessions/${sessionId}`;
  const firstName = "Nguyễn synthetic 00000";
  await page.getByRole("button", { name: `${firstName} — Chưa ghi nhận`, exact: true }).click();
  await page.getByRole("button", { name: `${firstName} — Có mặt`, exact: true }).waitFor();
  assert((await page.locator(".att-count").textContent()) === "1", "manual-mark-confirmed-count1");
  assert(
    await page.getByRole("button", { name: "Quét QR", exact: true }).isEnabled(),
    "qr-enabled-in-open-session-p32",
  );
  await page.getByLabel("Tìm tên hoặc mã", { exact: true }).fill("00001");
  await page
    .getByRole("button", { name: "Nguyễn synthetic 00001 — Chưa ghi nhận", exact: true })
    .waitFor();
  assert((await page.locator(".att-item").count()) === 1, "search-is-source-filtered");
  assert(
    (await page.locator(".att-count").textContent()) === "1",
    "search-does-not-change-summary",
  );
  await page.getByLabel("Tìm tên hoặc mã", { exact: true }).fill("");
  await page.waitForFunction(() => document.querySelectorAll(".att-item").length === 25);
  await capture("attendance-open");
  await page.getByRole("button", { name: `Loại ${firstName}`, exact: true }).click();
  await dialog.getByLabel("Lý do", { exact: true }).fill("Loại nhầm danh sách synthetic");
  await capture("attendance-exclude-confirm");
  await dialog.getByRole("button", { name: "Xác nhận", exact: true }).click();
  await page.waitForFunction(() => document.querySelector(".att-count")?.textContent === "0");
  await page.getByLabel("Hiện cả người đã loại", { exact: true }).check();
  await page.getByRole("button", { name: `Đưa lại ${firstName}`, exact: true }).click();
  await dialog.getByLabel("Lý do", { exact: true }).fill("Đưa lại synthetic");
  await dialog.getByRole("button", { name: "Xác nhận", exact: true }).click();
  await page.getByRole("button", { name: `${firstName} — Chưa ghi nhận`, exact: true }).waitFor();
  assert(
    (await api(attendance)).payload.data.includedCount === 40,
    "exclude-reinclude-keeps-history-and-count",
  );
  const added = await api(`${base}/members`, {
    fullName: "Khách bổ sung synthetic",
    gender: "unknown",
    birthDate: null,
    phone: null,
    type: "visitor",
    membership: null,
    householdRole: "head",
    baptism: { status: "unknown", date: null, place: null },
    visitor: {
      stage: "new",
      firstVisit: null,
      believedOn: null,
      referrer: null,
      caregiverId: null,
    },
    family: { kind: "new", areaId: null },
    assignment: { mode: "auto", unitIds: [], serviceUnitIds: [unit.id] },
    assignmentContext: { settingsVersion: 1, asOfDate: businessDay() },
    consent: true,
  });
  assert(added.status === 201, "create-real-member-before-roster-add");
  await page.getByRole("button", { name: "Bổ sung người", exact: true }).click();
  await dialog.getByLabel("Tìm người", { exact: true }).fill("Khách");
  await dialog
    .getByRole("button", { name: "Bổ sung Khách bổ sung synthetic", exact: true })
    .click();
  await dialog.getByLabel("Lý do", { exact: true }).fill("Đến sau khi mở buổi");
  await dialog.getByRole("button", { name: "Xác nhận", exact: true }).click();
  await page
    .getByRole("button", { name: "Khách bổ sung synthetic — Chưa ghi nhận", exact: true })
    .waitFor();
  assert((await api(attendance)).payload.data.includedCount === 41, "explicit-roster-add41");
  await page.getByRole("button", { name: `${firstName} — Chưa ghi nhận`, exact: true }).click();
  await page.getByRole("button", { name: `${firstName} — Có mặt`, exact: true }).waitFor();
  await page.getByRole("button", { name: "Làm lại", exact: true }).click();
  await dialog.getByLabel("Lý do", { exact: true }).fill("Điểm danh nhầm buổi synthetic");
  await capture("attendance-reset-confirm");
  await dialog.getByRole("button", { name: "Xác nhận làm lại", exact: true }).click();
  await page.getByRole("button", { name: `${firstName} — Chưa ghi nhận`, exact: true }).waitFor();
  assert(
    (await page.locator(".att-count").textContent()) === "0",
    "reset-clears-present-not-roster",
  );
  await page.getByRole("button", { name: "Chốt buổi", exact: true }).click();
  await dialog.getByRole("button", { name: "Xác nhận chốt buổi", exact: true }).click();
  await page.getByRole("button", { name: "Mở lại", exact: true }).waitFor();
  assert(
    await page.getByRole("button", { name: `${firstName} — Vắng`, exact: true }).isDisabled(),
    "closed-unmarked-is-absent-readonly",
  );
  await capture("attendance-closed");
  await page.getByRole("button", { name: "Mở lại", exact: true }).click();
  await dialog.getByLabel("Lý do", { exact: true }).fill("Sửa kết quả synthetic");
  await dialog.getByRole("button", { name: "Xác nhận", exact: true }).click();
  await page.getByRole("button", { name: `${firstName} — Chưa ghi nhận`, exact: true }).waitFor();
  // Drop the response AFTER the real server has committed, then require explicit reconciliation.
  await page.route(
    `**/api/v1/${attendance}/participants/*`,
    async (route) => {
      const req = route.request(),
        ca = await Bun.file(tls.ca).text(),
        headers = await req.allHeaders();
      delete headers.host;
      const status = await new Promise<number>((resolve, reject) => {
        const forward = httpsRequest(
          req.url(),
          { method: req.method(), headers, servername: "localhost", family: 4, ca },
          (response) => {
            response.resume();
            response.on("end", () => resolve(response.statusCode ?? 0));
          },
        );
        forward.on("error", () => reject(new Error("Private CA forwarding failed")));
        forward.end(req.postData());
      });
      assert(status === 200, "lost-response-real-server-committed");
      await route.abort("failed");
    },
    { times: 1 },
  );
  await page.getByRole("button", { name: `${firstName} — Chưa ghi nhận`, exact: true }).click();
  await page.getByRole("button", { name: "Kiểm tra kết quả", exact: true }).waitFor();
  assert(
    await page.getByRole("button", { name: "Tạo buổi", exact: true }).isDisabled(),
    "unknown-intent-locks-new-actions",
  );
  await capture("attendance-pending");
  await page.getByRole("button", { name: "Kiểm tra kết quả", exact: true }).click();
  await page.getByRole("button", { name: `${firstName} — Có mặt`, exact: true }).waitFor();
  assert(
    (await api(attendance)).payload.data.presentCount === 1,
    "explicit-replay-no-double-count",
  );
  await page.getByRole("button", { name: "Lịch sử", exact: true }).click();
  await dialog.getByText(/Làm lại ·/).waitFor();
  assert((await dialog.locator("details").count()) >= 8, "history-events-visible");
  await capture("attendance-history");
  await page.keyboard.press("Escape");
  // Current context/filter must survive the normal idle reauthentication flow.
  await db.sessions.updateMany(
    { realm: "owner", principalId: new ObjectId(fixture.employeeId), kind: "full" },
    { $set: { lastActivityAt: new Date(Date.now() - 16 * 60_000) } },
  );
  await page.reload();
  await page.getByRole("heading", { name: "Xác thực lại", exact: true }).waitFor();
  await page.getByLabel("Mật khẩu", { exact: true }).fill(ownerPassword);
  await page.getByRole("button", { name: "Tiếp tục", exact: true }).click();
  await page.getByRole("button", { name: `${firstName} — Có mặt`, exact: true }).waitFor();
  assert(
    new URL(page.url()).searchParams.get("sessionId") === sessionId,
    "reauth-preserves-session-selection",
  );
  const userPage = await context.newPage();
  userPage.setDefaultTimeout(15000);
  for (const role of ["secretary", "ministry_lead", "treasurer"]) {
    const email = `${role}-${crypto.randomUUID()}@example.test`,
      password = `User 🕊 ${crypto.randomUUID()}`;
    const made = await api(`${base}/accounts`, {
      email,
      displayName: `Người ${role} synthetic`,
      role,
      scope:
        role === "ministry_lead"
          ? { kind: "assigned_units", unitIds: [unit.id] }
          : { kind: "church" },
    });
    assert(made.status === 201, `${role}-created`);
    secrets.push(password, made.payload.data.temporaryCredential.password);
    await userPage.goto(`${conf.origin}/h/${church.code}/login`);
    await userPage.getByLabel("Email", { exact: true }).fill(email);
    await userPage
      .getByLabel("Mật khẩu", { exact: true })
      .fill(made.payload.data.temporaryCredential.password);
    await userPage.getByRole("button", { name: "Đăng nhập", exact: true }).click();
    await userPage.getByLabel("Mật khẩu mới", { exact: true }).fill(password);
    await userPage.getByLabel("Nhập lại mật khẩu", { exact: true }).fill(password);
    await userPage.getByRole("button", { name: "Lưu mật khẩu", exact: true }).click();
    await userPage.getByRole("heading", { name: "Đăng nhập", exact: true }).waitFor();
    await userPage.getByLabel("Mật khẩu", { exact: true }).fill(password);
    await userPage.getByRole("button", { name: "Đăng nhập", exact: true }).click();
    await userPage.getByRole("button", { name: "Đăng xuất", exact: true }).waitFor();
    if (role === "treasurer") {
      assert(
        (await userPage
          .getByRole("navigation")
          .getByRole("button", { name: /^Điểm danh/ })
          .count()) === 0,
        "treasurer-no-attendance-menu",
      );
      assert(
        (
          await api(
            `churches/${church.id}/attendance/sessions`,
            undefined,
            undefined,
            "church",
            userPage,
          )
        ).status === 403,
        "treasurer-backend-denied",
      );
    } else {
      await userPage.goto(`${conf.origin}/h/${church.code}/attendance?sessionId=${sessionId}`);
      await userPage.getByRole("button", { name: `${firstName} — Có mặt`, exact: true }).waitFor();
      assert(
        await userPage
          .getByRole("navigation")
          .getByRole("button", { name: "Điểm danh", exact: true })
          .isVisible(),
        `${role}-menu-visible`,
      );
      if (role === "ministry_lead") {
        assert(
          (await userPage.getByRole("button", { name: "Tạo buổi", exact: true }).count()) === 0,
          "lead-no-management-actions",
        );
        await userPage.getByRole("button", { name: `${firstName} — Có mặt`, exact: true }).click();
        await userPage
          .getByRole("button", { name: `${firstName} — Chưa ghi nhận`, exact: true })
          .waitFor();
        assert(true, "lead-can-unmark-own-unit");
      }
      await capture(`attendance-${role}`, userPage);
    }
    await userPage.getByRole("button", { name: "Đăng xuất", exact: true }).click();
    await userPage.getByRole("heading", { name: "Đăng nhập", exact: true }).waitFor();
  }
  await userPage.close();
  // Compare the actual approved W05 common patterns at matched themes/viewports.
  const referencePage = await context.newPage();
  await referencePage.goto(`${conf.origin}/__p31_source`);
  await referencePage.locator('.nav-a[data-go="attendance"]').click();
  const parity = [];
  for (const theme of ["light", "dark"] as const)
    for (const width of [1440, 390]) {
      const values = [];
      for (const target of [page, referencePage]) {
        await target.emulateMedia({ colorScheme: theme });
        await target.setViewportSize({ width, height: 1000 });
        await target.evaluate(async () => {
          await document.fonts.ready;
        });
        values.push(
          await target.evaluate(() =>
            [".att-count", ".att-item", ".att-item .chk"].map((selector) => {
              const e = document.querySelector(selector);
              if (!e) throw new Error(`Missing ${selector}`);
              const c = getComputedStyle(e);
              return [c.fontFamily, c.fontSize, c.borderRadius, c.padding, c.backgroundColor];
            }),
          ),
        );
      }
      assert(
        JSON.stringify(values[0]) === JSON.stringify(values[1]),
        `W05-source-pattern-parity-${theme}-${width}`,
      );
      parity.push({ theme, width, actual: values[0], reference: values[1] });
      await referencePage.screenshot({
        path: `${evidence}/source-w05-${width}-${theme}.png`,
        fullPage: true,
      });
    }
  await referencePage.close();
  assert(errors.length === 0, "no-browser-script-errors");
  await Bun.write(
    `${evidence}/browser-results.json`,
    JSON.stringify(
      {
        status: "PASS",
        checks: result,
        spacing: spacingEvidence,
        sourceParity: parity,
        engine: "Firefox Playwright",
        bundleIndexSha256: new Bun.CryptoHasher("sha256")
          .update(await Bun.file("dist/index.html").arrayBuffer())
          .digest("hex"),
        limits: [
          "Local synthetic/private CA",
          "Viewport emulation, no physical/Safari/production",
          "P3.1 regression only; camera covered in P3.2 synthetic suite",
        ],
      },
      null,
      2,
    ),
  );
  console.info(JSON.stringify({ status: "PASS", checks: result.length }));
} catch (error) {
  const safe = secrets.reduce((s, v) => s.replaceAll(v, "[REDACTED]"), String(error));
  await Bun.write(
    `${evidence}/browser-failure.json`,
    JSON.stringify({ error: safe, errors, checks: result, spacing: spacingEvidence }, null, 2),
  );
  await page.screenshot({ path: `${evidence}/browser-failure.png` });
  throw new Error(safe);
} finally {
  await context.close();
  if (server) await server.stop(true);
  if (db.db.databaseName === conf.database) await db.db.dropDatabase();
  const gone = !(await db.client.db("admin").admin().listDatabases()).databases.some(
    (d) => d.name === conf.database,
  );
  await Bun.write(
    `${evidence}/browser-cleanup.json`,
    JSON.stringify({ database: conf.database, removed: gone }),
  );
  await db.client.close();
  if (rate.client.isOpen) rate.client.destroy();
}
