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

const evidence = process.env.CHURCH_EVIDENCE_DIR ?? "output/p2.1";
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
  database: `church_cms_test_browser_p21_${crypto.randomUUID().replaceAll("-", "")}`,
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
            innerWidth > 560 ||
            controls.every(
              (el) =>
                (el.matches('input[type="radio"],input[type="checkbox"]')
                  ? (el.closest("label") ?? el)
                  : el
                ).getBoundingClientRect().height >= 44,
            ),
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
      const spacing = await subject.evaluate(() => {
        const visible = (el: Element) =>
          el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden";
        const fields = Array.from(document.querySelectorAll<HTMLElement>(".ui-field"))
          .filter(visible)
          .flatMap((field) => {
            const label = field.firstElementChild,
              control = field.querySelector(".input,.select");
            return label && control && visible(control)
              ? [control.getBoundingClientRect().top - label.getBoundingClientRect().bottom]
              : [];
          });
        const groups = Array.from(
          document.querySelectorAll<HTMLElement>(".organization-settings-group"),
        ).filter(visible);
        const groupGaps = groups
          .slice(1)
          .map(
            (group, i) =>
              group.getBoundingClientRect().top -
              (groups[i] as HTMLElement).getBoundingClientRect().bottom,
          );
        const headingGaps = groups.flatMap((group) => {
          const heading = group.querySelector(".card-h"),
            content = group.querySelector(".organization-group-content");
          return heading && content
            ? [content.getBoundingClientRect().top - heading.getBoundingClientRect().bottom]
            : [];
        });
        const tableGaps = Array.from(
          document.querySelectorAll(".organization-unit-content"),
        ).flatMap((panel) => {
          const toolbar = panel.querySelector(".toolbar"),
            table = panel.querySelector(".tbl-wrap");
          return toolbar && table && visible(table)
            ? [table.getBoundingClientRect().top - toolbar.getBoundingClientRect().bottom]
            : [];
        });
        const ageGaps = Array.from(document.querySelectorAll(".organization-age-row"))
          .filter(visible)
          .flatMap((row) => {
            const name = row.querySelector("strong"),
              range = row.querySelector("span");
            if (!name || !range) return [];
            const a = name.getBoundingClientRect(),
              b = range.getBoundingClientRect();
            return Math.abs(a.top - b.top) < 4 ? [b.left - a.right] : [];
          });
        const tableCount = Array.from(document.querySelectorAll("main .tbl-wrap")).filter(
          visible,
        ).length;
        const inputHeights = Array.from(
          document.querySelectorAll(".ui-field input.input,.ui-field select.select"),
        )
          .filter(visible)
          .map((el) => el.getBoundingClientRect().height);
        return { fields, groupGaps, headingGaps, tableGaps, ageGaps, tableCount, inputHeights };
      });
      spacingEvidence.push({ screen: name, theme, width, measurements: spacing });
      assert(
        spacing.inputHeights.every((height) => height >= 32 && height <= 48),
        `${name}-${theme}-${width}-single-line-controls-source-height`,
      );
      assert(
        spacing.fields.every((gap) => gap >= 4.5),
        `${name}-${theme}-${width}-field-label-control-gap5`,
      );
      assert(
        spacing.groupGaps.length === 1 &&
          spacing.headingGaps.length === 2 &&
          spacing.groupGaps.every((gap) => gap >= 17.5) &&
          spacing.headingGaps.every((gap) => gap >= 11.5),
        `${name}-${theme}-${width}-settings-group18-heading12`,
      );
      assert(
        spacing.tableGaps.length === spacing.tableCount &&
          spacing.tableGaps.every((gap) => gap >= 17.5),
        `${name}-${theme}-${width}-toolbar-table-gap18`,
      );
      assert(
        spacing.ageGaps.length === 5 && spacing.ageGaps.every((gap) => gap >= 9.5),
        `${name}-${theme}-${width}-age-label-value-gap10`,
      );
      if ([1440, 390].includes(width))
        await subject.screenshot({
          path: `${evidence}/${name}-${width}-${theme}.png`,
          style: "input[readonly] { visibility: hidden !important; }",
          fullPage: true,
        });
    }
  }
  await subject.setViewportSize({ width: 1440, height: 1000 });
  await subject.emulateMedia({ colorScheme: "light" });
}
async function org(
  path: string,
  body?: object,
  version?: number,
  realm: "owner" | "church" = "owner",
  method?: string,
  subject = page,
) {
  return subject.evaluate(
    async ({ path, body, version, realm, method }) => {
      const token = (await (await fetch(`/api/v1/auth/csrf?realm=${realm}`)).json()).data.csrfToken;
      const res = await fetch(`/api/v1/${path}`, {
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
      return { status: res.status, data: res.status === 204 ? null : await res.json() };
    },
    { path, body, version, realm, method },
  );
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

  const made = await api("owner/churches", {
    name: "Hội Thánh P2.1 — synthetic",
    province: "Đà Nẵng",
  });
  assert(made.status === 201, "owner-create-tenant");
  const church = made.payload.data.church,
    base = `owner/churches/${church.id}/organization`;
  await page.goto(`${conf.origin}/owner/churches/${church.id}`);
  await page.getByRole("main").getByRole("button", { name: "Cấu hình", exact: true }).click();
  await page.getByRole("button", { name: "Thiết lập", exact: true }).waitFor();
  assert(page.url().endsWith("/config"), "O02-config-explicit-tenant-route");
  assert(
    (await db.db.collection("church_settings").countDocuments({ _id: new ObjectId(church.id) })) ===
      0,
    "opening-config-does-not-write",
  );
  await capture("w12-unconfigured");
  await page.getByLabel("Khác", { exact: true }).check();
  await page.getByLabel("Tên gọi khác", { exact: true }).fill("Giáo khu");
  await page.getByRole("button", { name: "Thiết lập", exact: true }).click();
  await page.getByRole("heading", { name: "Ban phục vụ", exact: true }).waitFor();
  assert(
    (await db.db
      .collection("organization_units")
      .countDocuments({ churchId: new ObjectId(church.id) })) === 6,
    "setup-six-system-units-no-demo-data",
  );
  await page.getByText("Chưa có ban phục vụ.", { exact: true }).waitFor();
  await capture("w12-configured");
  await page.getByRole("button", { name: "Thêm ban phục vụ", exact: true }).click();
  await page.getByLabel("Tên", { exact: true }).waitFor();
  await page.waitForFunction(
    () => document.activeElement === document.querySelector("dialog[open] input"),
  );
  assert(true, "unit-dialog-initial-focus");
  await page.getByRole("dialog").getByRole("button", { name: "Lưu", exact: true }).focus();
  await page.keyboard.press("Tab");
  assert(
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Đóng", exact: true })
      .evaluate((el) => el === document.activeElement),
    "unit-dialog-keyboard-trap",
  );
  await page.keyboard.press("Escape");
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  assert(
    await page
      .getByRole("button", { name: "Thêm ban phục vụ", exact: true })
      .evaluate((el) => el === document.activeElement),
    "Escape-restores-trigger",
  );
  await page.getByRole("button", { name: "Thêm ban phục vụ", exact: true }).click();
  await page.getByLabel("Tên", { exact: true }).fill("Ban Âm nhạc");
  await capture("w12-add-dialog");
  await page.getByRole("dialog").getByRole("button", { name: "Lưu", exact: true }).click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  await page.getByRole("cell", { name: "Ban Âm nhạc", exact: true }).waitFor();
  const unit = await db.db
    .collection("organization_units")
    .findOne({ churchId: new ObjectId(church.id), name: "Ban Âm nhạc" });
  assert(!!unit, "create-unit-real-database");
  await page.getByRole("button", { name: "Thêm ban phục vụ", exact: true }).click();
  await page.getByLabel("Tên", { exact: true }).fill("BAN ÂM NHẠC");
  await page.getByRole("dialog").getByRole("button", { name: "Lưu", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByText("Tên đã được sử dụng trong nhóm này, kể cả mục đã ngừng sử dụng.", { exact: true })
    .first()
    .waitFor();
  assert(true, "duplicate-name-inline-error-no-false-success");
  await page.keyboard.press("Escape");
  await page
    .getByRole("row")
    .filter({ has: page.getByRole("cell", { name: "Ban Âm nhạc", exact: true }) })
    .getByRole("button", { name: "Sửa", exact: true })
    .click();
  await page.getByLabel("Tên", { exact: true }).fill("Tên từ form cũ");
  assert(
    (await org(`${base}/units/${unit._id}`, { name: "Tên từ tab khác" }, 1)).status === 200,
    "concurrent-real-api-edit",
  );
  await page.getByRole("dialog").getByRole("button", { name: "Lưu", exact: true }).click();
  await page.getByRole("button", { name: "Tải bản mới", exact: true }).waitFor();
  assert(
    (await db.db.collection("organization_units").findOne({ _id: unit._id }))?.name ===
      "Tên từ tab khác",
    "CAS-prevents-lost-update",
  );
  await page.getByRole("button", { name: "Tải bản mới", exact: true }).click();
  await page.waitForFunction(
    () =>
      document.querySelector<HTMLInputElement>("dialog[open] input")?.value === "Tên từ tab khác",
  );
  await page.getByLabel("Tên", { exact: true }).fill("Ban Âm nhạc mới");
  await page.getByRole("dialog").getByRole("button", { name: "Lưu", exact: true }).click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  await page
    .getByRole("row")
    .filter({ has: page.getByRole("cell", { name: "Ban Âm nhạc mới", exact: true }) })
    .getByRole("button", { name: "Ngừng", exact: true })
    .click();
  await page.getByLabel("Lý do", { exact: true }).fill("Ngừng phục vụ thử nghiệm");
  await capture("w12-status-dialog");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Ngừng sử dụng", exact: true })
    .click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  await page.getByLabel("Trạng thái ban phục vụ", { exact: true }).selectOption("inactive");
  await page.getByRole("cell", { name: "Ban Âm nhạc mới", exact: true }).waitFor();
  assert(
    (await db.db.collection("organization_units").findOne({ _id: unit._id }))?.status ===
      "inactive",
    "status-retains-resource-id-and-history",
  );
  await page.getByRole("button", { name: "Kích hoạt lại", exact: true }).click();
  await page.getByLabel("Lý do", { exact: true }).fill("Kích hoạt lại thử nghiệm");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Kích hoạt lại", exact: true })
    .click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  await page.getByRole("button", { name: "Thêm giáo khu", exact: true }).click();
  await page.getByLabel("Tên", { exact: true }).fill("Khu mất phản hồi");
  await page.route(
    `**/api/v1/${base}/units`,
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
        forward.on("error", reject);
        forward.end(req.postData());
      });
      assert(status === 201, "lost-response-after-real-unit-commit");
      await route.abort("failed");
    },
    { times: 1 },
  );
  await page.getByRole("dialog").getByRole("button", { name: "Lưu", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Kiểm tra kết quả", exact: true })
    .waitFor();
  await page.keyboard.press("Escape");
  assert(await page.getByRole("dialog").isVisible(), "unknown-outcome-blocks-Escape-and-close");
  assert(
    await page
      .getByRole("navigation")
      .getByRole("button", { name: "Hội Thánh", exact: true })
      .isDisabled(),
    "pending-intent-locks-navigation",
  );
  await capture("w12-unknown-outcome");
  await db.sessions.updateMany(
    { realm: "owner", kind: "full", revokedAt: { $exists: false } },
    { $set: { lastActivityAt: new Date(Date.now() - 16 * 60_000) } },
  );
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Kiểm tra kết quả", exact: true })
    .click();
  await page.getByRole("heading", { name: "Xác thực lại", exact: true }).waitFor();
  assert(
    (await db.db
      .collection("organization_units")
      .countDocuments({ churchId: new ObjectId(church.id), name: "Khu mất phản hồi" })) === 1,
    "pending-intent-preserved-across-idle-auth",
  );
  await page.getByLabel("Mật khẩu", { exact: true }).fill(ownerPassword);
  await page.getByRole("button", { name: "Tiếp tục", exact: true }).click();
  await page.getByRole("heading", { name: "Thao tác chưa được đối soát", exact: true }).waitFor();
  assert(
    (await db.db
      .collection("organization_units")
      .countDocuments({ churchId: new ObjectId(church.id), name: "Khu mất phản hồi" })) === 1,
    "reauth-does-not-auto-replay",
  );
  await page.getByRole("button", { name: "Kiểm tra kết quả", exact: true }).click();
  await page
    .getByRole("heading", { name: "Thao tác chưa được đối soát", exact: true })
    .waitFor({ state: "hidden" });
  await page.getByRole("cell", { name: "Khu mất phản hồi", exact: true }).waitFor();
  assert(
    (await db.db
      .collection("organization_units")
      .countDocuments({ churchId: new ObjectId(church.id), name: "Khu mất phản hồi" })) === 1,
    "exact-replay-resolves-one-unit",
  );
  await page.reload();
  await page.getByRole("cell", { name: "Khu mất phản hồi", exact: true }).waitFor();
  assert(true, "configuration-deep-link-reload");
  await capture("w12-complete");
  const another = await api("owner/churches", { name: "Hội Thánh P2.1 khác", province: "Đà Nẵng" }),
    second = await context.newPage();
  await second.goto(`${conf.origin}/owner/churches/${another.payload.data.church.id}/config`);
  await second.getByRole("button", { name: "Thiết lập", exact: true }).waitFor();
  assert(
    (await second.locator("header").innerText()).includes("Hội Thánh P2.1 khác") &&
      (await page.locator("header").innerText()).includes(church.code),
    "owner-two-tabs-distinct-tenant-context",
  );
  await second.close();
  const user = await context.newPage();
  user.setDefaultTimeout(15000);
  user.on("pageerror", (e) => errors.push(e.message));
  async function userLogin(role: string) {
    const email = `${role}-${crypto.randomUUID()}@example.test`,
      made = await api(`owner/churches/${church.id}/accounts`, {
        email,
        displayName: `User ${role}`,
        role,
        scope: { kind: "church" },
      });
    assert(made.status === 201, `create-${role}-account`);
    const temp = made.payload.data.temporaryCredential.password,
      password = `User ${crypto.randomUUID()}`;
    secrets.push(temp, password);
    await user.goto(`${conf.origin}/h/${church.code}/login`);
    await user.getByLabel("Email", { exact: true }).fill(email);
    await user.getByLabel("Mật khẩu", { exact: true }).fill(temp);
    await user.getByRole("button", { name: "Đăng nhập", exact: true }).click();
    await user.getByLabel("Mật khẩu mới", { exact: true }).fill(password);
    await user.getByLabel("Nhập lại mật khẩu", { exact: true }).fill(password);
    await user.getByRole("button", { name: "Lưu mật khẩu", exact: true }).click();
    await user.getByRole("heading", { name: "Đăng nhập", exact: true }).waitFor();
    await user.getByLabel("Mật khẩu", { exact: true }).fill(password);
    await user.getByRole("button", { name: "Đăng nhập", exact: true }).click();
    await user.getByRole("heading", { name: "Tổng quan", exact: true, level: 1 }).waitFor();
    await user.getByRole("button", { name: "Cấu hình", exact: true }).click();
    await user.getByRole("heading", { name: "Ban phục vụ", exact: true }).waitFor();
  }
  await userLogin("secretary");
  assert(await user.getByLabel("Khác", { exact: true }).isDisabled(), "secretary-config-read-only");
  assert(
    (await user.getByRole("button", { name: "Thêm ban phục vụ", exact: true }).count()) === 0,
    "secretary-no-mutation-controls",
  );
  assert(
    (
      await org(
        `churches/${church.id}/organization/units`,
        { kind: "area", name: "Deny ambient owner" },
        undefined,
        "church",
        undefined,
        user,
      )
    ).status === 403,
    "secretary-backend-deny-with-owner-cookie",
  );
  await capture("w12-secretary", user);
  await user.getByRole("button", { name: "Đăng xuất", exact: true }).click();
  await user.getByRole("heading", { name: "Đăng nhập", exact: true }).waitFor();
  await userLogin("pastor");
  await user.getByRole("button", { name: "Thêm ban phục vụ", exact: true }).click();
  await user.getByLabel("Tên", { exact: true }).fill("Ban do Mục sư tạo");
  await user.getByRole("dialog").getByRole("button", { name: "Lưu", exact: true }).click();
  await user.getByRole("dialog").waitFor({ state: "hidden" });
  await user.getByRole("cell", { name: "Ban do Mục sư tạo", exact: true }).waitFor();
  const event = await db.audits.findOne({
    targetChurchId: new ObjectId(church.id),
    eventType: "organization.unit_created",
    actorKind: "church_user",
  });
  assert(!!event, "pastor-write-audited-as-church-user");
  await capture("w12-pastor", user);
  assert((await api("owner/auth/me")).status === 200, "user-actions-preserve-owner-realm");
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
          "Synthetic database and private CA",
          "Viewport emulation; no physical devices/Safari/production",
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
