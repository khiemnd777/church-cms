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
import { assertComposition } from "./browser-composition";
import { localTls } from "./local-tls";
import { SyntheticClient, syntheticUser } from "./p2-fixtures";
import { careCreate, careSave, p43Fixture } from "./p43-fixtures";

const evidence = process.env.CHURCH_EVIDENCE_DIR ?? "output/p4.3";
// Only executed in the disposable browser container; CA trust is private to its Firefox profile.
if (process.platform !== "linux" || !process.env.CHURCH_BROWSER_CONTAINER)
  throw new Error("Use the isolated browser container");
const conf: Config = {
  cert: "/tmp/church-cert.pem",
  key: "/tmp/church-key.pem",
  origin: "https://localhost:3481",
  port: 3481,
  mongoUrl: "mongodb://host.docker.internal:27119/?replicaSet=church-local&directConnection=true",
  redisUrl: "redis://host.docker.internal:6391",
  database: `church_cms_test_browser_p43_${crypto.randomUUID().replaceAll("-", "")}`,
  csrfKey: crypto.randomUUID() + crypto.randomUUID(),
};
const tls = await localTls("/tmp/church-tls");
conf.cert = tls.cert;
conf.key = tls.key;
const db = new Database(conf),
  rate = new RateLimit(conf.redisUrl, conf.csrfKey);
let server: ReturnType<typeof Bun.serve> | undefined;
let loseCaseAcknowledgement: string | null = null,
  lostCommittedEntry = false;
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
context.setDefaultTimeout(15000);
context.setDefaultNavigationTimeout(15000);
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
async function capture(name: string, subject = page) {
  for (const theme of ["light", "dark"] as const) {
    await subject.emulateMedia({ colorScheme: theme });
    for (const width of [1440, 901, 900, 560, 390]) {
      await subject.setViewportSize({ width, height: 1000 });
      await assertComposition(subject, `${name}-${theme}-${width}`, assert, evidence);
      await subject.evaluate(async () => {
        await document.fonts.ready;
        window.scrollTo(0, 0);
      });
      const layout = await subject.evaluate(() => {
        const tabs = document.querySelector<HTMLElement>('[role="tablist"]');
        let reachable = true;
        if (tabs) {
          const old = tabs.scrollLeft;
          tabs.scrollLeft = tabs.scrollWidth;
          reachable =
            (tabs.lastElementChild?.getBoundingClientRect().right ?? 0) <=
            tabs.getBoundingClientRect().right + 1;
          tabs.scrollLeft = old;
        }
        const frames = Array.from(document.querySelectorAll<HTMLElement>(".tbl-wrap"));
        const controls = Array.from(
          document.querySelectorAll<HTMLElement>(
            'dialog[open] input:not([type="checkbox"]),dialog[open] select,main .toolbar input:not([type="checkbox"]),main .toolbar select,main .care-section input:not([type="checkbox"]),main .care-section select,main .care-section textarea',
          ),
        ).filter((e) => e.getClientRects().length > 0);
        const section = document.querySelector("main .care-section .care-section");
        const children = section ? Array.from(section.children) : [];
        const gaps = children.slice(1).flatMap((e, i) => {
          const before = children[i];
          return before?.classList.contains("toolbar") &&
            e.getClientRects().length &&
            before.getClientRects().length
            ? [e.getBoundingClientRect().top - before.getBoundingClientRect().bottom]
            : [];
        });
        return {
          width: innerWidth,
          overflow: document.documentElement.scrollWidth > innerWidth + 1,
          tabsReachable: reachable,
          framesInside: frames.every(
            (e) =>
              e.getBoundingClientRect().right <= innerWidth + 1 &&
              e.getBoundingClientRect().left >= -1,
          ),
          fieldsInside: controls.every(
            (e) =>
              e.getBoundingClientRect().right <= innerWidth + 1 &&
              e.getBoundingClientRect().left >= -1,
          ),
          scrollReachable: frames.every((frame) => {
            const old = frame.scrollLeft;
            frame.scrollLeft = frame.scrollWidth;
            const last = frame.querySelector("thead tr")?.lastElementChild;
            const reachable =
              !last ||
              last.getBoundingClientRect().right <= frame.getBoundingClientRect().right + 1;
            frame.scrollLeft = old;
            return reachable && frame.tabIndex === 0;
          }),
          heights: controls.map((e) => e.getBoundingClientRect().height),
          gaps,
        };
      });
      spacingEvidence.push({ name, theme, ...layout });
      assert(!layout.overflow, `${name}-${theme}-${width}-no-page-overflow`);
      assert(layout.tabsReachable, `${name}-${theme}-${width}-tabs-reachable`);
      assert(layout.framesInside, `${name}-${theme}-${width}-table-scroll-contained`);
      assert(layout.fieldsInside, `${name}-${theme}-${width}-fields-inside`);
      assert(
        layout.scrollReachable,
        `${name}-${theme}-${width}-last-column-keyboard-scroll-reachable`,
      );
      assert(
        layout.heights.every((h) => h >= 35.5),
        `${name}-${theme}-${width}-field-heights`,
      );
      assert(
        layout.gaps.every((g) => g >= 17.5),
        `${name}-${theme}-${width}-toolbar-spacing`,
      );
      if (width === 390 && !(await subject.locator("dialog[open]").count())) {
        const region = subject.getByRole("region", { name: "Danh sách thăm viếng", exact: true });
        await region.evaluate((e) => {
          e.scrollLeft = 0;
        });
        await region.focus();
        for (let i = 0; i < 20; i++) await subject.keyboard.press("ArrowRight");
        await subject.waitForFunction(() => {
          const e = document.querySelector<HTMLElement>(
            '.tbl-wrap[aria-label="Danh sách thăm viếng"]',
          );
          return !!e && e.scrollLeft > 0;
        });
        assert(
          await region.evaluate((e) => document.activeElement === e && e.scrollLeft > 0),
          `${name}-${theme}-390-real-keyboard-horizontal-scroll`,
        );
        await region.evaluate((e) => {
          e.scrollLeft = 0;
        });
      }
      if (width === 1440 || width === 390)
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
  const logs: object[] = [];
  const app = createApp(identity, conf, { log: (r) => logs.push(r) });
  const sourceName = (await readdir("reference")).find(
    (n) => n.normalize("NFC") === "Quản lý Hội Thánh Tin Lành(1).html",
  );
  assert(sourceName, "approved-source-present");
  const reference = await readFile(`reference/${sourceName}`, "utf8");
  assert(
    new Bun.CryptoHasher("sha256").update(reference).digest("hex") ===
      "4bdc4ebdb3bcc7ccb98e675162ef9f14568c46bf9b1ad2d38c9a979cda2dc8b6",
    "source-hash-unchanged",
  );
  const css = (await readdir("dist/assets")).find((n) => n.endsWith(".css")),
    compiled = await readFile(`dist/assets/${css}`, "utf8"),
    fonts = Array.from(compiled.matchAll(/@font-face\{[^}]+\}/g), (m) => m[0]).join("\n"),
    sourceHtml = reference
      .replace(/<link[^>]*https:[^>]*>/g, "")
      .replace(/<script src="https:[^"]*"><\/script>/g, "")
      .replace("<style>", `<style>${fonts}</style><style>`);
  server = Bun.serve({
    hostname: "127.0.0.1",
    port: conf.port,
    tls: { cert: Bun.file(conf.cert), key: Bun.file(conf.key) },
    fetch: async (req) => {
      const pathname = new URL(req.url).pathname;
      if (pathname === "/__p43_source")
        return new Response(sourceHtml, {
          headers: { "content-type": "text/html; charset=utf-8" },
        });
      const response = await app(req, {
        ip: req.headers.get("x-synthetic-client") ?? "browser-p43",
      });
      // Only the disposable test server replaces the acknowledgement AFTER a real successful commit.
      // Browser TLS/cookies/CSRF go through the normal request path without a second HTTP client.
      if (
        loseCaseAcknowledgement &&
        req.method === "PATCH" &&
        pathname.endsWith(`/care/cases/${loseCaseAcknowledgement}`)
      ) {
        loseCaseAcknowledgement = null;
        if (response.status !== 200) return response;
        const result = await response.json();
        lostCommittedEntry = true;
        return Response.json(
          {
            error: { code: "OUTCOME_UNKNOWN", message: "Mất phản hồi synthetic" },
            meta: { operationId: result.data.operationId },
          },
          { status: 503, headers: response.headers },
        );
      }
      return response;
    },
  });
  await mkdir(evidence, { recursive: true });
  const fixture = await new OwnerOperations(db).create({
      email: `rite-${crypto.randomUUID()}@example.test`,
      displayName: "Owner synthetic P4.3",
    }),
    password = `Owner 🌿 ${crypto.randomUUID()}`;
  secrets.push(password, fixture.temporaryPassword);
  await page.goto(`${conf.origin}/owner/login`);
  await page.getByLabel("Email", { exact: true }).fill(fixture.email);
  await page.getByLabel("Mật khẩu", { exact: true }).fill(fixture.temporaryPassword);
  await page.getByRole("button", { name: "Đăng nhập", exact: true }).click();
  await page.getByLabel("Mật khẩu mới", { exact: true }).fill(password);
  await page.getByLabel("Nhập lại mật khẩu", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Lưu mật khẩu", exact: true }).click();
  await page.getByRole("heading", { name: "Đăng nhập", exact: true }).waitFor();
  await page.getByLabel("Mật khẩu", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Đăng nhập", exact: true }).click();
  await page.getByRole("button", { name: "Thêm Hội Thánh", exact: true }).waitFor();
  const ca = await Bun.file(tls.ca).text();
  const transport = (req: Request) => {
    const h = new Headers(req.headers);
    h.set("x-synthetic-client", crypto.randomUUID());
    return fetch(new Request(req, { headers: h }), { tls: { ca } });
  };
  const ownerClient = new SyntheticClient("owner", conf.origin, transport);
  assert((await ownerClient.login(fixture.email, password)).status === 200, "owner-fixture-login");
  const church = await p43Fixture(db, ownerClient, fixture.employeeId, 70),
    target = `${conf.origin}/owner/churches/${church.id}/care`;
  await page.goto(target);
  await page.getByRole("button", { name: "+ Tạo hồ sơ", exact: true }).click();
  await page.getByLabel("Đối tượng thăm viếng", { exact: true }).selectOption(church.target.id);
  await page.getByLabel("Nhóm lý do", { exact: true }).selectOption("illness");
  await page
    .getByLabel("Mô tả thăm viếng", { exact: true })
    .fill("Chăm sóc synthetic <script>không thực thi</script>");
  await page.getByLabel("Ưu tiên", { exact: true }).selectOption("high");
  await page.getByLabel("Ngày dự kiến", { exact: true }).fill(shiftDay(businessDay(), -1));
  const far = church.people.at(-1);
  assert(far, "source people fixture");
  await page.getByLabel("Người phụ trách · tìm tên hoặc mã", { exact: true }).fill(far.fullName);
  await page.getByLabel("Người phụ trách", { exact: true }).selectOption(far._id.toHexString());
  assert(
    await page.getByText(`${far.fullName} · ${far.code}`, { exact: true }).isVisible(),
    "full-name-picker-beyond-first25",
  );
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press(i % 2 ? "Shift+Tab" : "Tab");
    assert(
      await page.evaluate(() => !!document.activeElement?.closest("dialog[open]")),
      `care-modal-focus-contained-${i}`,
    );
  }
  await capture("owner-care-create");
  await page.getByRole("button", { name: "Xem trước", exact: true }).click();
  await page.getByRole("heading", { name: "Xác nhận thay đổi thăm viếng", exact: true }).waitFor();
  await page.getByRole("button", { name: "Quay lại sửa", exact: true }).click();
  assert(
    (await page.getByLabel("Mô tả thăm viếng", { exact: true }).inputValue()).includes("<script>"),
    "preview-back-preserves-form-input",
  );
  await page.getByRole("button", { name: "Xem trước", exact: true }).click();
  await capture("owner-care-preview");
  await page.getByRole("button", { name: "Xác nhận lưu thăm viếng", exact: true }).click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  await page.getByRole("button", { name: "Đã thăm", exact: true }).waitFor();
  const caseId = new URL(page.url()).searchParams.get("caseId") as string;
  const row = await db.db.collection("visitation_cases").findOne({ _id: new ObjectId(caseId) });
  assert(row, "created case");
  assert(
    row.state === "open" && row.assigneeId.toHexString() === far._id.toHexString(),
    "UI-persists-real-assignment-and-open-state",
  );
  await capture("owner-care-detail");
  const source = await context.newPage();
  await source.goto(`${conf.origin}/__p43_source`);
  await source.locator('.nav-a[data-go="worship"]').click();
  const parity: unknown[] = [];
  for (const theme of ["light", "dark"] as const)
    for (const width of [1440, 390]) {
      const values = [];
      for (const targetPage of [page, source]) {
        await targetPage.emulateMedia({ colorScheme: theme });
        await targetPage.setViewportSize({ width, height: 1000 });
        await targetPage.evaluate(async () => {
          (document.activeElement as HTMLElement)?.blur();
          await document.fonts.ready;
        });
        values.push(
          await targetPage.evaluate(() =>
            ["table th"].map((sel) => {
              const e = document.querySelector(sel);
              if (!e) return null;
              const c = getComputedStyle(e);
              return {
                color: c.color,
                background: c.backgroundColor,
                font: c.fontFamily,
                size: c.fontSize,
                weight: c.fontWeight,
                padding: c.padding,
                border: c.borderRadius,
              };
            }),
          ),
        );
      }
      assert(
        JSON.stringify(values[0]) === JSON.stringify(values[1]),
        `W07-source-parity-${theme}-${width}`,
      );
      parity.push({ theme, width, actual: values[0], reference: values[1] });
    }
  await source.close();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.emulateMedia({ colorScheme: "light" });

  await page.getByRole("button", { name: "Đã thăm", exact: true }).click();
  await page.getByLabel("Kết quả lần thăm", { exact: true }).selectOption("not_met");
  await page.getByLabel("Ghi chú lần thăm", { exact: true }).fill("Không gặp synthetic");
  await page.getByRole("button", { name: "Xem trước", exact: true }).click();
  await page.getByRole("button", { name: "Xác nhận lưu thăm viếng", exact: true }).click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  await page.getByRole("button", { name: "Đã thăm", exact: true }).waitFor();
  assert(
    await page.getByRole("button", { name: "Hoàn tất", exact: true }).isDisabled(),
    "not-met-does-not-enable-completion",
  );
  await page.getByRole("button", { name: "Đã thăm", exact: true }).click();
  await page
    .getByLabel("Ghi chú lần thăm", { exact: true })
    .fill("Đã gặp synthetic, cần tiếp tục chăm sóc");
  await page.getByRole("button", { name: "Xem trước", exact: true }).click();
  loseCaseAcknowledgement = caseId;
  await page.getByRole("button", { name: "Xác nhận lưu thăm viếng", exact: true }).click();
  const reconcile = page
    .getByRole("dialog")
    .getByRole("button", { name: "Đối soát thăm viếng / thử lại cùng yêu cầu", exact: true });
  await reconcile.waitFor();
  await page.waitForFunction(() =>
    Array.from(document.querySelectorAll<HTMLButtonElement>("dialog[open] button")).some(
      (b) => b.textContent?.includes("Đối soát thăm viếng / thử lại cùng yêu cầu") && !b.disabled,
    ),
  );
  assert(lostCommittedEntry, "real-entry-committed-before-lost-response");
  await page.waitForLoadState("networkidle");
  await db.sessions.updateMany(
    { principalId: new ObjectId(fixture.employeeId) },
    { $set: { lastActivityAt: new Date(Date.now() - 16 * 60000) } },
  );
  try {
    await reconcile.click({ timeout: 2000 });
  } catch (e) {
    if (!(await page.getByLabel("Mật khẩu", { exact: true }).isVisible())) throw e;
  }
  await page.getByLabel("Mật khẩu", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Tiếp tục", exact: true }).click();
  await page
    .getByRole("button", { name: "Đối soát thăm viếng / thử lại cùng yêu cầu", exact: true })
    .first()
    .click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  await page.getByRole("button", { name: "Hoàn tất", exact: true }).waitFor();
  assert(
    new URL(page.url()).searchParams.get("caseId") === caseId,
    "pending-reauth-preserves-case-deep-link",
  );
  assert(
    (await db.db
      .collection("visitation_entries")
      .countDocuments({ caseId: new ObjectId(caseId) })) === 2,
    "lost-response-receipt-no-duplicate-entry",
  );
  await page.getByRole("button", { name: "Hoàn tất", exact: true }).click();
  await page.getByRole("button", { name: "Xem trước", exact: true }).click();
  assert(
    await page.getByRole("button", { name: "Xác nhận lưu thăm viếng", exact: true }).isDisabled(),
    "complete-needs-explicit-confirmation",
  );
  await page.getByLabel("Tôi xác nhận hoàn tất hồ sơ", { exact: true }).check();
  await page.getByRole("button", { name: "Xác nhận lưu thăm viếng", exact: true }).click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  await page.getByRole("heading", { name: `Hồ sơ ${row.code}`, exact: true }).waitFor();
  assert(
    (await page.getByRole("button", { name: "Đã thăm", exact: true }).count()) === 0,
    "completed-case-has-no-new-entry-control",
  );
  await page
    .locator("summary")
    .filter({ hasText: /Đã gặp/ })
    .first()
    .click();
  await page.getByRole("button", { name: "Đính chính lần thăm", exact: true }).click();
  await page.getByLabel("Ghi chú lần thăm", { exact: true }).fill("Ghi chú đính chính synthetic");
  await page
    .getByLabel("Lý do thao tác / đính chính", { exact: true })
    .fill("Sửa ghi chú sau đóng");
  await page.getByRole("button", { name: "Xem trước", exact: true }).click();
  await page.getByRole("button", { name: "Xác nhận lưu thăm viếng", exact: true }).click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  await page.getByRole("button", { name: "Lịch sử thăm viếng", exact: true }).click();
  await page.getByRole("heading", { name: "Lịch sử thăm viếng", exact: true }).waitFor();
  assert(
    (await page
      .locator("summary")
      .filter({ hasText: /Sửa ghi chú sau đóng/ })
      .count()) === 1,
    "closed-entry-correction-has-history",
  );
  await capture("owner-care-history");
  await page.reload();
  await page.getByRole("heading", { name: `Hồ sơ ${row.code}`, exact: true }).waitFor();
  assert(new URL(page.url()).searchParams.get("caseId") === caseId, "reload-retains-selected-case");
  await page.getByRole("button", { name: "+ Tạo hồ sơ", exact: true }).click();
  await page.getByLabel("Loại đối tượng", { exact: true }).selectOption("family");
  await page
    .getByLabel("Đối tượng thăm viếng", { exact: true })
    .selectOption(church.families[0]?._id.toHexString() as string);
  await page.getByLabel("Mô tả thăm viếng", { exact: true }).fill("Thăm gia đình synthetic");
  await page.getByLabel("Nhóm lý do", { exact: true }).selectOption("bereavement");
  await page.getByRole("button", { name: "Xem trước", exact: true }).click();
  await page.getByRole("button", { name: "Xác nhận lưu thăm viếng", exact: true }).click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  await page.getByRole("button", { name: "Hủy hồ sơ", exact: true }).waitFor();
  await page.getByRole("button", { name: "Hủy hồ sơ", exact: true }).click();
  await page
    .getByLabel("Lý do thao tác / đính chính", { exact: true })
    .fill("Gia đình yêu cầu hủy synthetic");
  await page.getByRole("button", { name: "Xem trước", exact: true }).click();
  await page.getByLabel("Tôi xác nhận hủy hồ sơ", { exact: true }).check();
  await page.getByRole("button", { name: "Xác nhận lưu thăm viếng", exact: true }).click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  assert(
    (await db.db.collection("visitation_cases").countDocuments({
      churchId: new ObjectId(church.id),
      targetKind: "family",
      state: "cancelled",
    })) === 1,
    "family-case-cancel-persists-with-reason",
  );
  ownerClient.jar.clear();
  ownerClient.csrf = "";
  assert(
    (await ownerClient.login(fixture.email, password)).status === 200,
    "fresh-owner-fixture-session",
  );
  const secClient = new SyntheticClient("church", conf.origin, transport),
    sec = await syntheticUser(ownerClient, secClient, church, "secretary");
  secrets.push(sec.password);
  const userPage = await context.newPage();
  userPage.on("pageerror", (e) => errors.push(e.message));
  await userPage.goto(`${conf.origin}/h/${church.code}/login`);
  await userPage.getByLabel("Email", { exact: true }).fill(sec.email);
  await userPage.getByLabel("Mật khẩu", { exact: true }).fill(sec.password);
  await userPage.getByRole("button", { name: "Đăng nhập", exact: true }).click();
  await userPage.getByRole("button", { name: "Chăm sóc & Cầu thay", exact: true }).click();
  await userPage.getByRole("heading", { name: "Danh sách thăm viếng", exact: true }).waitFor();
  const fresh = await careSave(
    ownerClient,
    church,
    careCreate(
      { kind: "member", id: church.people[1]?._id.toHexString() as string },
      {
        description: "Hồ sơ nguồn thay đổi synthetic",
        assigneeId: church.people[2]?._id.toHexString() as string,
      },
    ),
  );
  assert(fresh.status === 201, "source-change-fixture-public-create");
  await userPage.goto(
    `${conf.origin}/h/${church.code}/care?caseId=${fresh.payload.data.caseId}&assigneeId=${church.people[2]?._id.toHexString()}`,
  );
  await userPage.getByRole("button", { name: "Đã thăm", exact: true }).waitFor();
  await userPage.getByRole("button", { name: "Bỏ lọc người phụ trách", exact: true }).waitFor();
  assert(
    new URL(userPage.url()).searchParams.has("assigneeId"),
    "deep-link-assignee-filter-is-visible",
  );
  await userPage.getByRole("button", { name: "Bỏ lọc người phụ trách", exact: true }).click();
  await userPage.waitForFunction(() => !new URL(location.href).searchParams.has("assigneeId"));
  assert(true, "clear-deep-link-assignee-filter-restores-list");
  await capture("secretary-care-detail", userPage);
  await db.db
    .collection("members")
    .updateOne(
      { _id: church.people[2]?._id },
      { $set: { participation: "transferred" }, $inc: { version: 1 } },
    );
  await userPage.getByRole("button", { name: "Làm mới", exact: true }).click();
  await userPage
    .getByText(
      "Nguồn đối tượng hoặc người phụ trách không còn hợp lệ. Kiểm tra phân công trước khi ghi lần thăm mới; hồ sơ và lịch sử vẫn được giữ.",
      { exact: true },
    )
    .waitFor();
  assert(
    await userPage.getByRole("button", { name: "Đã thăm", exact: true }).isDisabled(),
    "invalid-assignee-warning-blocks-new-entry",
  );
  await userPage.getByRole("button", { name: "Sửa phân công / thông tin", exact: true }).click();
  await userPage
    .getByRole("button", { name: `Bỏ Người phụ trách: ${church.people[2]?.fullName}`, exact: true })
    .click();
  await userPage.getByRole("button", { name: "Xem trước", exact: true }).click();
  await userPage.getByRole("button", { name: "Xác nhận lưu thăm viếng", exact: true }).click();
  await userPage.getByRole("dialog").waitFor({ state: "hidden" });
  assert(
    await userPage.getByRole("button", { name: "Đã thăm", exact: true }).isEnabled(),
    "explicit-unassign-restores-entry-workflow",
  );
  await userPage.goto(`${conf.origin}/h/${church.code}/overview`);
  await userPage.getByRole("button", { name: "Thăm viếng", exact: true }).click();
  await userPage.getByRole("heading", { name: "Danh sách thăm viếng", exact: true }).waitFor();
  assert(new URL(userPage.url()).pathname.endsWith("/care"), "W01-shortcut-opens-real-W08");
  await userPage.close();
  assert(errors.length === 0, "no-browser-script-errors");
  assert(
    !logs.some(
      (r) =>
        JSON.stringify(r).includes("Ghi chú đính chính") ||
        JSON.stringify(r).includes("Chăm sóc synthetic"),
    ),
    "transport-logs-contain-no-care-narrative",
  );
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
          "Local/synthetic/private CA",
          "Physical/Safari/UAT/production NOT_RUN",
          "Prayer/automation/print remain outside P4.3",
        ],
      },
      null,
      2,
    ),
  );
  console.info(JSON.stringify({ status: "PASS", checks: result.length }));
} catch (error) {
  const safe = secrets
    .reduce((s, v) => s.replaceAll(v, "[REDACTED]"), String(error))
    .replace(/(__Host-qlht_[a-z_]+=)[^;\s\n]+/g, "$1[REDACTED]");
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
