import { readFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { request as httpsRequest } from "node:https";
import { firefox } from "@playwright/test";
import ExcelJS from "exceljs";
import { ObjectId } from "mongodb";
import { createApp } from "../api/app";
import type { Config } from "../api/config";
import { importFields } from "../api/data-exchange/contracts";
import { makeFile } from "../api/data-exchange/files";
import { OwnerOperations } from "../api/identity/owner-operations";
import { Identity } from "../api/identity/service";
import { Database, initialize } from "../api/infrastructure/database";
import { RateLimit } from "../api/infrastructure/rate-limit";
import { localTls } from "./local-tls";

const evidence = process.env.CHURCH_EVIDENCE_DIR ?? "output/p2.5";
// Only executed in the disposable browser container; CA trust is private to its Firefox profile.
if (process.platform !== "linux" || !process.env.CHURCH_BROWSER_CONTAINER)
  throw new Error("Use the isolated browser container");
const conf: Config = {
  cert: "/tmp/church-cert.pem",
  key: "/tmp/church-key.pem",
  origin: "https://localhost:3457",
  port: 3457,
  mongoUrl: "mongodb://host.docker.internal:27119/?replicaSet=church-local&directConnection=true",
  redisUrl: "redis://host.docker.internal:6391",
  database: `church_cms_test_browser_p25_${crypto.randomUUID().replaceAll("-", "")}`,
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
try {
  await db.client.connect();
  await initialize(db.db);
  await rate.connect();
  const identity = new Identity(db, rate, conf);
  await identity.initialize();
  const app = createApp(identity, conf, { log: () => {} });
  server = Bun.serve({
    hostname: "127.0.0.1",
    port: 3457,
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
      await api("owner/churches", { name: "Hội Thánh P2.5 — synthetic", province: "Đà Nẵng" })
    ).payload.data.church,
    base = `owner/churches/${church.id}`,
    xp = `${base}/data-exchange`;
  assert(
    (
      await api(`${base}/organization/settings`, {
        unitType: "area",
        defaultAssignmentMode: "auto",
      })
    ).status === 201,
    "configure-synthetic-church",
  );
  await page.goto(`${conf.origin}/owner/churches/${church.id}/members`);
  await page.getByRole("button", { name: "Nhập dữ liệu", exact: true }).waitFor();
  await page.getByRole("button", { name: "Nhập dữ liệu", exact: true }).click();
  await page.getByRole("heading", { name: "Nhập dữ liệu thuộc viên", exact: true }).waitFor();
  await capture("w02-import-empty");
  const makeRows = (count: number) =>
    Array.from({ length: count }, (_, i) => {
      const row: Record<string, string> = {
        externalId: `UI-${i}`,
        fullName: `Nguyễn synthetic ${i}`,
        gender: "unknown",
        birthDate: "2000-01-02",
        phone: `0900000${String(i).padStart(3, "0")}`,
        type: "believer",
        membership: "member",
        familyKey: `UI-HO-${i}`,
        householdRole: "head",
        assignmentMode: "auto",
        baptismStatus: "unknown",
        consent: "true",
      };
      return importFields.map((f) => row[f] ?? "");
    });
  await page.getByLabel("Nguồn dữ liệu", { exact: true }).fill("Synthetic UI");
  const csv = await makeFile(importFields, makeRows(2), "csv");
  await page
    .getByLabel("File CSV/XLSX", { exact: true })
    .setInputFiles({ name: "synthetic.csv", mimeType: "text/csv", buffer: csv.bytes });
  await page.getByRole("button", { name: "Kiểm tra file", exact: true }).click();
  await page.getByRole("heading", { name: "Nguồn: Synthetic UI", exact: true }).waitFor();
  await page.getByText(/Mới 2 · Liên kết 0/).waitFor();
  assert(
    (await db.db.collection("members").countDocuments({ churchId: new ObjectId(church.id) })) === 0,
    "preview-no-member-writes",
  );
  await capture("w02-import-review");
  await page.getByText("Đối chiếu cột", { exact: true }).click();
  await page.getByLabel("Họ tên", { exact: true }).selectOption("fullName");
  await capture("w02-import-mapping");
  await page.getByRole("button", { name: "Lưu ánh xạ và kiểm tra", exact: true }).click();
  await page
    .getByRole("button", { name: "Lưu ánh xạ và kiểm tra", exact: true })
    .waitFor({ state: "visible" });
  await page.waitForFunction(
    () =>
      !Array.from(document.querySelectorAll("button")).find(
        (b) => b.textContent === "Xem trước phần chưa ghi",
      )?.disabled,
  );
  await page.getByText("Đối chiếu cột", { exact: true }).click();
  await page.getByRole("button", { name: "Xem trước phần chưa ghi", exact: true }).click();
  await page.getByRole("button", { name: "Xác nhận nhập phần còn lại", exact: true }).waitFor();
  assert(
    await page
      .getByRole("button", { name: "Xác nhận nhập phần còn lại", exact: true })
      .isDisabled(),
    "explicit-source-consent-required",
  );
  await capture("w02-import-confirm");
  await page.getByLabel("Xác nhận nguồn và căn cứ đồng ý xử lý dữ liệu", { exact: true }).check();
  let drop = true;
  await page.route(`**/api/v1/${xp}/imports/*/batches`, async (route) => {
    if (drop) {
      drop = false;
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
      assert(status === 200, "loss-injected-only-after-successful-batch");
      await route.abort("failed");
    } else await route.continue();
  });
  await page.getByRole("button", { name: "Xác nhận nhập phần còn lại", exact: true }).click();
  await page.getByRole("button", { name: "Kiểm tra kết quả nhập/xuất", exact: true }).waitFor();
  await page.waitForFunction(
    () =>
      !Array.from(document.querySelectorAll("button")).find(
        (b) => b.textContent === "Kiểm tra kết quả nhập/xuất",
      )?.disabled,
  );
  assert(
    (await db.db.collection("members").countDocuments({ churchId: new ObjectId(church.id) })) === 2,
    "lost-response-after-real-commit",
  );
  await capture("w02-import-unknown-outcome");
  await db.sessions.updateMany(
    { realm: "owner", revokedAt: { $exists: false } },
    { $set: { lastActivityAt: new Date(Date.now() - 16 * 60_000) } },
  );
  await page.getByRole("button", { name: "Kiểm tra kết quả nhập/xuất", exact: true }).click();
  await page.getByRole("heading", { name: "Xác thực lại", exact: true }).waitFor();
  await page.getByLabel("Mật khẩu", { exact: true }).fill(ownerPassword);
  await page.getByRole("button", { name: "Tiếp tục", exact: true }).click();
  await page.getByRole("button", { name: "Kiểm tra kết quả nhập/xuất", exact: true }).waitFor();
  assert(
    (await db.db.collection("members").countDocuments({ churchId: new ObjectId(church.id) })) === 2,
    "reauth-does-not-auto-replay-import",
  );
  await page.getByRole("button", { name: "Kiểm tra kết quả nhập/xuất", exact: true }).click();
  await page.getByText("Đã đối soát 2/2 dòng", { exact: false }).waitFor();
  await page.getByText("Đã tạo", { exact: true }).first().waitFor();
  assert(
    (await db.db.collection("members").countDocuments({ churchId: new ObjectId(church.id) })) === 2,
    "same-intent-retry-no-duplicate",
  );
  await page.unroute(`**/api/v1/${xp}/imports/*/batches`);
  await capture("w02-import-completed");
  const reconEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: "Tải đối soát XLSX", exact: true }).click();
  const recon = await reconEvent;
  const reconPath = await recon.path();
  assert(!!reconPath, "protected-reconciliation-download");
  const reconBook = new ExcelJS.Workbook();
  await reconBook.xlsx.readFile(reconPath);
  assert(reconBook.worksheets[0]?.rowCount === 3, "reconciliation-has-header-and-two-rows");
  await page.reload();
  await page.getByRole("button", { name: "Nhập dữ liệu", exact: true }).click();
  await page.getByText("Phiên nhập của tôi trong 24 giờ", { exact: true }).click();
  await page.getByRole("button", { name: "Mở phiên", exact: true }).first().click();
  await page.getByText("Đã đối soát 2/2 dòng", { exact: false }).waitFor();
  assert(true, "reload-resume-session-owned-by-actor");
  await page.getByRole("button", { name: "Xuất dữ liệu", exact: true }).click();
  await page.getByLabel("Điện thoại", { exact: true }).check();
  await page.getByRole("button", { name: "Xem trước xuất", exact: true }).click();
  await page.getByText(/2 hồ sơ · 9 cột/).waitFor();
  await capture("w02-export-preview");
  await page.getByRole("button", { name: "Tạo file", exact: true }).click();
  await page.getByRole("button", { name: "Tải XLSX", exact: true }).waitFor();
  const exportEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: "Tải XLSX", exact: true }).click();
  const exportFile = await exportEvent,
    exportPath = await exportFile.path();
  assert(!!exportPath, "scoped-export-download");
  const exported = new ExcelJS.Workbook();
  await exported.xlsx.readFile(exportPath);
  assert(exported.worksheets[0]?.rowCount === 3, "export-all-filtered-not-loaded-page");
  const phoneColumn = exported.worksheets[0]?.getRow(1).values as string[];
  const pi = phoneColumn.indexOf("phone");
  assert(
    exported.worksheets[0]?.getCell(2, pi).value?.toString().startsWith("0900000"),
    "export-phone-leading-zero-text",
  );
  await capture("w02-export-ready");
  await page.getByLabel("Định dạng xuất", { exact: true }).selectOption("csv");
  await page.getByRole("button", { name: "Xem trước xuất", exact: true }).click();
  await page.getByRole("button", { name: "Tạo file", exact: true }).click();
  await page.getByRole("button", { name: "Tải CSV", exact: true }).waitFor();
  const csvEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: "Tải CSV", exact: true }).click();
  const downloadedCsv = await csvEvent;
  assert(!!(await downloadedCsv.path()), "csv-export-download");
  await page.getByRole("button", { name: "Nhập dữ liệu", exact: true }).click();
  await page.getByLabel("Nguồn dữ liệu", { exact: true }).fill("Synthetic XLSX");
  const book = new ExcelJS.Workbook();
  for (const name of ["Sheet A", "Sheet B"]) {
    const sheet = book.addWorksheet(name);
    sheet.addRow(Array.from(importFields));
    const row = makeRows(1)[0] as string[];
    row[0] = `XLSX-${name}`;
    row[importFields.indexOf("fullName")] = `Trần ${name} synthetic`;
    row[importFields.indexOf("phone")] = "";
    sheet.addRow(row);
  }
  await page.getByLabel("File CSV/XLSX", { exact: true }).setInputFiles({
    name: "synthetic.xlsx",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: Buffer.from(await book.xlsx.writeBuffer()),
  });
  await page.getByRole("button", { name: "Kiểm tra file", exact: true }).click();
  await page.getByRole("heading", { name: "Nguồn: Synthetic XLSX", exact: true }).waitFor();
  await page.getByLabel("Sheet dữ liệu", { exact: true }).selectOption("Sheet B");
  await page.getByText("Trần Sheet B synthetic", { exact: true }).waitFor();
  assert(
    (await page.getByText("Trần Sheet A synthetic", { exact: true }).count()) === 0,
    "explicit-xlsx-selected-sheet-only",
  );
  await capture("w02-xlsx-review");
  await page.getByRole("button", { name: "Đối chiếu dòng 2", exact: true }).click();
  await page.getByRole("heading", { name: "Đối chiếu dòng 2", exact: true }).waitFor();
  await page.getByLabel("Quyết định", { exact: true }).selectOption("skip");
  await page.getByLabel("Lý do đối chiếu", { exact: true }).fill("Bỏ qua dòng synthetic");
  await capture("w02-import-decision");
  await page.getByRole("button", { name: "Lưu quyết định", exact: true }).click();
  await page.getByText(/Bỏ qua 1 · Cần đối chiếu 0/).waitFor();
  assert(true, "row-decision-wired-through-api");
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
    JSON.stringify({ error: safe, errors, checks: result, spacing: spacingEvidence }, null, 2),
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
