import { readFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { request as httpsRequest } from "node:https";
import { firefox } from "@playwright/test";
import { createApp } from "../api/app";
import type { Config } from "../api/config";
import { OwnerOperations } from "../api/identity/owner-operations";
import { Identity } from "../api/identity/service";
import { Database, initialize } from "../api/infrastructure/database";
import { RateLimit } from "../api/infrastructure/rate-limit";
import { localTls } from "./local-tls";

const evidence = process.env.CHURCH_EVIDENCE_DIR ?? "output/p2.4/r3";
// Only executed in the disposable browser container; CA trust is private to its Firefox profile.
if (process.platform !== "linux" || !process.env.CHURCH_BROWSER_CONTAINER)
  throw new Error("Use the isolated browser container");
const conf: Config = {
  cert: "/tmp/church-cert.pem",
  key: "/tmp/church-key.pem",
  origin: "https://localhost:3450",
  port: 3450,
  mongoUrl: "mongodb://host.docker.internal:27119/?replicaSet=church-local&directConnection=true",
  redisUrl: "redis://host.docker.internal:6391",
  database: `church_cms_test_p24v_${crypto.randomUUID().replaceAll("-", "")}`,
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
        const groups = Array.from(document.querySelectorAll(".organization-runtime-group")).filter(
          visible,
        );
        const gaps = groups.slice(1).flatMap((g, i) => {
          const before = groups[i] as Element;
          return before.parentElement === g.parentElement
            ? [g.getBoundingClientRect().top - before.getBoundingClientRect().bottom]
            : [];
        });
        const groupSpacing = groups.map((g) => parseFloat(getComputedStyle(g).rowGap));
        const cards = Array.from(
          document.querySelectorAll(".organization-runtime-cards > .card"),
        ).filter(visible);
        const cardHeaderSpacing = cards.flatMap((card) => {
          const header = card.querySelector(".card-h"),
            body = card.querySelector(".organization-runtime-group");
          return header && body
            ? [body.getBoundingClientRect().top - header.getBoundingClientRect().bottom]
            : [];
        });
        const scrollers = Array.from(
          document.querySelectorAll<HTMLElement>("main .tbl-wrap,dialog[open] .tbl-wrap"),
        ).filter(visible);
        const reachable = scrollers.every((frame) => {
          if (frame.scrollWidth <= frame.clientWidth) return true;
          frame.scrollLeft = frame.scrollWidth;
          const last = frame.querySelector("tr:last-child td:last-child");
          const good =
            frame.scrollLeft > 0 &&
            (!last ||
              last.getBoundingClientRect().right <= frame.getBoundingClientRect().right + 1);
          frame.scrollLeft = 0;
          return good;
        });
        const toolbar = document.querySelector(".organization-runtime .toolbar"),
          table = toolbar?.closest(".organization-runtime-group")?.querySelector(".tbl-wrap");
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
          groupSpacing,
          cardHeaderSpacing,
          cardCount: cards.length,
          reachable,
          heights,
          unitRowHeights: Array.from(
            document.querySelectorAll(".organization-units-table tbody tr"),
          )
            .filter(visible)
            .map((row) => row.getBoundingClientRect().height),
          gaps,
          tableGap:
            toolbar && table && visible(toolbar) && visible(table)
              ? table.getBoundingClientRect().top - toolbar.getBoundingClientRect().bottom
              : null,
          iconSwitch: (() => {
            const region = document.querySelector('section[aria-label="Cách hiển thị tổ chức"]');
            if (!region || !visible(region)) return null;
            const buttons = Array.from(region.querySelectorAll("button"));
            return {
              count: buttons.length,
              iconOnly: buttons.every(
                (b) => b.textContent?.trim() === "" && b.querySelectorAll("svg").length === 1,
              ),
              labels: buttons.map((b) => b.getAttribute("aria-label")),
              pressed: buttons.filter((b) => b.getAttribute("aria-pressed") === "true").length,
              sizes: buttons.map((b) => ({
                width: b.getBoundingClientRect().width,
                height: b.getBoundingClientRect().height,
              })),
            };
          })(),
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
      assert(
        layout.groupSpacing.every((g) => g >= 17.5) &&
          layout.cardHeaderSpacing.every((g) => g >= 11.5),
        `${name}-${theme}-${width}-groups18-card-heading12`,
      );
      assert(layout.reachable, `${name}-${theme}-${width}-table-last-column-reachable`);
      assert(
        layout.unitRowHeights.every((h) => h <= 144),
        `${name}-${theme}-${width}-unit-row-height-bounded`,
      );
      const iconSwitch = layout.iconSwitch;
      if (iconSwitch) {
        const firstSize = iconSwitch.sizes[0];
        assert(
          firstSize &&
            iconSwitch.count === 2 &&
            iconSwitch.iconOnly &&
            iconSwitch.pressed === 1 &&
            JSON.stringify(iconSwitch.labels) === JSON.stringify(["Card", "Bảng"]) &&
            iconSwitch.sizes.every(
              (s) =>
                s.width >= (width <= 560 ? 44 : 32) &&
                s.height >= (width <= 560 ? 44 : 32) &&
                Math.abs(s.width - firstSize.width) <= 1 &&
                Math.abs(s.height - firstSize.height) <= 1,
            ),
          `${name}-${theme}-${width}-icon-only-accessible-equal-sized-switch`,
        );
      }
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
  server = Bun.serve({
    hostname: "127.0.0.1",
    port: 3450,
    tls: { cert: Bun.file(conf.cert), key: Bun.file(conf.key) },
    fetch: (req) => app(req, { ip: "browser-container" }),
  });
  const fixture = await new OwnerOperations(db).create({
      email: `ui-${crypto.randomUUID()}@example.test`,
      displayName: "Owner kiểm thử",
    }),
    ownerPassword = `Owner 🌿 ${crypto.randomUUID()}`;
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
      await api("owner/churches", { name: "Hội Thánh P2.4 — synthetic", province: "Đà Nẵng" })
    ).payload.data.church,
    base = `owner/churches/${church.id}`,
    members = `${base}/members`;
  await api(`${base}/organization/settings`, { unitType: "area", defaultAssignmentMode: "auto" });

  const area = (await api(`${base}/organization/units`, { kind: "area", name: "Giáo khu Bình An" }))
      .payload.data.unit,
    service = (
      await api(`${base}/organization/units`, { kind: "service_ministry", name: "Ban Âm nhạc" })
    ).payload.data.unit;
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const memberInput = (name: string) => ({
    fullName: name,
    gender: "unknown",
    birthDate: "1995-04-04",
    phone: "0900123456",
    type: "believer",
    membership: "member",
    householdRole: "head",
    baptism: { status: "unknown", date: null, place: null },
    visitor: null,
    family: { kind: "new", areaId: area.id },
    assignment: { mode: "auto", unitIds: [] },
    assignmentContext: { settingsVersion: 1, asOfDate: today },
    consent: true,
  });
  const made = await api(members, memberInput("Nguyễn An synthetic"));
  assert(made.status === 201, "create-real-member");
  const member = made.payload.data.member;
  await page.goto(`${conf.origin}/owner/churches/${church.id}/bans`);
  await page.getByRole("button", { name: "Thêm nhiệm kỳ", exact: true }).waitFor();
  await page.getByRole("button", { name: "Sửa Ban Âm nhạc", exact: true }).waitFor();
  await capture("w04-empty-term");
  const displaySwitch = page.getByRole("region", { name: "Cách hiển thị tổ chức", exact: true });
  const cards = displaySwitch.getByRole("button", { name: "Card", exact: true }),
    tables = displaySwitch.getByRole("button", { name: "Bảng", exact: true });
  assert((await cards.getAttribute("aria-pressed")) === "true", "view-default-card");
  await cards.hover();
  await page.getByRole("tooltip", { name: "Card", exact: true }).waitFor();
  assert(
    await page.getByRole("tooltip", { name: "Card", exact: true }).isVisible(),
    "icon-card-hover-tooltip",
  );

  await tables.focus();
  await page.getByRole("tooltip", { name: "Bảng", exact: true }).waitFor();
  assert(
    await page.getByRole("tooltip", { name: "Bảng", exact: true }).isVisible(),
    "icon-table-keyboard-tooltip",
  );

  await page.keyboard.press("Enter");
  assert(
    (await tables.getAttribute("aria-pressed")) === "true",
    "view-keyboard-enter-selects-table",
  );
  await page.keyboard.press("Escape");
  assert(
    !(await page.getByRole("tooltip", { name: "Bảng", exact: true }).isVisible()),
    "icon-tooltip-Escape-dismisses",
  );

  assert(
    await page
      .getByRole("region", { name: "Ban Chấp sự", exact: true })
      .getByText("Chưa có nhiệm kỳ", { exact: true })
      .isVisible(),
    "view-empty-board-retained",
  );
  await capture("w04-empty-table");
  await cards.click();

  await page.getByRole("button", { name: "Thêm nhiệm kỳ", exact: true }).click();
  let dialog = page.getByRole("dialog", { name: "Nhiệm kỳ Ban Chấp sự", exact: true });
  await dialog.getByLabel("Nhiệm kỳ", { exact: true }).fill("Nhiệm kỳ synthetic 2026–2030");
  await dialog.getByLabel("Từ ngày", { exact: true }).fill(today);
  await dialog.getByLabel("Đến ngày", { exact: true }).fill("2030-12-31");
  await dialog.getByLabel("Chức vụ", { exact: true }).selectOption("secretary");
  await dialog
    .getByLabel("Tìm thuộc viên chính thức đang sinh hoạt", { exact: true })
    .fill("Nguyễn An");
  await dialog.getByRole("button", { name: "Tra cứu người", exact: true }).click();
  await dialog.getByLabel("Chọn người", { exact: true }).selectOption(member.id);
  await dialog.getByLabel("Lý do", { exact: true }).fill("Lập nhiệm kỳ synthetic");
  await capture("w04-term-form");
  await dialog.getByRole("button", { name: "Xem trước", exact: true }).click();
  await dialog.getByText("Chức vụ tổ chức không cấp quyền tài khoản.", { exact: true }).waitFor();
  await capture("w04-term-preview");
  await dialog.getByRole("button", { name: "Xác nhận", exact: true }).click();
  await dialog.waitFor({ state: "hidden" });
  await page.getByRole("button", { name: "Xác nhận nhiệm kỳ", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "Nhiệm kỳ Ban Chấp sự", exact: true });
  await dialog.getByLabel("Lý do", { exact: true }).fill("Xác nhận synthetic");
  await dialog.getByRole("button", { name: "Xem trước", exact: true }).click();
  await dialog.getByRole("button", { name: "Xác nhận", exact: true }).click();
  await dialog.waitFor({ state: "hidden" });
  await page.getByRole("button", { name: "Đổi nhân sự", exact: true }).waitFor();
  assert(true, "term-confirmed-through-ui");
  await page.getByRole("button", { name: "Sửa Ban Âm nhạc", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "Thông tin đơn vị", exact: true });
  await dialog
    .getByLabel("Tìm thuộc viên chính thức đang sinh hoạt", { exact: true })
    .fill("Nguyễn An");
  await dialog.getByRole("button", { name: "Tra cứu người", exact: true }).click();
  await dialog.getByLabel("Chọn người", { exact: true }).selectOption(member.id);
  await dialog.getByLabel("Lịch sinh hoạt", { exact: true }).fill("Chủ nhật · 09:00");
  await dialog.getByLabel("Lý do", { exact: true }).fill("Phân công synthetic");
  await capture("w04-unit-details");
  await dialog.getByRole("button", { name: "Xem trước", exact: true }).click();
  await dialog.getByRole("button", { name: "Xác nhận", exact: true }).click();
  await dialog.waitFor({ state: "hidden" });
  await page.getByRole("button", { name: "Gán Ban Âm nhạc", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "Gán ban phục vụ", exact: true });
  await dialog.getByLabel("Tìm người", { exact: true }).fill("Nguyễn An");
  await dialog.getByRole("button", { name: "Tra cứu người", exact: true }).click();
  await dialog.getByLabel("Chọn người", { exact: true }).selectOption(member.id);
  await dialog.getByLabel("Lý do", { exact: true }).fill("Tham gia phục vụ synthetic");
  await dialog.getByRole("button", { name: "Xem trước", exact: true }).click();
  await dialog
    .getByText("Giữ nguyên ban tuổi, chế độ xếp ban và khu vực.", { exact: true })
    .waitFor();
  await capture("w04-service-preview");
  await dialog.getByRole("button", { name: "Xác nhận", exact: true }).click();
  await dialog.waitFor({ state: "hidden" });
  const profile = (await api(`${members}/${member.id}`)).payload.data;
  assert(
    profile.assignment.mode === "auto" && profile.assignment.unitIds.includes(service.id),
    "service-keeps-auto-age-real-wiring",
  );
  await page.getByRole("button", { name: "Xem Ban Âm nhạc", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "Ban Âm nhạc", exact: true });
  await dialog.getByText("Nguyễn An synthetic", { exact: true }).waitFor();
  await capture("w04-roster");
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "hidden" });
  assert(true, "roster-escape-and-real-count");
  await capture("w04-complete");
  const selectedBefore = await page.getByLabel("Nhiệm kỳ", { exact: true }).inputValue();
  async function groupSnapshot() {
    return page
      .locator(".organization-runtime > section.organization-runtime-group[aria-label]")
      .evaluateAll((sections) =>
        sections.map((section) => ({
          group: section.getAttribute("aria-label"),
          actions: Array.from(section.querySelectorAll("button")).map(
            (b) => b.getAttribute("aria-label") ?? b.textContent?.trim(),
          ),
        })),
      );
  }
  const beforeViews = await groupSnapshot();
  assert(
    JSON.stringify(beforeViews.map((s) => s.group)) ===
      JSON.stringify(["Ban Chấp sự", "Ban theo độ tuổi", "Ban phục vụ", "Khu vực"]),
    "view-four-groups-original-order",
  );
  let switchRequests = 0;
  const countViewRequest = (req: import("@playwright/test").Request) => {
    if (req.url().includes(`/churches/${church.id}/organization/`)) switchRequests++;
  };
  page.on("request", countViewRequest);
  await tables.click();
  await page.getByRole("region", { name: "Nhân sự Ban Chấp sự", exact: true }).waitFor();
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  assert(
    JSON.stringify(await groupSnapshot()) === JSON.stringify(beforeViews),
    "view-all-groups-actions-identical",
  );
  assert(
    (await page.getByLabel("Nhiệm kỳ", { exact: true }).inputValue()) === selectedBefore,
    "view-selected-term-retained",
  );
  assert(switchRequests === 0, "view-switch-no-requests-or-mutation");
  page.off("request", countViewRequest);
  const serviceRegion = page.getByRole("region", { name: "Ban phục vụ", exact: true });
  assert(
    (await serviceRegion
      .getByRole("row")
      .filter({ hasText: service.name })
      .getByRole("cell", { name: "1", exact: true })
      .count()) === 1,
    "view-table-actual-member-count",
  );
  assert(
    await page
      .getByRole("region", { name: "Khu vực", exact: true })
      .getByRole("columnheader", { name: /^Gia đình$/i })
      .isVisible(),
    "view-table-area-household-column",
  );
  await capture("w04-table");
  await page.reload();
  await page.getByRole("button", { name: "Sửa Ban Âm nhạc", exact: true }).waitFor();
  assert((await tables.getAttribute("aria-pressed")) === "true", "view-preference-survives-reload");
  const otherChurch = (
    await api("owner/churches", { name: "Hội Thánh view riêng synthetic", province: "Đà Nẵng" })
  ).payload.data.church;
  await api(`owner/churches/${otherChurch.id}/organization/settings`, {
    unitType: "area",
    defaultAssignmentMode: "auto",
  });
  await page.goto(`${conf.origin}/owner/churches/${otherChurch.id}/bans`);
  await page.getByRole("button", { name: "Thêm nhiệm kỳ", exact: true }).waitFor();
  assert(
    (await cards.getAttribute("aria-pressed")) === "true",
    "view-preference-isolated-by-church",
  );
  await page.goto(`${conf.origin}/owner/churches/${church.id}/bans`);
  await page.getByRole("button", { name: "Sửa Ban Âm nhạc", exact: true }).waitFor();
  assert(
    (await tables.getAttribute("aria-pressed")) === "true",
    "view-return-to-church-restores-table",
  );

  // Lose only the response after a real committed metadata update, then reauthenticate/replay.
  await page.getByRole("button", { name: "Sửa Ban Âm nhạc", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "Thông tin đơn vị", exact: true });
  await dialog.getByLabel("Lịch sinh hoạt", { exact: true }).fill("Chủ nhật · 10:00");
  await dialog.getByLabel("Lý do", { exact: true }).fill("Đổi giờ synthetic mất phản hồi");
  await dialog.getByRole("button", { name: "Xem trước", exact: true }).click();
  const commandPath = `${base}/organization/units/${service.id}/details`,
    keys: string[] = [];
  page.on("request", (req) => {
    if (req.url().endsWith(commandPath) && req.method() === "PATCH")
      keys.push(req.headers()["idempotency-key"] ?? "");
  });
  let complete = () => {};
  const forwarded = new Promise<void>((r) => {
    complete = r;
  });
  await page.route(
    `**/api/v1/${commandPath}`,
    async (route) => {
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
        forward.on("error", () => reject(new Error("Private CA forwarding failed")));
        forward.end(req.postData());
      });
      assert(status === 200, "lost-response-real-unit-commit");
      await route.abort("failed");
      complete();
    },
    { times: 1 },
  );
  await dialog.getByRole("button", { name: "Xác nhận", exact: true }).click();
  await forwarded;
  await dialog.getByRole("button", { name: "Kiểm tra kết quả", exact: true }).waitFor();
  await page.keyboard.press("Escape");
  assert(await dialog.isVisible(), "pending-unit-blocks-Escape");
  assert(
    await page
      .locator('section[aria-label="Cách hiển thị tổ chức"] button')
      .evaluateAll(
        (buttons) =>
          buttons.length === 2 && buttons.every((b) => (b as HTMLButtonElement).disabled),
      ),
    "view-pending-disables-switch",
  );

  await capture("w04-pending");
  await db.sessions.updateMany(
    { realm: "owner", revokedAt: { $exists: false } },
    { $set: { lastActivityAt: new Date(Date.now() - 16 * 60_000) } },
  );
  await dialog.getByRole("button", { name: "Kiểm tra kết quả", exact: true }).click();
  await page.getByRole("heading", { name: "Xác thực lại", exact: true }).waitFor();
  const beforeAuth = keys.length;
  await page.getByLabel("Mật khẩu", { exact: true }).fill(ownerPassword);
  await page.getByRole("button", { name: "Tiếp tục", exact: true }).click();
  const checkResult = page.getByRole("button", { name: "Kiểm tra kết quả", exact: true });
  await checkResult.waitFor();
  assert(keys.length === beforeAuth, "unit-reauth-no-auto-replay");
  await checkResult.click();
  await page.getByRole("button", { name: "Sửa Ban Âm nhạc", exact: true }).waitFor();
  assert(
    (await tables.getAttribute("aria-pressed")) === "true",
    "view-reauth-retains-table-preference",
  );
  await page
    .getByRole("region", { name: "Ban phục vụ", exact: true })
    .getByRole("cell", { name: "Chủ nhật · 10:00", exact: true })
    .waitFor();
  assert(keys.length >= 2 && new Set(keys).size === 1, "unit-retry-preserves-key");
  assert(
    (await api(`${base}/organization/units/${service.id}`)).payload.data.version === 3,
    "unit-retry-one-version-increment",
  );

  await page.getByRole("button", { name: "Lịch sử nhiệm kỳ", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "Lịch sử tổ chức", exact: true });
  await dialog.getByText("Lập nhiệm kỳ synthetic", { exact: true }).waitFor();
  await capture("w04-history");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: /^Phân quyền/ }).click();
  await page.getByRole("main").getByText("Ban mình: danh sách rút gọn", { exact: true }).waitFor();
  await capture("w13-policy");
  await page.getByRole("button", { name: /^Tài khoản/ }).click();
  await page.getByRole("button", { name: "Thêm tài khoản", exact: true }).click();
  dialog = page.getByRole("dialog");
  const leadEmail = `lead-${crypto.randomUUID()}@example.test`;
  await dialog.getByLabel("Email", { exact: true }).fill(leadEmail);
  await dialog.getByLabel("Họ tên", { exact: true }).fill("Trưởng ban synthetic");
  await dialog.getByLabel("Vai trò", { exact: true }).selectOption("ministry_lead");
  await dialog.getByLabel(service.name, { exact: true }).check();
  await capture("o03-assigned-scope");
  const response = page.waitForResponse(
    (r) => r.request().method() === "POST" && r.url().endsWith(`${base}/accounts`),
  );
  await dialog.getByRole("button", { name: "Lưu tài khoản", exact: true }).click();
  const saved = (await (await response).json()).data;
  const temp = saved.temporaryCredential.password;
  secrets.push(temp);
  assert(
    saved.account.scope.unitIds.length === 1 && saved.account.scope.unitIds[0] === service.id,
    "owner-O03-creates-validated-scope",
  );
  await dialog.getByRole("button", { name: "Đóng", exact: true }).last().click();
  await page.goto(`${conf.origin}/h/${church.code}/login`);
  await page.getByLabel("Email", { exact: true }).fill(leadEmail);
  await page.getByLabel("Mật khẩu", { exact: true }).fill(temp);
  await page.getByRole("button", { name: "Đăng nhập", exact: true }).click();
  const pw = `Lead 🌿 ${crypto.randomUUID()}`;
  secrets.push(pw);
  await page.getByLabel("Mật khẩu mới", { exact: true }).fill(pw);
  await page.getByLabel("Nhập lại mật khẩu", { exact: true }).fill(pw);
  await page.getByRole("button", { name: "Lưu mật khẩu", exact: true }).click();
  await page.getByRole("heading", { name: "Đăng nhập", exact: true }).waitFor();
  await page.getByLabel("Mật khẩu", { exact: true }).fill(pw);
  await page.getByRole("button", { name: "Đăng nhập", exact: true }).click();
  await page.getByRole("button", { name: "Ban ngành & Khu vực", exact: true }).click();
  await page.getByRole("button", { name: "Xem Ban Âm nhạc", exact: true }).waitFor();
  assert(
    (await page.getByRole("button", { name: "Thuộc viên", exact: true }).count()) === 0 &&
      (await page.getByRole("button", { name: /^Gia đình$/i }).count()) === 0,
    "lead-has-no-member-family-menu",
  );
  await capture("w04-lead-scope");
  assert(
    (await cards.getAttribute("aria-pressed")) === "true",
    "view-lead-does-not-inherit-owner-preference",
  );
  await tables.click();
  const leadService = page.getByRole("region", { name: "Ban phục vụ", exact: true });
  assert(
    (await leadService.getByRole("columnheader", { name: /^Người phụ trách$/i }).count()) === 0 &&
      (await leadService.getByRole("button", { name: /^Sửa |^Gán |^Lịch sử / }).count()) === 0,
    "view-table-retains-lead-restrictions",
  );
  assert(
    (await page.getByRole("region", { name: "Ban Chấp sự", exact: true }).count()) === 0,
    "view-table-no-board-for-lead",
  );
  await capture("w04-lead-table");
  await page.reload();
  await page.getByRole("button", { name: "Xem Ban Âm nhạc", exact: true }).waitFor();
  assert(
    (await tables.getAttribute("aria-pressed")) === "true",
    "view-lead-own-preference-persists",
  );

  await page.getByRole("button", { name: "Xem Ban Âm nhạc", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "Ban Âm nhạc", exact: true });
  await dialog.getByText("Nguyễn An synthetic", { exact: true }).waitFor();
  assert(
    (await dialog.getByText("0900123456", { exact: true }).count()) === 0 &&
      (await dialog.getByRole("button", { name: "Xem hồ sơ", exact: true }).count()) === 0,
    "lead-roster-reduced-fields",
  );
  await capture("w04-lead-roster");
  await page.keyboard.press("Escape");
  assert(
    (await api(`churches/${church.id}/members/${member.id}`, undefined, undefined, "church"))
      .status === 403,
    "lead-full-profile-backend-denied",
  );

  // Pagination is held in the owning controller, not reconstructed when switching renderers.
  for (let i = 0; i < 25; i++)
    assert(
      (
        await api(`${base}/organization/units`, {
          kind: "service_ministry",
          name: `Ban phục vụ synthetic ${String(i).padStart(2, "0")}`,
        })
      ).status === 201,
      `view-paging-fixture-${i}`,
    );
  const draft = (
    await api(`${base}/organization/board-terms`, {
      label: "Nhiệm kỳ nháp view synthetic",
      startOn: null,
      endOn: null,
      appointments: [],
      reason: "Kiểm view",
      effectiveOn: today,
    })
  ).payload.data.term;
  await page.goto(`${conf.origin}/owner/churches/${church.id}/bans`);
  await page.getByRole("button", { name: "Thêm nhiệm kỳ", exact: true }).waitFor();
  await page.getByLabel("Nhiệm kỳ", { exact: true }).selectOption(draft.id);
  const allService = page.getByRole("region", { name: "Ban phục vụ", exact: true });
  await allService.getByRole("button", { name: "Xem thêm", exact: true }).click();
  await page.getByRole("button", { name: "Xem Ban Âm nhạc", exact: true }).waitFor();
  const loadedActions = await groupSnapshot();
  assert(
    (await allService.getByRole("button", { name: /^Xem / }).count()) === 26,
    "view-loaded-second-page-real-units",
  );
  await cards.click();
  assert(
    JSON.stringify(await groupSnapshot()) === JSON.stringify(loadedActions),
    "view-retains-all-loaded-pages-and-actions",
  );
  assert(
    (await page.getByLabel("Nhiệm kỳ", { exact: true }).inputValue()) === draft.id,
    "view-retains-explicit-noncurrent-term",
  );
  await tables.click();
  await capture("w04-paged-table");
  const ownerPreference = await page.evaluate(
    (id) =>
      Object.keys(localStorage).find(
        (k) => k.startsWith("church-cms:organization-view:owner:") && k.endsWith(`:${id}`),
      ),
    church.id,
  );
  assert(!!ownerPreference, "view-preference-key-has-owner-and-church");
  await page.evaluate((key) => localStorage.setItem(key, "invalid-view"), ownerPreference);
  await page.reload();
  await page.getByRole("button", { name: "Thêm nhiệm kỳ", exact: true }).waitFor();
  assert(
    (await cards.getAttribute("aria-pressed")) === "true",
    "view-invalid-stored-value-defaults-card",
  );
  // A blocked preference store is optional and cannot prevent reading/switching.
  const privatePage = await context.newPage();
  privatePage.on("pageerror", (e) => errors.push(e.message));
  await privatePage.addInitScript(() => {
    for (const name of ["getItem", "setItem"])
      Object.defineProperty(Storage.prototype, name, {
        configurable: true,
        value() {
          throw new DOMException("Synthetic blocked preference storage", "SecurityError");
        },
      });
  });
  await privatePage.goto(`${conf.origin}/h/${church.code}/bans`);
  await privatePage.getByRole("button", { name: "Xem Ban Âm nhạc", exact: true }).waitFor();
  const privateSwitch = privatePage.getByRole("region", {
    name: "Cách hiển thị tổ chức",
    exact: true,
  });
  await privateSwitch.getByRole("button", { name: "Bảng", exact: true }).click();
  assert(
    (await privateSwitch
      .getByRole("button", { name: "Bảng", exact: true })
      .getAttribute("aria-pressed")) === "true",
    "view-blocked-storage-can-switch",
  );
  await privateSwitch.getByRole("button", { name: "Card", exact: true }).click();
  assert(
    await privatePage.getByRole("button", { name: "Xem Ban Âm nhạc", exact: true }).isVisible(),
    "view-blocked-storage-remains-readable",
  );
  await privatePage.close();
  assert(errors.length === 0, "no-browser-errors");
  await Bun.write(
    `${evidence}/browser-results.json`,
    JSON.stringify(
      {
        status: "PASS",
        engine: "Firefox Playwright",
        checks: result,
        spacing: spacingEvidence,
        limits: ["Local synthetic private CA", "Physical devices/Safari/production NOT_RUN"],
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
    JSON.stringify({ error: safe, errors, checks: result, spacing: spacingEvidence }, null, 2),
  );
  await page.screenshot({
    path: `${evidence}/browser-failure.png`,
    style: "input {visibility:hidden !important;}",
  });
  throw new Error(safe);
} finally {
  await context.close();
  if (server) await server.stop(true);
  if (db.db.databaseName === conf.database) await db.db.dropDatabase();
  await db.client.close();
  if (rate.client.isOpen) rate.client.destroy();
}
