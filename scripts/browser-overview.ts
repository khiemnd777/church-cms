import { mkdir, readdir, readFile } from "node:fs/promises";
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

const evidence = process.env.CHURCH_EVIDENCE_DIR ?? "output/p2.6";
// Only executed in the disposable browser container; CA trust is private to its Firefox profile.
if (process.platform !== "linux" || !process.env.CHURCH_BROWSER_CONTAINER)
  throw new Error("Use the isolated browser container");
const conf: Config = {
  cert: "/tmp/church-cert.pem",
  key: "/tmp/church-key.pem",
  origin: "https://localhost:3461",
  port: 3461,
  mongoUrl: "mongodb://host.docker.internal:27119/?replicaSet=church-local&directConnection=true",
  redisUrl: "redis://host.docker.internal:6391",
  database: `church_cms_test_browser_p26_${crypto.randomUUID().replaceAll("-", "")}`,
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
        ).filter((e) => visible(e) && !e.closest(".ui-report-chart"));
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
    port: 3461,
    tls: { cert: Bun.file(conf.cert), key: Bun.file(conf.key) },
    fetch: (req) =>
      new URL(req.url).pathname === "/__p26_source"
        ? new Response(sourceHtml, { headers: { "content-type": "text/html; charset=utf-8" } })
        : app(req, { ip: "browser-container" }),
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
      await api("owner/churches", {
        name: "Hội Thánh Tổng quan — synthetic",
        province: "Đà Nẵng",
        address: "Địa chỉ synthetic",
      })
    ).payload.data.church,
    base = `owner/churches/${church.id}`;
  assert(
    (
      await api(`${base}/organization/settings`, {
        unitType: "custom",
        customUnitLabel: "Giáo khu",
        defaultAssignmentMode: "auto",
      })
    ).status === 201,
    "configured-overview-synthetic",
  );
  const areas = [];
  for (let i = 0; i < 9; i++)
    areas.push(
      (
        await api(`${base}/organization/units`, {
          kind: "area",
          name: `Giáo khu synthetic ${i + 1}`,
        })
      ).payload.data.unit,
    );
  const seed = await seedP2(db, church.id, fixture.employeeId, 200);
  await db.db
    .collection("organization_units")
    .updateOne(
      { _id: new ObjectId(areas[0]?.id) },
      { $set: { status: "inactive" }, $inc: { version: 1 } },
    );
  const current = seed.members.filter((m) => ["active", "long_absent"].includes(m.participation)),
    candidate = current.find(
      (m) => m.type === "believer" && m.membership === "member" && m.participation === "active",
    );
  assert(candidate, "eligible-board-fixture");
  const term = (
    await api(`${base}/organization/board-terms`, {
      label: "Nhiệm kỳ synthetic",
      startOn: businessDay(),
      endOn: "2030-12-31",
      appointments: [{ memberId: candidate._id.toHexString(), position: "secretary" }],
      effectiveOn: businessDay(),
      reason: "Synthetic board",
    })
  ).payload.data.term;
  assert(
    (
      await api(
        `${base}/organization/board-terms/${term.id}/confirm`,
        { effectiveOn: businessDay(), reason: "Synthetic confirm" },
        1,
        "owner",
        page,
        "POST",
      )
    ).status === 200,
    "confirmed-board-for-real-hero",
  );
  await page.goto(`${conf.origin}/owner/churches/${church.id}/overview`);
  await page.locator(".hero").waitFor();
  assert(
    await page.getByRole("heading", { name: church.name, exact: true }).isVisible(),
    "hero-correct-church",
  );
  assert(
    await page.locator(".hero").getByText(candidate.fullName, { exact: true }).isVisible(),
    "hero-secretary-from-board-not-account-role",
  );
  assert(
    await page
      .getByRole("navigation")
      .locator('[aria-current="page"]')
      .filter({ hasText: "Tổng quan" })
      .isVisible(),
    "owner-overview-active-menu",
  );
  assert((await page.locator(".grid.g4 .kpi").count()) === 4, "source-four-kpi-order");
  assert(
    (await page.locator(".grid.g4 .kpi").first().locator(".big").textContent()) ===
      String(current.length),
    "dashboard-total-real-current-count",
  );
  assert(
    (await page.locator(".grid.g4 .kpi").nth(2).locator(".big").textContent()) === "—",
    "attendance-null-not-fake-zero",
  );
  assert((await page.locator(".qa button").count()) === 8, "eight-original-shortcuts");
  assert(
    (await page.locator(".qa button:disabled").count()) === 3,
    "future-three-shortcuts-disabled",
  );
  assert(
    (await page.locator(".ui-report-chart button").count()) === 12,
    "twelve-calendar-slots-without-fabricated-counts",
  );
  assert(
    (await page.locator(".ui-report-chart button:disabled").count()) === 12,
    "missing-reference-slots-disabled",
  );
  await capture("w01-complete");
  // Independent approved HTML and actual W01, same viewport/theme/local fonts.
  // Compare retained styles only; real data and unavailable sections intentionally differ.
  const sourcePage = await context.newPage();
  for (const theme of ["light", "dark"] as const) {
    await sourcePage.emulateMedia({ colorScheme: theme });
    await page.emulateMedia({ colorScheme: theme });
    for (const width of [1440, 901, 900, 560, 390]) {
      await sourcePage.setViewportSize({ width, height: 1000 });
      await page.setViewportSize({ width, height: 1000 });
      await sourcePage.goto(`${conf.origin}/__p26_source`);
      await sourcePage.locator(".hero").waitFor();
      await sourcePage.evaluate(() => document.fonts.ready);
      for (const selector of [".hero", ".hero h2", ".card.kpi", ".mini", ".list .li .t b"]) {
        const properties = [
          "background-color",
          "color",
          "font-family",
          "font-size",
          "border-radius",
          "padding-top",
          "padding-left",
          "column-gap",
        ];
        const styles = async (p: typeof page) =>
          p
            .locator(selector)
            .first()
            .evaluate((el, props) => {
              const style = getComputedStyle(el);
              return props.map((key) => style.getPropertyValue(key));
            }, properties);
        assert(
          JSON.stringify(await styles(page)) === JSON.stringify(await styles(sourcePage)),
          `source-style-${selector}-${width}-${theme}`,
        );
      }
      if ([1440, 390].includes(width))
        await sourcePage.screenshot({
          path: `${evidence}/reference-w01-${width}-${theme}.png`,
          fullPage: true,
        });
    }
  }
  await sourcePage.close();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.emulateMedia({ colorScheme: "light" });
  await page.getByRole("button", { name: "Tra cứu thuộc viên", exact: true }).focus();
  await page.getByRole("tooltip").filter({ hasText: "Tra cứu thuộc viên" }).waitFor();
  assert(true, "shortcut-keyboard-tooltip");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Thêm thuộc viên", exact: true }).click();
  await page.getByRole("dialog", { name: "Thêm thuộc viên", exact: true }).waitFor();
  assert(true, "shortcut-add-opens-existing-form");
  await capture("w15-overview-create");
  await page
    .getByRole("dialog", { name: "Thêm thuộc viên", exact: true })
    .getByRole("button", { name: "Đóng", exact: true })
    .click();
  await page
    .getByRole("navigation")
    .getByRole("button", { name: /^Tổng quan(?: —|$)/ })
    .click();
  await page.locator(".hero").waitFor();
  const visitorCard = page
    .locator(".card")
    .filter({ has: page.getByRole("heading", { name: "Thân hữu", exact: true }) });
  await visitorCard.getByRole("button", { name: "Mới đến trong 30 ngày →", exact: true }).click();
  await page.getByLabel("Thân hữu mới", { exact: true }).waitFor();
  assert(
    (await page.getByLabel("Thân hữu mới", { exact: true }).inputValue()) === "last30",
    "drilldown-last30-filter-visible",
  );
  await page.waitForFunction(() => document.querySelectorAll(".members-table tbody tr").length > 0);
  const ids = await page
    .locator(".members-table tbody tr")
    .evaluateAll((rows) => rows.map((r) => r.textContent));
  assert(
    ids.every((t) => t?.includes("Thân hữu")),
    "last30-drilldown-visitors-only",
  );
  await capture("w02-last30");
  await page.reload();
  await page.getByLabel("Thân hữu mới", { exact: true }).waitFor();
  assert(
    (await page.getByLabel("Thân hữu mới", { exact: true }).inputValue()) === "last30",
    "reload-preserves-overview-query",
  );
  await page.getByRole("button", { name: "Xuất dữ liệu", exact: true }).click();
  await page.getByRole("button", { name: "Xem trước xuất", exact: true }).click();
  await page.getByRole("button", { name: "Tạo file", exact: true }).waitFor();
  assert(
    await page.getByText(/Đến lần đầu: 30 ngày gần nhất/).isVisible(),
    "export-retains-translated-overview-filter",
  );
  await page
    .getByRole("navigation")
    .getByRole("button", { name: /^Tổng quan(?: —|$)/ })
    .click();
  await page.locator(".hero").waitFor();
  const birthdayCard = page
      .locator(".card")
      .filter({ has: page.getByRole("heading", { name: "Sinh nhật tuần này", exact: true }) }),
    nextLink = birthdayCard.getByRole("button", { name: /Tháng .*: .* người →/ }).last(),
    linkText = await nextLink.textContent();
  await nextLink.click();
  await page.getByLabel("Sinh nhật", { exact: true }).waitFor();
  assert(
    /^month:\d{4}-\d{2}$/.test(await page.getByLabel("Sinh nhật", { exact: true }).inputValue()),
    "next-month-explicit-year-filter",
  );
  assert(!!linkText, "next-month-link-label");
  await capture("w02-birthday-period");
  await page
    .getByRole("navigation")
    .getByRole("button", { name: /^Tổng quan(?: —|$)/ })
    .click();
  await page.locator(".hero").waitFor();
  const birthdays = page
    .locator(".card")
    .filter({ has: page.getByRole("heading", { name: "Sinh nhật tuần này", exact: true }) });
  const name = await birthdays.locator(".list button").first().textContent();
  await birthdays.locator(".list button").first().click();
  await page
    .getByRole("dialog")
    .filter({ has: page.getByRole("heading", { name: new RegExp(name ?? "synthetic") }) })
    .waitFor();
  assert(true, "birthday-name-opens-matching-profile");
  await page.getByRole("dialog").getByRole("button", { name: "Đóng", exact: true }).click();
  await page
    .getByRole("navigation")
    .getByRole("button", { name: /^Tổng quan(?: —|$)/ })
    .click();
  await page.locator(".hero").waitFor();
  await page.route(`**/api/v1/${base}/overview`, (route) => route.abort("failed"), { times: 1 });
  await page.getByRole("button", { name: "Làm mới", exact: true }).click();
  await page.getByRole("alert").waitFor();
  assert((await page.locator(".hero").count()) === 0, "failed-refresh-clears-stale-counts");
  await capture("w01-error");
  await page.getByRole("button", { name: "Làm mới", exact: true }).click();
  await page.locator(".hero").waitFor();
  let release = () => {};
  const held = new Promise<void>((r) => {
    release = r;
  });
  await page.route(
    `**/api/v1/${base}/overview`,
    async (route) => {
      await held;
      await route.continue();
    },
    { times: 1 },
  );
  await page.getByRole("button", { name: "Làm mới", exact: true }).click();
  await page.getByText("Đang tải…", { exact: true }).waitFor();
  await capture("w01-loading");
  release();
  await page.locator(".hero").waitFor();
  const empty = (
    await api("owner/churches", { name: "Hội Thánh rỗng — synthetic", province: "Đà Nẵng" })
  ).payload.data.church;
  await page.goto(`${conf.origin}/owner/churches/${empty.id}/overview`);
  await page.locator(".hero").waitFor();
  assert(
    (await page.locator(".kpi").first().locator(".big").textContent()) === "0",
    "empty-true-zero",
  );
  await page
    .getByText("Hội Thánh chưa hoàn tất cấu hình. Các số liệu hồ sơ hiện có vẫn được hiển thị.")
    .waitFor();
  await capture("w01-empty-unconfigured");
  const userPage = await context.newPage();
  userPage.on("pageerror", (e) => errors.push(e.message));
  for (const role of ["secretary", "treasurer", "ministry_lead"]) {
    const email = `${role}-${crypto.randomUUID()}@example.test`,
      password = `User 🌿 ${crypto.randomUUID()}`;
    secrets.push(password);
    const made = (
      await api(`owner/churches/${church.id}/accounts`, {
        email,
        displayName: `User ${role} synthetic`,
        role,
        scope:
          role === "ministry_lead"
            ? { kind: "assigned_units", unitIds: [areas[1]?.id] }
            : { kind: "church" },
      })
    ).payload.data;
    secrets.push(made.temporaryCredential.password);
    await userPage.goto(`${conf.origin}/h/${church.code}/login`);
    await userPage.getByLabel("Email", { exact: true }).fill(email);
    await userPage.getByLabel("Mật khẩu", { exact: true }).fill(made.temporaryCredential.password);
    await userPage.getByRole("button", { name: "Đăng nhập", exact: true }).click();
    await userPage.getByLabel("Mật khẩu mới", { exact: true }).fill(password);
    await userPage.getByLabel("Nhập lại mật khẩu", { exact: true }).fill(password);
    await userPage.getByRole("button", { name: "Lưu mật khẩu", exact: true }).click();
    await userPage.getByRole("heading", { name: "Đăng nhập", exact: true }).waitFor();
    await userPage.getByLabel("Mật khẩu", { exact: true }).fill(password);
    await userPage.getByRole("button", { name: "Đăng nhập", exact: true }).click();
    if (role === "secretary") {
      await userPage.locator(".hero").waitFor();
      assert(
        await userPage
          .getByRole("navigation")
          .getByRole("button", { name: /^Tổng quan(?: —|$)/ })
          .isVisible(),
        "secretary-default-overview",
      );
      await capture("w01-secretary", userPage);
      await userPage.getByRole("button", { name: "Làm mới", exact: true }).focus();
      await db.sessions.updateMany(
        { realm: "church", revokedAt: { $exists: false } },
        { $set: { lastActivityAt: new Date(Date.now() - 16 * 60_000) } },
      );
      await userPage.getByRole("button", { name: "Làm mới", exact: true }).click();
      await userPage.getByRole("heading", { name: "Xác thực lại", exact: true }).waitFor();
      await userPage.getByLabel("Mật khẩu", { exact: true }).fill(password);
      await userPage.getByRole("button", { name: "Tiếp tục", exact: true }).click();
      await userPage.locator(".hero").waitFor();
      assert(true, "overview-reauth-returns-to-same-church");
    } else {
      await userPage
        .getByRole("heading", { name: "Thông tin truy cập", exact: true, level: 1 })
        .waitFor();
      assert(
        (await userPage
          .getByRole("navigation")
          .getByRole("button", { name: /^Tổng quan(?: —|$)/ })
          .count()) === 0,
        `${role}-no-global-overview-menu`,
      );
      assert(
        (await api(`churches/${church.id}/overview`, undefined, undefined, "church", userPage))
          .status === 403,
        `${role}-backend-overview-denied`,
      );
    }
    await userPage.getByRole("button", { name: "Đăng xuất", exact: true }).click();
    await userPage.getByRole("heading", { name: "Đăng nhập", exact: true }).waitFor();
  }
  await userPage.close();
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
        source: "UI-STD-r1 W01 with P2.6-plan-r1 approved availability adaptations",
        limits: [
          "Local synthetic, private CA",
          "Viewport emulation, no Safari/physical/production",
          "Dataset on isolated disposable MongoDB",
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
  await db.client.close();
  if (rate.client.isOpen) rate.client.destroy();
}
