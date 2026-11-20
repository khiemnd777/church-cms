import { mkdir, readdir, readFile } from "node:fs/promises";
import { firefox } from "@playwright/test";
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
import { careCreate, careSave } from "./p43-fixtures";
import { prayerCreate, prayerSave } from "./p44-fixtures";
import { careRoot, p45Fixture, signalCreate, signalSave } from "./p45-fixtures";

const evidence = process.env.CHURCH_EVIDENCE_DIR ?? "output/p4.5";
// Only executed in the disposable browser container; CA trust is private to its Firefox profile.
if (process.platform !== "linux" || !process.env.CHURCH_BROWSER_CONTAINER)
  throw new Error("Use the isolated browser container");
const conf: Config = {
  cert: "/tmp/church-cert.pem",
  key: "/tmp/church-key.pem",
  origin: "https://localhost:3488",
  port: 3488,
  mongoUrl: "mongodb://host.docker.internal:27119/?replicaSet=church-local&directConnection=true",
  redisUrl: "redis://host.docker.internal:6391",
  database: `church_cms_test_browser_p45_${crypto.randomUUID().replaceAll("-", "")}`,
  csrfKey: crypto.randomUUID() + crypto.randomUUID(),
};
const tls = await localTls("/tmp/church-tls");
conf.cert = tls.cert;
conf.key = tls.key;
const db = new Database(conf),
  rate = new RateLimit(conf.redisUrl, conf.csrfKey);
let server: ReturnType<typeof Bun.serve> | undefined;
let loseCareAcknowledgement = false,
  lostCommittedCare = false;
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
            'dialog[open] input:not([type="checkbox"]):not([type="radio"]),dialog[open] select,main .toolbar input:not([type="checkbox"]):not([type="radio"]),main .toolbar select,main .care-section input:not([type="checkbox"]):not([type="radio"]),main .care-section select,main .care-section textarea',
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
          prayerRowsInside: Array.from(
            document.querySelectorAll<HTMLElement>("#prayers ul.list > li"),
          ).every(
            (e) =>
              e.getBoundingClientRect().left >= -1 &&
              e.getBoundingClientRect().right <= innerWidth + 1 &&
              e.scrollWidth <= e.clientWidth + 1,
          ),
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
      assert(layout.prayerRowsInside, `${name}-${theme}-${width}-prayer-list-rows-contained`);
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
        const region = subject.locator("#care-suggestions .tbl-wrap");
        await region.evaluate((e) => {
          e.scrollLeft = 0;
        });
        await region.focus();
        for (let i = 0; i < 20; i++) await subject.keyboard.press("ArrowRight");
        await subject.waitForFunction(() => {
          const e = document.querySelector<HTMLElement>("#care-suggestions .tbl-wrap");
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

let screenshotPage = page;
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
    "approved-source-hash-unchanged",
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
      if (new URL(req.url).pathname === "/__p45_source")
        return new Response(sourceHtml, {
          headers: { "content-type": "text/html; charset=utf-8" },
        });
      const response = await app(req, {
        ip: req.headers.get("x-synthetic-client") ?? "browser-p45",
      });
      if (
        loseCareAcknowledgement &&
        ["POST", "PATCH"].includes(req.method) &&
        /\/care\/suggestions(?:\/[a-f0-9]{24})?$/.test(new URL(req.url).pathname)
      ) {
        if (![200, 201].includes(response.status)) return response;
        loseCareAcknowledgement = false;
        const data = await response.json();
        lostCommittedCare = true;
        return Response.json(
          {
            error: { code: "OUTCOME_UNKNOWN", message: "Mất phản hồi synthetic" },
            meta: { operationId: data.data.operationId },
          },
          { status: 503, headers: response.headers },
        );
      }
      return response;
    },
  });
  await mkdir(evidence, { recursive: true });
  const fixture = await new OwnerOperations(db).create({
      email: `care-${crypto.randomUUID()}@example.test`,
      displayName: "Owner synthetic P4.5",
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
  const ca = await Bun.file(tls.ca).text(),
    transport = (req: Request) => {
      const h = new Headers(req.headers);
      h.set("x-synthetic-client", crypto.randomUUID());
      return fetch(new Request(req, { headers: h }), { tls: { ca } });
    };
  const owner = new SyntheticClient("owner", conf.origin, transport);
  assert((await owner.login(fixture.email, password)).status === 200, "owner-fixture-login");
  const church = await p45Fixture(db, owner, fixture.employeeId, 70),
    pastorClient = new SyntheticClient("church", conf.origin, transport),
    pastorAccount = await syntheticUser(owner, pastorClient, church, "pastor"),
    secretaryClient = new SyntheticClient("church", conf.origin, transport),
    secretaryAccount = await syntheticUser(owner, secretaryClient, church, "secretary");
  secrets.push(pastorAccount.password, secretaryAccount.password);
  const first = church.people[0],
    far = church.people.at(-1),
    second = church.people[1];
  assert(first && far && second, "source-people-fixtures");
  const seeded = await signalSave(owner, church, signalCreate(first._id.toHexString()));
  assert(seeded.status === 201, "public-care-signal-and-alert-fixture");
  const signalList = await owner.call(`${careRoot(church, owner)}?limit=25`),
    firstAlert = signalList.payload.data.items[0];
  const existing = await careSave(
    owner,
    church,
    careCreate(
      { kind: "member", id: first._id.toHexString() },
      {
        reasonCode: "illness",
        description: "Hồ sơ sẵn có synthetic",
        assigneeId: second._id.toHexString(),
      },
    ),
  );
  assert(existing.status === 201, "public-existing-visit-fixture");
  assert(
    (
      await prayerSave(
        pastorClient,
        church,
        prayerCreate("pastoral", { content: "P45_PRIVATE_PRAYER_SENTINEL" }),
      )
    ).status === 201,
    "private-prayer-fixture-independent",
  );
  const target = `${conf.origin}/owner/churches/${church.id}/care?careSection=suggestions&caseId=${existing.payload.data.caseId}`;
  await page.goto(target);
  await page.getByRole("heading", { name: "Đề nghị chăm sóc", exact: true }).waitFor();
  await page.locator("#care-suggestions tbody tr").filter({ hasText: first.fullName }).waitFor();
  await capture("owner-care-list");
  const source = await context.newPage();
  await source.goto(`${conf.origin}/__p45_source`);
  await source.locator('.nav-a[data-go="care"]').click();
  const parity: unknown[] = [];
  for (const theme of ["light", "dark"] as const)
    for (const width of [1440, 390]) {
      const styles = [];
      for (const subject of [page, source]) {
        await subject.emulateMedia({ colorScheme: theme });
        await subject.setViewportSize({ width, height: 1000 });
        await subject.evaluate(async () => {
          await document.fonts.ready;
        });
        styles.push(
          await subject.evaluate(() => {
            const e = document.querySelector("table th");
            if (!e) return null;
            const s = getComputedStyle(e);
            return [s.fontSize, s.fontFamily, s.padding, s.backgroundColor, s.color];
          }),
        );
      }
      assert(
        JSON.stringify(styles[0]) === JSON.stringify(styles[1]),
        `source-care-table-parity-${theme}-${width}`,
      );
      parity.push({ theme, width, styles });
    }
  await source.close();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.emulateMedia({ colorScheme: "light" });
  await page
    .locator("#care-suggestions tbody tr")
    .filter({ hasText: first.fullName })
    .getByRole("button", { name: "Xem đề nghị / nguồn", exact: true })
    .click();
  await page.getByRole("button", { name: "Chuyển sang thăm viếng", exact: true }).waitFor();
  assert(
    new URL(page.url()).searchParams.get("caseId") === existing.payload.data.caseId,
    "care-deep-link-preserves-visitation-key",
  );
  await page.getByRole("button", { name: "Chuyển sang thăm viếng", exact: true }).click();
  const dialog = page.locator("dialog[open]");
  assert(
    await dialog.getByText(/Đã có hồ sơ đang mở/).isVisible(),
    "UI-explicit-link-existing-no-overwrite",
  );
  await dialog.getByLabel("Lý do quyết định", { exact: true }).fill("Đã kiểm tra hồ sơ synthetic");
  await dialog.getByRole("button", { name: "Xem trước quyết định", exact: true }).click();
  await dialog.getByRole("button", { name: "Xác nhận lưu chăm sóc", exact: true }).waitFor();
  assert(
    await dialog.getByRole("button", { name: "Xác nhận lưu chăm sóc", exact: true }).isDisabled(),
    "care-confirmation-required",
  );
  await capture("owner-care-link-preview");
  await dialog.getByLabel("Tôi đã kiểm tra nguồn và quyết định chăm sóc.", { exact: true }).check();
  await dialog.getByRole("button", { name: "Xác nhận lưu chăm sóc", exact: true }).click();
  await dialog.waitFor({ state: "hidden" });
  await page
    .getByRole("button", { name: "Mở hồ sơ thăm viếng đã liên kết", exact: true })
    .waitFor();
  const linked = await db.db
    .collection("care_alerts")
    .findOne({ _id: new ObjectId(firstAlert.id) });
  assert(
    linked?.state === "linked" && linked.caseId.toHexString() === existing.payload.data.caseId,
    "UI-links-existing-case",
  );
  const retained = await db.db
    .collection("visitation_cases")
    .findOne({ _id: new ObjectId(existing.payload.data.caseId) });
  assert(
    retained?.version === 1 &&
      retained.description === "Hồ sơ sẵn có synthetic" &&
      retained.assigneeId.equals(second._id),
    "linked-case-not-overwritten",
  );
  await page.getByRole("button", { name: "Lịch sử đề nghị / nguồn", exact: true }).click();
  await page.getByRole("heading", { name: "Lịch sử đề nghị / nguồn", exact: true }).waitFor();
  await capture("owner-care-history");
  await page.getByRole("button", { name: "Ghi nhận nhu cầu", exact: true }).click();
  await dialog
    .getByLabel("Đối tượng nhu cầu · tìm tên hoặc mã", { exact: true })
    .fill(far.fullName);
  await dialog.getByLabel("Đối tượng nhu cầu", { exact: true }).selectOption(far._id.toHexString());
  const note = "Nhu cầu UI synthetic <script>không thực thi</script>";
  await dialog.getByLabel("Ghi chú nhu cầu · tùy chọn", { exact: true }).fill(note);
  for (let i = 0; i < 10; i++) {
    await page.keyboard.press(i % 2 ? "Shift+Tab" : "Tab");
    assert(
      await page.evaluate(() => !!document.activeElement?.closest("dialog[open]")),
      `care-source-modal-focus-${i}`,
    );
  }
  await capture("owner-care-source-create");
  await dialog.getByRole("button", { name: "Xem trước nguồn", exact: true }).click();
  await dialog.getByRole("button", { name: "Quay lại sửa", exact: true }).click();
  assert(
    (await dialog.getByLabel("Ghi chú nhu cầu · tùy chọn", { exact: true }).inputValue()) === note,
    "source-preview-back-preserves-note",
  );
  await dialog.getByRole("button", { name: "Xem trước nguồn", exact: true }).click();
  await dialog.getByRole("button", { name: "Xác nhận lưu chăm sóc", exact: true }).waitFor();
  await dialog.getByLabel("Tôi đã kiểm tra nguồn và quyết định chăm sóc.", { exact: true }).check();
  await dialog.getByRole("button", { name: "Xác nhận lưu chăm sóc", exact: true }).click();
  await dialog.waitFor({ state: "hidden" });
  await page.getByRole("button", { name: "Đính chính nguồn", exact: true }).waitFor();
  const newSignal = new URL(page.url()).searchParams.get("careSuggestionId");
  assert(newSignal, "UI-source-id-real");
  assert(
    (await db.db.collection("care_signals").findOne({ _id: new ObjectId(newSignal) }))?.summary ===
      note,
    "UI-source-saved-plaintext",
  );
  await page.getByRole("button", { name: "Đính chính nguồn", exact: true }).click();
  await dialog
    .getByLabel("Ghi chú nhu cầu · tùy chọn", { exact: true })
    .fill("Nguồn đã đính chính synthetic");
  await dialog.getByLabel("Lý do thay đổi nguồn", { exact: true }).fill("Sửa nội dung nguồn");
  await dialog.getByRole("button", { name: "Xem trước nguồn", exact: true }).click();
  await dialog.getByLabel("Tôi đã kiểm tra nguồn và quyết định chăm sóc.", { exact: true }).check();
  await dialog.getByRole("button", { name: "Xác nhận lưu chăm sóc", exact: true }).click();
  await dialog.waitFor({ state: "hidden" });
  await page.getByRole("button", { name: "Kết thúc nguồn", exact: true }).click();
  await dialog.getByLabel("Lý do thay đổi nguồn", { exact: true }).fill("Nguồn cũ đã kết thúc");
  await dialog.getByRole("button", { name: "Xem trước nguồn", exact: true }).click();
  await dialog.getByLabel("Tôi đã kiểm tra nguồn và quyết định chăm sóc.", { exact: true }).check();
  await dialog.getByRole("button", { name: "Xác nhận lưu chăm sóc", exact: true }).click();
  await dialog.waitFor({ state: "hidden" });
  assert(
    (await db.db.collection("care_signals").findOne({ _id: new ObjectId(newSignal) }))?.state ===
      "ended",
    "UI-source-end-recorded",
  );
  await page.getByRole("button", { name: "Xem đề nghị", exact: true }).click();
  await page.getByLabel("Trạng thái đề nghị / nguồn", { exact: true }).selectOption("all");
  await page.getByRole("button", { name: "Lọc đề nghị", exact: true }).click();
  await page
    .locator("#care-suggestions tbody tr")
    .filter({ hasText: far.fullName })
    .getByRole("button", { name: "Xem đề nghị / nguồn", exact: true })
    .click();
  await page.getByRole("button", { name: "Lịch sử đề nghị / nguồn", exact: true }).waitFor();
  assert(
    (await page.getByRole("button", { name: "Chuyển sang thăm viếng", exact: true }).count()) === 0,
    "ended-source-pending-alert-expires",
  );
  await page.goto(`${conf.origin}/owner/churches/${church.id}/overview`);
  await page.getByRole("button", { name: "Mở đề nghị chăm sóc →", exact: true }).click();
  await page.getByRole("heading", { name: "Đề nghị chăm sóc", exact: true }).waitFor();
  assert(
    new URL(page.url()).searchParams.get("careSection") === "suggestions",
    "W01-real-care-drilldown",
  );
  await page.getByRole("button", { name: "Đánh giá nguồn", exact: true }).click();
  await page.getByRole("button", { name: "Tiếp tục đánh giá nguồn", exact: true }).waitFor();
  assert(
    await page.getByText(/Nguồn vắng3: 0\/3 CN đã chốt/).isVisible(),
    "scan-shows-missing-coverage-not-absence",
  );
  for (
    let i = 0;
    i < 4 &&
    (await page.getByRole("button", { name: "Tiếp tục đánh giá nguồn", exact: true }).count());
    i++
  ) {
    const response = page.waitForResponse(
      (r) =>
        r.request().method() === "POST" &&
        new URL(r.url()).pathname.endsWith("/care/suggestions/evaluate"),
    );
    await page.getByRole("button", { name: "Tiếp tục đánh giá nguồn", exact: true }).click();
    await response;
    await page.waitForFunction(() =>
      Array.from(document.querySelectorAll<HTMLButtonElement>("#care-suggestions button")).some(
        (b) => b.textContent === "Đánh giá nguồn" && !b.disabled,
      ),
    );
  }
  await page
    .getByText(/Đã xong các lô/)
    .first()
    .waitFor();
  await capture("owner-care-scan-complete");
  await context.clearCookies();
  const userPage = await context.newPage();
  screenshotPage = userPage;
  userPage.on("pageerror", (e) => errors.push(e.message));
  await userPage.goto(`${conf.origin}/${church.code}/login`);
  await userPage.getByLabel("Email", { exact: true }).fill(secretaryAccount.email);
  await userPage.getByLabel("Mật khẩu", { exact: true }).fill(secretaryAccount.password);
  await userPage.getByRole("button", { name: "Đăng nhập", exact: true }).click();
  await userPage.getByRole("button", { name: "Chăm sóc & Cầu thay", exact: true }).waitFor();
  const fresh = await signalSave(
      secretaryClient,
      church,
      signalCreate(far._id.toHexString(), "new_believer"),
    ),
    freshList = await secretaryClient.call(
      `${careRoot(church, secretaryClient)}?kind=new_believer`,
    ),
    work = freshList.payload.data.items.find(
      (r: { target: { id: string } }) => r.target.id === far._id.toHexString(),
    );
  assert(fresh.status === 201 && work, "secretary-manual-known-belief-source");
  await userPage.goto(
    `${conf.origin}/${church.code}/care?careSection=suggestions&careSuggestionId=${work.id}`,
  );
  await userPage.getByRole("button", { name: "Chuyển sang thăm viếng", exact: true }).click();
  const ud = userPage.locator("dialog[open]");
  await ud.getByLabel("Lý do quyết định", { exact: true }).fill("Giao thăm viếng synthetic");
  await ud
    .getByLabel("Người phụ trách thăm viếng · tìm tên hoặc mã", { exact: true })
    .fill(second.fullName);
  await ud
    .getByLabel("Người phụ trách thăm viếng", { exact: true })
    .selectOption(second._id.toHexString());
  await ud.getByRole("button", { name: "Xem trước quyết định", exact: true }).click();
  await ud.getByRole("button", { name: "Xác nhận lưu chăm sóc", exact: true }).waitFor();
  await capture("secretary-care-convert-preview", userPage);
  await ud.getByLabel("Tôi đã kiểm tra nguồn và quyết định chăm sóc.", { exact: true }).check();
  const ack = userPage.waitForResponse(
    (r) =>
      r.request().method() === "PATCH" &&
      new URL(r.url()).pathname.endsWith(`/care/suggestions/${work.id}`),
  );
  loseCareAcknowledgement = true;
  await ud.getByRole("button", { name: "Xác nhận lưu chăm sóc", exact: true }).click();
  assert((await ack).status() === 503 && lostCommittedCare, "care-real-commit-before-ACK-loss");
  await userPage.waitForFunction(() =>
    Array.from(document.querySelectorAll<HTMLButtonElement>("dialog[open] button")).some(
      (b) => b.textContent?.includes("Đối soát đề nghị") && !b.disabled,
    ),
  );
  assert(
    (await userPage
      .getByRole("button", { name: "Đối soát thăm viếng / thử lại cùng yêu cầu", exact: true })
      .count()) === 0,
    "care-pending-not-consumed-by-visitation",
  );
  assert(
    (await userPage
      .getByRole("button", { name: "Đối soát cầu thay / thử lại cùng yêu cầu", exact: true })
      .count()) === 0,
    "care-pending-not-consumed-by-prayers",
  );
  assert(
    await userPage.getByRole("button", { name: "Thêm lời cầu thay", exact: true }).isDisabled(),
    "care-pending-locks-prayer-writes",
  );
  await db.db
    .collection("sessions")
    .updateMany(
      { principalId: new ObjectId(secretaryAccount.id), realm: "church", kind: "full" },
      { $set: { lastActivityAt: new Date(Date.now() - 16 * 60_000) } },
    );
  const reconcile = () =>
    userPage
      .locator("dialog[open]")
      .getByRole("button", { name: "Đối soát đề nghị / thử lại cùng yêu cầu", exact: true })
      .click();
  await reconcile();
  await userPage.getByRole("heading", { name: "Xác thực lại", exact: true }).waitFor();
  await userPage.getByLabel("Mật khẩu", { exact: true }).fill(secretaryAccount.password);
  await userPage.getByRole("button", { name: "Tiếp tục", exact: true }).click();
  const activeModal = userPage.locator("dialog[open]");
  if (await activeModal.count())
    await activeModal
      .getByRole("button", { name: "Đối soát đề nghị / thử lại cùng yêu cầu", exact: true })
      .click();
  else
    await userPage
      .getByRole("button", { name: "Đối soát đề nghị / thử lại cùng yêu cầu", exact: true })
      .first()
      .click();
  await userPage
    .getByRole("button", { name: "Mở hồ sơ thăm viếng đã liên kết", exact: true })
    .waitFor();
  const committed = await db.db.collection("care_alerts").findOne({ _id: new ObjectId(work.id) });
  assert(committed?.caseId, "linked-care-case-after-recovery");
  assert(
    (await db.db.collection("visitation_cases").countDocuments({
      churchId: new ObjectId(church.id),
      targetId: far._id,
      reasonCode: "new_believer",
    })) === 1,
    "receipt-recovery-no-duplicate-case",
  );
  const v = await db.db.collection("visitation_cases").findOne({ _id: committed.caseId });
  assert(
    v?.assigneeId.equals(second._id) && v.entryCount === 0 && v.visitedCount === 0,
    "UI-explicit-assignment-no-auto-visited",
  );
  await userPage.getByRole("button", { name: "Lịch sử đề nghị / nguồn", exact: true }).click();
  await userPage.getByRole("heading", { name: "Lịch sử đề nghị / nguồn", exact: true }).waitFor();
  await capture("secretary-care-linked-history", userPage);
  const skipSource = await signalSave(pastorClient, church, signalCreate(second._id.toHexString())),
    skipList = await pastorClient.call(`${careRoot(church, pastorClient)}?kind=illness`),
    skip = skipList.payload.data.items.find(
      (r: { target: { id: string } }) => r.target.id === second._id.toHexString(),
    );
  assert(skipSource.status === 201 && skip, "pastor-source-fixture");
  await context.clearCookies();
  await userPage.goto(`${conf.origin}/${church.code}/login`);
  await userPage.getByLabel("Email", { exact: true }).fill(pastorAccount.email);
  await userPage.getByLabel("Mật khẩu", { exact: true }).fill(pastorAccount.password);
  await userPage.getByRole("button", { name: "Đăng nhập", exact: true }).click();
  await userPage.getByRole("button", { name: "Chăm sóc & Cầu thay", exact: true }).waitFor();
  await userPage.goto(`${conf.origin}/${church.code}/care?careSuggestionId=${skip.id}`);
  await userPage.getByRole("button", { name: "Bỏ qua có lý do", exact: true }).click();
  await ud.getByLabel("Lý do quyết định", { exact: true }).fill("Bỏ qua đã kiểm tra synthetic");
  await ud.getByRole("button", { name: "Xem trước quyết định", exact: true }).click();
  await ud.getByLabel("Tôi đã kiểm tra nguồn và quyết định chăm sóc.", { exact: true }).check();
  await ud.getByRole("button", { name: "Xác nhận lưu chăm sóc", exact: true }).click();
  await ud.waitFor({ state: "hidden" });
  assert(
    (await db.db.collection("care_alerts").findOne({ _id: new ObjectId(skip.id) }))?.state ===
      "dismissed",
    "pastor-UI-reasoned-dismiss",
  );
  await capture("pastor-care-dismissed", userPage);
  const lossPerson = church.people[2];
  assert(lossPerson, "role-loss-person-fixture");
  const lossSource = await signalSave(
    pastorClient,
    church,
    signalCreate(lossPerson._id.toHexString(), "illness", {
      summary: "ROLE_LOSS_CARE_SOURCE_SYNTHETIC",
    }),
  );
  assert(lossSource.status === 201, "role-loss-source-fixture");
  const lossList = await pastorClient.call(`${careRoot(church, pastorClient)}?kind=illness`);
  const loss = lossList.payload.data.items.find(
    (r: { target: { id: string } }) => r.target.id === lossPerson._id.toHexString(),
  );
  assert(loss, "role-loss-pending-alert");
  await userPage.goto(`${conf.origin}/${church.code}/care?careSuggestionId=${loss.id}`);
  await userPage.getByRole("button", { name: "Chuyển sang thăm viếng", exact: true }).waitFor();
  await userPage
    .getByLabel("Tìm người / gia đình / mã đề nghị", { exact: true })
    .fill("ROLE_LOSS_CARE_QUERY_SYNTHETIC");
  const filtered = userPage.waitForResponse(
    (r) => r.url().includes("/care/suggestions?") && r.status() === 200,
  );
  await userPage.getByRole("button", { name: "Lọc đề nghị", exact: true }).click();
  await filtered;
  await userPage.getByRole("button", { name: "Chuyển sang thăm viếng", exact: true }).click();
  await ud.getByLabel("Mô tả thăm viếng", { exact: true }).fill("ROLE_LOSS_CARE_BODY_SYNTHETIC");
  await ud.getByLabel("Lý do quyết định", { exact: true }).fill("Kiểm chứng thu hồi quyền");
  await ud.getByRole("button", { name: "Xem trước quyết định", exact: true }).click();
  await ud.getByLabel("Tôi đã kiểm tra nguồn và quyết định chăm sóc.", { exact: true }).check();
  const lossAck = userPage.waitForResponse(
    (r) =>
      r.request().method() === "PATCH" &&
      new URL(r.url()).pathname.endsWith(`/care/suggestions/${loss.id}`),
  );
  loseCareAcknowledgement = true;
  await ud.getByRole("button", { name: "Xác nhận lưu chăm sóc", exact: true }).click();
  assert((await lossAck).status() === 503, "role-loss-happens-after-real-commit");
  await userPage.waitForFunction(() =>
    Array.from(document.querySelectorAll<HTMLButtonElement>("dialog[open] button")).some(
      (b) => b.textContent?.includes("Đối soát đề nghị") && !b.disabled,
    ),
  );
  await db.db
    .collection("accounts")
    .updateOne(
      { _id: new ObjectId(pastorAccount.id) },
      { $set: { role: "treasurer" }, $inc: { version: 1 } },
    );
  await ud
    .getByRole("button", { name: "Đối soát đề nghị / thử lại cùng yêu cầu", exact: true })
    .click();
  await ud.waitFor({ state: "hidden" });
  const retainedBody = await userPage.evaluate(() =>
    [
      document.body.textContent ?? "",
      ...Array.from(
        document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input,textarea"),
        (e) => e.value,
      ),
    ].join("\n"),
  );
  assert(
    ![
      "ROLE_LOSS_CARE_SOURCE_SYNTHETIC",
      "ROLE_LOSS_CARE_BODY_SYNTHETIC",
      "ROLE_LOSS_CARE_QUERY_SYNTHETIC",
      "P45_PRIVATE_PRAYER_SENTINEL",
    ].some((marker) => retainedBody.includes(marker)),
    "care-role-loss-clears-hidden-DOM-form-query-and-history",
  );
  assert(
    (await userPage
      .getByRole("button", { name: "Đối soát đề nghị / thử lại cùng yêu cầu", exact: true })
      .count()) === 0,
    "care-role-loss-discards-pending-no-resend",
  );
  assert(
    !userPage.url().includes("ROLE_LOSS_CARE_QUERY_SYNTHETIC"),
    "care-query-remains-memory-only",
  );
  assert(errors.length === 0, "no-browser-script-errors");
  assert(
    !JSON.stringify(logs).includes("Nguồn đã đính chính synthetic") &&
      !JSON.stringify(logs).includes("P45_PRIVATE_PRAYER_SENTINEL"),
    "transport-logs-no-care-or-prayer-narrative",
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
          "Local/synthetic/private CA only",
          "Physical/Safari/UAT/main runtime/production NOT_RUN",
          "No portal/export/notifications/automation/aggregate restore",
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
  await screenshotPage.screenshot({ path: `${evidence}/browser-failure.png` });
  throw new Error(safe);
} finally {
  await context.close();
  if (server) await server.stop(true);
  if (db.db.databaseName === conf.database) await db.db.dropDatabase();
  const removed = !(await db.db.admin().listDatabases()).databases.some(
    (d) => d.name === conf.database,
  );
  await Bun.write(
    `${evidence}/browser-cleanup.json`,
    JSON.stringify({ database: conf.database, removed }),
  );
  await db.client.close();
  if (rate.client.isOpen) rate.client.destroy();
}
