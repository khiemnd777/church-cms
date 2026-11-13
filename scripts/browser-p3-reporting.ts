import { mkdir, readdir, readFile } from "node:fs/promises";
import { firefox } from "@playwright/test";
import { ObjectId } from "mongodb";
import { createApp } from "../api/app";
import type { Config } from "../api/config";
import { OwnerOperations } from "../api/identity/owner-operations";
import { Identity } from "../api/identity/service";
import { Database, initialize } from "../api/infrastructure/database";
import { RateLimit } from "../api/infrastructure/rate-limit";
import { businessDay, shiftDay } from "../api/members/dates";
import { localTls } from "./local-tls";
import { SyntheticClient } from "./p2-fixtures";
import { createCertificateRite } from "./p35-fixtures";
import { p36Session, seedP36 } from "./p36-fixtures";

const evidence = process.env.CHURCH_EVIDENCE_DIR ?? "output/p3.6";
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
  database: `church_cms_test_browser_p36_${crypto.randomUUID().replaceAll("-", "")}`,
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
      new URL(req.url).pathname === "/__p36_source"
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

  const synthetic = new SyntheticClient("owner", conf.origin, (req) =>
    app(req, { ip: "p36-seed" }),
  );
  assert(
    (await synthetic.login(fixture.email, ownerPassword)).status === 200,
    "synthetic-owner-login",
  );
  const area = (
    await synthetic.call(`${base}/organization/units`, {
      kind: "area",
      name: "Khu vực P36 synthetic",
    })
  ).payload.data.unit;
  const seed = await seedP36(db, synthetic, church, fixture.employeeId, 12, 4);
  await db.db
    .collection("families")
    .updateMany({ churchId: new ObjectId(church.id) }, { $set: { areaId: new ObjectId(area.id) } });
  for (let i = 1; i <= 4; i++)
    await p36Session(
      synthetic,
      church.id,
      shiftDay(businessDay(), -i),
      { scope: "unit", unitId: area.id },
      seed.rows.slice(0, 6).map((m) => m._id.toHexString()),
    );
  const member = seed.rows.find((m) => m.type === "believer");
  assert(member, "believer-fixture");
  await createCertificateRite(synthetic, church.id, member._id.toHexString(), "baptism");
  await page.goto(`${conf.origin}/owner/churches/${church.id}/overview`);
  await page
    .getByRole("heading", { name: "Hiện diện thờ phượng 12 Chúa nhật gần nhất", exact: true })
    .waitFor();
  await page.getByText("TB4 CN: 6 · 4/4 đã chốt", { exact: true }).waitFor();
  assert((await page.locator(".ui-report-chart button").count()) === 12, "twelve-calendar-columns");
  await capture("p36-overview");
  for (const theme of ["light", "dark"] as const)
    for (const width of [1440, 901, 900, 560, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.emulateMedia({ colorScheme: theme });
      const chart = page.getByLabel("Biểu đồ cuộn 12 Chúa nhật", { exact: true });
      await chart.focus();
      await page.keyboard.press("End");
      const bounds = await chart.evaluate((el) => {
        el.scrollLeft = el.scrollWidth;
        const buttons = [...el.querySelectorAll("button")];
        const end = buttons.at(-1);
        return {
          reachable:
            !!end && end.getBoundingClientRect().right <= el.getBoundingClientRect().right + 1,
          widths: buttons.map((b) => b.getBoundingClientRect().width),
          overflow: document.documentElement.scrollWidth > innerWidth + 1,
        };
      });
      assert(
        bounds.reachable && bounds.widths.every((w) => w >= 43.5) && !bounds.overflow,
        `chart-contained-reachable-touch-${theme}-${width}`,
      );
    }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.emulateMedia({ colorScheme: "light" });
  const source = await context.newPage();
  await source.goto(`${conf.origin}/__p36_source`);
  const parity: unknown[] = [];
  for (const theme of ["light", "dark"] as const)
    for (const width of [1440, 390]) {
      const values = [];
      for (const target of [page, source]) {
        await target.emulateMedia({ colorScheme: theme });
        await target.setViewportSize({ width, height: 1000 });
        await target.evaluate(() => document.fonts.ready);
        values.push(
          await target
            .locator(".card.kpi")
            .first()
            .evaluate((el) => {
              const s = getComputedStyle(el);
              return {
                padding: s.padding,
                border: s.borderRadius,
                bg: s.backgroundColor,
                font: s.fontFamily,
              };
            }),
        );
      }
      assert(
        JSON.stringify(values[0]) === JSON.stringify(values[1]),
        `retained-KPI-source-parity-${theme}-${width}`,
      );
      parity.push({ theme, width, values });
    }
  await source.close();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.emulateMedia({ colorScheme: "light" });
  await page.getByRole("button", { name: "Xem người vắng →", exact: true }).click();
  await page.getByRole("table").first().waitFor();
  await page.waitForFunction(() => document.querySelectorAll("tbody .ui-presence").length === 6);
  assert(
    new URL(page.url()).searchParams.get("attendance") === "absent3",
    "W01-absent-drilldown-server-filter",
  );
  await capture("p36-absent-members");
  const target = seed.rows[9];
  assert(target, "absent-member-fixture");
  await page.getByRole("button", { name: target.fullName, exact: true }).click();
  await page.getByRole("heading", { name: "Hiện diện 12 Chúa nhật", exact: true }).waitFor();
  await page.getByText("Vắng ba Chúa nhật liên tiếp có đủ dữ liệu.", { exact: true }).waitFor();
  await capture("p36-member-detail");
  await page.getByRole("button", { name: new RegExp(`Mở buổi ${seed.until}:`) }).click();
  await page.getByRole("heading", { name: "Điểm danh", exact: true }).waitFor();
  assert(
    new URL(page.url()).searchParams.get("sessionId") === seed.sessions.at(-1)?.id,
    "W14-exact-reference-session",
  );
  await page.goto(`${conf.origin}/owner/churches/${church.id}/bans`);
  await page.getByText("Khu vực P36 synthetic", { exact: true }).waitFor();
  await page
    .getByText(/50%.*4 buổi riêng/)
    .first()
    .waitFor();
  await capture("p36-organization");
  const latest = seed.sessions.at(-1);
  assert(latest, "reference-fixture");
  await page.goto(`${conf.origin}/owner/churches/${church.id}/attendance?sessionId=${latest.id}`);
  await page.getByRole("button", { name: "Sửa buổi", exact: true }).click();
  await page.getByLabel("Tổng hợp", { exact: true }).selectOption("general");
  await page.getByLabel("Lý do sửa", { exact: true }).fill("Đối chiếu nguồn synthetic P36");
  await page.getByRole("button", { name: "Lưu", exact: true }).click();
  await page.getByLabel("Tôi xác nhận thay đổi nguồn tổng hợp", { exact: true }).check();
  await capture("p36-reference-confirm");
  await page.getByRole("button", { name: "Xác nhận và lưu", exact: true }).click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  await page.goto(`${conf.origin}/owner/churches/${church.id}/overview`);
  await page.getByText("Chưa chọn buổi tham chiếu", { exact: true }).waitFor();
  assert(
    (await api(`${base}/overview`)).payload.data.attendance.value === null,
    "unselected-reference-is-missing-not-zero",
  );
  // Idle reauth preserves filtered view and explicit report period.
  await page.goto(
    `${conf.origin}/owner/churches/${church.id}/members?attendance=absent3&attendanceUntil=${seed.until}`,
  );
  await page.getByText("Không có thuộc viên khớp bộ lọc.", { exact: true }).waitFor();
  await db.sessions.updateMany(
    { realm: "owner", principalId: new ObjectId(fixture.employeeId), kind: "full" },
    { $set: { lastActivityAt: new Date(Date.now() - 16 * 60_000) } },
  );
  await page.reload();
  await page.getByRole("heading", { name: "Xác thực lại", exact: true }).waitFor();
  await page.getByLabel("Mật khẩu", { exact: true }).fill(ownerPassword);
  await page.getByRole("button", { name: "Tiếp tục", exact: true }).click();
  await page.getByText("Không có thuộc viên khớp bộ lọc.", { exact: true }).waitFor();
  assert(
    new URL(page.url()).searchParams.get("attendanceUntil") === seed.until,
    "reauth-report-filter-period-preserved",
  );
  const email = `secretary-${crypto.randomUUID()}@example.test`,
    password = `Thư ký 🌿 ${crypto.randomUUID()}`,
    made = await api(`${base}/accounts`, {
      email,
      displayName: "Thư ký P36 synthetic",
      role: "secretary",
      scope: { kind: "church" },
    });
  assert(made.status === 201, "secretary-created");
  secrets.push(password, made.payload.data.temporaryCredential.password);
  const user = await context.newPage();
  await user.goto(`${conf.origin}/h/${church.code}/login`);
  await user.getByLabel("Email", { exact: true }).fill(email);
  await user
    .getByLabel("Mật khẩu", { exact: true })
    .fill(made.payload.data.temporaryCredential.password);
  await user.getByRole("button", { name: "Đăng nhập", exact: true }).click();
  await user.getByLabel("Mật khẩu mới", { exact: true }).fill(password);
  await user.getByLabel("Nhập lại mật khẩu", { exact: true }).fill(password);
  await user.getByRole("button", { name: "Lưu mật khẩu", exact: true }).click();
  await user.getByRole("heading", { name: "Đăng nhập", exact: true }).waitFor();
  await user.getByLabel("Mật khẩu", { exact: true }).fill(password);
  await user.getByRole("button", { name: "Đăng nhập", exact: true }).click();
  await user
    .getByRole("heading", { name: "Hiện diện thờ phượng 12 Chúa nhật gần nhất", exact: true })
    .waitFor();
  await capture("p36-secretary-overview", user);
  await user.getByRole("button", { name: "Sổ Báp-têm", exact: true }).click();
  await user.getByRole("tab", { name: "Báp-têm", exact: true }).waitFor();
  assert(new URL(user.url()).searchParams.get("tab") === "bap", "church-shortcut-source-route");
  await user.close();
  assert(errors.length === 0, "no-browser-errors");
  await Bun.write(
    `${evidence}/browser-results.json`,
    JSON.stringify(
      {
        status: "PASS",
        checks: result,
        spacing: spacingEvidence,
        sourceParity: parity,
        engine: "Firefox Playwright",
        limits: [
          "Local/synthetic/private CA",
          "Physical camera/paper/native Word/Safari/UAT/production NOT_RUN",
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
  const removed = !(await db.client.db("admin").admin().listDatabases()).databases.some(
    (d) => d.name === conf.database,
  );
  await Bun.write(
    `${evidence}/browser-cleanup.json`,
    JSON.stringify({ database: conf.database, removed }),
  );
  await db.client.close();
  if (rate.client.isOpen) rate.client.destroy();
}
