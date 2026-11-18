import { mkdir, readdir, readFile } from "node:fs/promises";
import { chromium, firefox } from "@playwright/test";
import { ObjectId } from "mongodb";
import { createApp } from "../api/app";
import type { Config } from "../api/config";
import { OwnerOperations } from "../api/identity/owner-operations";
import { Identity } from "../api/identity/service";
import { Database, initialize } from "../api/infrastructure/database";
import { RateLimit } from "../api/infrastructure/rate-limit";
import { assertComposition } from "./browser-composition";
import { localTls } from "./local-tls";
import { SyntheticClient, syntheticUser } from "./p2-fixtures";
import { p42Fixture, p42Save, p42Schedule, programCommand } from "./p42-fixtures";

const evidence = process.env.CHURCH_EVIDENCE_DIR ?? "output/p4.2";
// Only executed in the disposable browser container; CA trust is private to its Firefox profile.
if (process.platform !== "linux" || !process.env.CHURCH_BROWSER_CONTAINER)
  throw new Error("Use the isolated browser container");
const conf: Config = {
  cert: "/tmp/church-cert.pem",
  key: "/tmp/church-key.pem",
  origin: "https://localhost:3477",
  port: 3477,
  mongoUrl: "mongodb://host.docker.internal:27119/?replicaSet=church-local&directConnection=true",
  redisUrl: "redis://host.docker.internal:6391",
  database: `church_cms_test_browser_p42_${crypto.randomUUID().replaceAll("-", "")}`,
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
            'dialog[open] input:not([type="checkbox"]),dialog[open] select,main .toolbar input,main .toolbar select,main .program-section input,main .program-section select,main .program-section textarea',
          ),
        ).filter((e) => e.getClientRects().length > 0);
        const section = document.querySelector('.schedule-section [role="tabpanel"]');
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
    fetch: (req) =>
      new URL(req.url).pathname === "/__p42_source"
        ? new Response(sourceHtml, { headers: { "content-type": "text/html; charset=utf-8" } })
        : app(req, { ip: req.headers.get("x-synthetic-client") ?? "browser-p42" }),
  });
  await mkdir(evidence, { recursive: true });
  const fixture = await new OwnerOperations(db).create({
      email: `rite-${crypto.randomUUID()}@example.test`,
      displayName: "Owner synthetic P4.2",
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
  const church = await p42Fixture(db, ownerClient, fixture.employeeId, 70);
  const target = `${conf.origin}/owner/churches/${church.id}/worship?programUnit=${church.unit}&programOccurrence=${church.occurrence}`;
  await page.goto(target);
  const createButton = page.getByRole("button", { name: "Tạo nháp chương trình", exact: true });
  await createButton.click();
  await page.getByRole("dialog").waitFor();
  assert(
    await page.getByRole("dialog").getByText("Hướng dẫn chương trình", { exact: true }).isVisible(),
    "preview-seven-template-rows",
  );
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press(i % 2 ? "Shift+Tab" : "Tab");
    assert(
      await page.evaluate(() => !!document.activeElement?.closest("dialog[open]")),
      `preview-focus-contained-${i}`,
    );
  }
  await capture("owner-program-preview");
  await page.getByRole("button", { name: "Xác nhận lưu chương trình", exact: true }).click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  await page.getByLabel("Tiết mục 1 · tên", { exact: true }).waitFor();
  assert(
    (await page.getByLabel("Tiết mục 4 · nội dung", { exact: true }).inputValue()).includes(
      "Giăng 15",
    ),
    "source-content-real-wiring",
  );
  await page.getByLabel("Tiết mục 1 · tên", { exact: true }).fill("Mục thủ công synthetic");
  await page
    .getByLabel("Tiết mục 4 · nội dung", { exact: true })
    .fill("Nội dung riêng <script>synthetic</script>");
  await page.getByLabel("Tiết mục 1 · người phụ trách", { exact: true }).selectOption("unassigned");
  assert(
    await page.getByRole("button", { name: "Sinh lại", exact: true }).isDisabled(),
    "dirty-blocks-regeneration",
  );
  assert(
    await page.getByLabel("Chọn ban", { exact: true }).isDisabled(),
    "dirty-blocks-context-change",
  );
  await page.getByRole("button", { name: "Bỏ tiết mục 5", exact: true }).click();
  await page.getByRole("button", { name: "+ Tiết mục", exact: true }).click();
  await page.getByLabel("Tiết mục 7 · tên", { exact: true }).fill("Tùy chọn synthetic");
  await page.getByRole("button", { name: "Đưa tiết mục 7 lên", exact: true }).click();
  await capture("owner-program-editor");
  async function confirmSave(label: string) {
    await page.getByRole("button", { name: label, exact: true }).click();
    await page.getByRole("dialog").waitFor();
    await page.getByRole("button", { name: "Xác nhận lưu chương trình", exact: true }).click();
    await page.getByRole("dialog").waitFor({ state: "hidden" });
    await page.getByLabel("Tiết mục 1 · tên", { exact: true }).waitFor();
  }
  await confirmSave("Lưu nháp");
  const programId = new URL(page.url()).searchParams.get("programId") as string;
  await p42Schedule(
    ownerClient,
    church,
    {
      ...church.schedule,
      input: { ...church.schedule.input, theme: "Nguồn thay đổi synthetic" },
      reason: "Cập nhật nguồn",
    },
    church.occurrence,
    1,
  );
  await page.getByRole("button", { name: "Làm mới chương trình", exact: true }).click();
  await page
    .getByText("Nguồn lịch/ban đã thay đổi. Đối soát trong preview trước khi chốt.", {
      exact: true,
    })
    .waitFor();
  await confirmSave("Sinh lại");
  assert(
    (await page.getByLabel("Tiết mục 1 · tên", { exact: true }).inputValue()) ===
      "Mục thủ công synthetic",
    "regenerate-preserves-manual-title",
  );
  assert(
    (await page.getByLabel("Tiết mục 4 · nội dung", { exact: true }).inputValue()).includes(
      "Nội dung riêng",
    ),
    "regenerate-preserves-manual-detail",
  );
  assert(
    (await page.getByLabel("Tiết mục 6 · tên", { exact: true }).inputValue()) ===
      "Tùy chọn synthetic",
    "regenerate-preserves-custom-order-deletion",
  );
  const [draftPrint] = await Promise.all([
    page.waitForEvent("popup"),
    page.getByRole("button", { name: "In nháp", exact: true }).click(),
  ]);
  await draftPrint.getByText("BẢN NHÁP", { exact: true }).waitFor();
  await draftPrint.emulateMedia({ media: "print" });
  await draftPrint.screenshot({ path: `${evidence}/draft-print-media.png`, fullPage: true });
  assert(
    await draftPrint.locator(".program-print-controls").isHidden(),
    "print-media-hides-controls",
  );
  assert((await draftPrint.locator("tbody tr").count()) === 7, "print-seven-actual-rows");
  await draftPrint.close();
  await page.getByRole("button", { name: "Xem trước chốt", exact: true }).click();
  await page.getByRole("dialog").waitFor();
  assert(
    await page.getByRole("button", { name: "Chốt phiên bản", exact: true }).isDisabled(),
    "incomplete-blocks-finalize-without-confirm",
  );
  await page.getByLabel(/Tôi xác nhận còn/).check();
  await page.getByRole("button", { name: "Chốt phiên bản", exact: true }).click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  await page.getByRole("button", { name: "In bản chốt r1", exact: true }).waitFor();
  await capture("owner-program-final-r1");
  const source = await context.newPage();
  await source.goto(`${conf.origin}/__p42_source`);
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

  // Chromium uses a CA imported only into this disposable container's NSS database.
  const nss = "/home/pwuser/.pki/nssdb";
  await mkdir(nss, { recursive: true });
  for (const args of [
    ["certutil", "-N", "--empty-password", "-d", `sql:${nss}`],
    ["certutil", "-A", "-d", `sql:${nss}`, "-n", "P42 local CA", "-t", "C,,", "-i", tls.ca],
  ])
    assert(Bun.spawnSync(args).exitCode === 0, "private-chromium-ca");
  const chrome = await chromium.launch({ headless: true });
  const cp = await chrome.newPage();
  await cp.context().addCookies(
    (await context.cookies()).map(
      ({ name, value, domain, path, expires, httpOnly, secure, sameSite }) => ({
        name,
        value,
        domain,
        path,
        expires,
        httpOnly,
        secure,
        sameSite,
      }),
    ),
  );
  await cp.goto(
    `${conf.origin}/api/v1/owner/churches/${church.id}/programs/drafts/${programId}/print?revision=1&version=1`,
  );
  await cp.evaluate(async () => {
    await document.fonts.ready;
  });
  assert(
    await cp.evaluate(() => document.fonts.check('400 14px "Be Vietnam Pro"')),
    "self-hosted-vietnamese-print-font-ready",
  );
  assert(
    await cp.getByText("Bản chốt r1", { exact: true }).isVisible(),
    "chromium-authenticated-final-print",
  );
  await cp.pdf({
    path: `${evidence}/program-final-r1-a4.pdf`,
    format: "A4",
    preferCSSPageSize: true,
    printBackground: true,
  });
  await cp.emulateMedia({ media: "print" });
  await cp.screenshot({ path: `${evidence}/final-print-media.png`, fullPage: true });
  const paper = await p42Fixture(db, ownerClient, fixture.employeeId, 8);
  const pd = await p42Save(
    ownerClient,
    paper,
    programCommand("create", { unitId: paper.unit, occurrenceId: paper.occurrence }),
  );
  const fifty = Array.from({ length: 50 }, (_, i) => ({
    id: crypto.randomUUID(),
    templateKey: null,
    title: `Tiết mục kiểm tra A4 ${i + 1}`,
    detail:
      i === 0 ? "Nội dung tiếng Việt và từ dài synthetic ".repeat(20) : `Dòng kiểm tra ${i + 1}`,
    assignment: { mode: "not_applicable" as const },
  }));
  const saved = await p42Save(
    ownerClient,
    paper,
    programCommand("save", { rows: fifty }),
    pd.payload.data.programId,
    pd.payload.data.version,
  );
  assert(saved.status === 200, "fifty-row-print-fixture-public-save");
  await cp.goto(
    `${conf.origin}/api/v1/owner/churches/${paper.id}/programs/drafts/${pd.payload.data.programId}/print?version=${saved.payload.data.version}`,
  );
  await cp.evaluate(async () => {
    await document.fonts.ready;
  });
  await cp.pdf({
    path: `${evidence}/program-draft-50-a4.pdf`,
    format: "A4",
    preferCSSPageSize: true,
    printBackground: true,
  });
  assert((await cp.locator("tbody tr").count()) === 50, "fifty-row-authenticated-print");
  await chrome.close();
  const savedR1 = await db.db
    .collection("program_editions")
    .findOne({ programId: new ObjectId(programId), revision: 1 });
  await page
    .getByLabel("Lý do chương trình / đính chính", { exact: true })
    .fill("Đính chính synthetic");
  await page.getByRole("button", { name: "Tạo nháp đính chính bản mới nhất", exact: true }).click();
  await page.getByRole("button", { name: "Xác nhận lưu chương trình", exact: true }).click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  await page.getByLabel("Tiết mục 1 · tên", { exact: true }).fill("Bản hai synthetic");
  // Real commit, then drop the browser response and reconcile the identical frozen intent.
  const lostPath = `**/api/v1/owner/churches/${church.id}/programs/drafts/${programId}`;
  await page.route(lostPath, async (route) => {
    if (route.request().method() === "PATCH") {
      const committed = await route.fetch();
      const payload = await committed.json();
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({
          error: { code: "OUTCOME_UNKNOWN", message: "Mất phản hồi synthetic" },
          meta: { operationId: payload.data.operationId },
        }),
      });
    } else await route.continue();
  });
  await page.getByRole("button", { name: "Lưu nháp", exact: true }).click();
  await page.getByRole("button", { name: "Xác nhận lưu chương trình", exact: true }).click();
  const reconcile = page
    .getByRole("dialog")
    .getByRole("button", { name: "Đối soát chương trình / thử lại cùng yêu cầu", exact: true });
  await reconcile.waitFor();
  await page.waitForFunction(() =>
    Array.from(document.querySelectorAll<HTMLButtonElement>("dialog[open] button")).some(
      (b) => b.textContent?.includes("Đối soát chương trình / thử lại cùng yêu cầu") && !b.disabled,
    ),
  );
  await page.unroute(lostPath);
  await page.waitForLoadState("networkidle");
  await db.sessions.updateMany(
    { principalId: new ObjectId(fixture.employeeId) },
    { $set: { lastActivityAt: new Date(Date.now() - 16 * 60000) } },
  );
  try {
    await reconcile.click({ timeout: 2000 });
  } catch (error) {
    if (!(await page.getByLabel("Mật khẩu", { exact: true }).isVisible())) throw error;
  }
  await page.getByLabel("Mật khẩu", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Tiếp tục", exact: true }).click();
  await page
    .getByRole("button", { name: "Đối soát chương trình / thử lại cùng yêu cầu", exact: true })
    .first()
    .click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  // Receipt reconciliation closes the modal before the program/editions refetch settles.
  // Wait for that observable network work before entering the next independent intent.
  await page.waitForLoadState("networkidle");
  assert(
    (await page.getByLabel("Tiết mục 1 · tên", { exact: true }).inputValue()) ===
      "Bản hai synthetic",
    "lost-response-reconcile-keeps-one-write",
  );
  const freshReason = page.getByLabel("Lý do chương trình / đính chính", { exact: true });
  await freshReason.fill("");
  await freshReason.pressSequentially("Chốt đính chính synthetic", { delay: 20 });
  await freshReason.press("Tab");
  assert(
    (await freshReason.inputValue()) === "Chốt đính chính synthetic",
    "finalize-after-receipt-fresh-reason",
  );
  const finalizePreview = page.waitForResponse(
    (r) =>
      r.url().endsWith(`/programs/drafts/${programId}/preview`) && r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Xem trước chốt", exact: true }).click();
  const finalizedPreviewResponse = await finalizePreview;
  assert(finalizedPreviewResponse.status() === 200, "finalize-after-receipt-preview-accepted");
  await page.getByRole("dialog").waitFor();
  await page.getByLabel(/Tôi xác nhận còn/).check();
  await page.getByRole("button", { name: "Chốt phiên bản", exact: true }).click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  await page.getByRole("button", { name: "In bản chốt r2", exact: true }).waitFor();
  assert(
    JSON.stringify(
      await db.db
        .collection("program_editions")
        .findOne({ programId: new ObjectId(programId), revision: 1 }),
    ) === JSON.stringify(savedR1),
    "amend-r2-preserves-r1-exactly",
  );
  await page.getByLabel("Xem phiên bản", { exact: true }).selectOption("1");
  assert(
    await page.getByText("Mục thủ công synthetic", { exact: true }).isVisible(),
    "historical-r1-selector",
  );
  await page.getByRole("button", { name: "Lịch sử chương trình", exact: true }).click();
  await page.getByRole("heading", { name: "Lịch sử chương trình", exact: true }).waitFor();
  assert((await page.locator("main details").count()) >= 7, "real-history-before-after");
  ownerClient.jar.clear();
  ownerClient.csrf = "";
  assert(
    (await ownerClient.login(fixture.email, password)).status === 200,
    "fixture-owner-session-after-reauth",
  );
  // Pagination-only storage fixture, separate from real r1/r2 workflow above.
  if (!savedR1) throw Error("edition fixture");
  const extraEditions = Array.from({ length: 28 }, (_, i) => ({
    ...savedR1,
    _id: new ObjectId(),
    revision: i + 3,
  }));
  await db.db.collection("program_editions").insertMany(extraEditions);
  await db.db
    .collection("program_drafts")
    .updateOne(
      { _id: new ObjectId(programId) },
      { $set: { latestRevision: 30, latestEditionId: extraEditions.at(-1)?._id } },
    );
  const leadClient = new SyntheticClient("church", conf.origin, transport),
    lead = await syntheticUser(ownerClient, leadClient, church, "ministry_lead", [church.unit]);
  secrets.push(lead.password);
  const userPage = await context.newPage();
  await userPage.goto(`${conf.origin}/h/${church.code}/login`);
  await userPage.getByLabel("Email", { exact: true }).fill(lead.email);
  await userPage.getByLabel("Mật khẩu", { exact: true }).fill(lead.password);
  await userPage.getByRole("button", { name: "Đăng nhập", exact: true }).click();
  await userPage.getByRole("button", { name: /Thờ phượng & Lịch giảng/ }).waitFor();
  const leadTarget = `${conf.origin}/h/${church.code}/worship?programId=${programId}&programRevision=1`;
  await userPage.goto(leadTarget);
  await userPage.getByRole("button", { name: "In bản chốt r1", exact: true }).waitFor();
  assert(
    await userPage.getByRole("button", { name: "Tạo lịch", exact: true }).isDisabled(),
    "lead-program-management-without-calendar-grant",
  );
  assert(
    await userPage.getByText("Mục thủ công synthetic", { exact: true }).isVisible(),
    "deep-link-exact-r1-beyond-first-25-editions",
  );
  await capture("lead-program-r1", userPage);
  await db.sessions.updateMany(
    { principalId: new ObjectId(lead.id) },
    { $set: { lastActivityAt: new Date(Date.now() - 16 * 60000) } },
  );
  await userPage.reload();
  await userPage.getByLabel("Mật khẩu", { exact: true }).fill(lead.password);
  await userPage.getByRole("button", { name: "Tiếp tục", exact: true }).click();
  await userPage.getByRole("button", { name: "In bản chốt r1", exact: true }).waitFor();
  assert(
    new URL(userPage.url()).searchParams.get("programRevision") === "1",
    "reauth-preserves-program-and-edition",
  );
  await p42Schedule(
    ownerClient,
    church,
    { ...church.schedule, state: "cancelled", reason: "Hủy nguồn" },
    church.occurrence,
    2,
  );
  await userPage.getByRole("button", { name: "Làm mới chương trình", exact: true }).click();
  await userPage
    .getByText("Nguồn không còn mở cho chỉnh sửa. Chương trình giữ để xem/in lưu trữ.", {
      exact: true,
    })
    .waitFor();
  assert(
    await userPage
      .getByRole("button", { name: "Tạo nháp đính chính bản mới nhất", exact: true })
      .isDisabled(),
    "cancelled-source-blocks-new-write",
  );
  const [archive] = await Promise.all([
    userPage.waitForEvent("popup"),
    userPage.getByRole("button", { name: "In bản chốt r1", exact: true }).click(),
  ]);
  await archive.getByText(/BẢN LỊCH SỬ/).waitFor();
  assert(
    await archive.getByText("Bản chốt r1", { exact: true }).isVisible(),
    "archived-r1-print-warns-and-keeps-edition",
  );
  await archive.close();
  await userPage.close();
  assert(errors.length === 0, "no-browser-script-errors");
  await Bun.write(
    `${evidence}/browser-results.json`,
    JSON.stringify(
      {
        status: "PASS",
        checks: result,
        spacing: spacingEvidence,
        sourceParity: parity,
        engine: "Firefox and Chromium Playwright",
        bundleIndexSha256: new Bun.CryptoHasher("sha256")
          .update(await Bun.file("dist/index.html").arrayBuffer())
          .digest("hex"),
        limits: ["local/synthetic/private CA", "physical paper/Safari/UAT/production NOT_RUN"],
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
