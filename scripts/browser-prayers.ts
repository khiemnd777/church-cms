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
import { p44Fixture, prayerCreate, prayerSave } from "./p44-fixtures";

const evidence = process.env.CHURCH_EVIDENCE_DIR ?? "output/p4.4";
// Only executed in the disposable browser container; CA trust is private to its Firefox profile.
if (process.platform !== "linux" || !process.env.CHURCH_BROWSER_CONTAINER)
  throw new Error("Use the isolated browser container");
const conf: Config = {
  cert: "/tmp/church-cert.pem",
  key: "/tmp/church-key.pem",
  origin: "https://localhost:3485",
  port: 3485,
  mongoUrl: "mongodb://host.docker.internal:27119/?replicaSet=church-local&directConnection=true",
  redisUrl: "redis://host.docker.internal:6391",
  database: `church_cms_test_browser_p44_${crypto.randomUUID().replaceAll("-", "")}`,
  csrfKey: crypto.randomUUID() + crypto.randomUUID(),
};
const tls = await localTls("/tmp/church-tls");
conf.cert = tls.cert;
conf.key = tls.key;
const db = new Database(conf),
  rate = new RateLimit(conf.redisUrl, conf.csrfKey);
let server: ReturnType<typeof Bun.serve> | undefined;
let losePrayerAcknowledgement = false,
  lostCommittedPrayer = false;
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
      if (new URL(req.url).pathname === "/__p44_source")
        return new Response(sourceHtml, {
          headers: { "content-type": "text/html; charset=utf-8" },
        });
      const response = await app(req, {
        ip: req.headers.get("x-synthetic-client") ?? "browser-p44",
      });
      if (
        losePrayerAcknowledgement &&
        ["POST", "PATCH"].includes(req.method) &&
        /\/care\/prayers(?:\/[a-f0-9]{24})?$/.test(new URL(req.url).pathname)
      ) {
        if (![200, 201].includes(response.status)) return response;
        losePrayerAcknowledgement = false;
        const data = await response.json();
        lostCommittedPrayer = true;
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
      email: `prayer-${crypto.randomUUID()}@example.test`,
      displayName: "Owner synthetic P4.4",
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
  const church = await p44Fixture(db, owner, fixture.employeeId, 70),
    pastorClient = new SyntheticClient("church", conf.origin, transport),
    pastorAccount = await syntheticUser(owner, pastorClient, church, "pastor"),
    secretaryClient = new SyntheticClient("church", conf.origin, transport),
    secretaryAccount = await syntheticUser(owner, secretaryClient, church, "secretary");
  secrets.push(pastorAccount.password, secretaryAccount.password);
  const visit = await careSave(
    owner,
    church,
    careCreate({ kind: "member", id: church.people[0]?._id.toHexString() as string }),
  );
  assert(visit.status === 201, "public-visitation-coexistence-fixture");
  const hiddenMarker = "PASTORAL_BACKEND_SENTINEL",
    hiddenSender = "PASTORAL_SENDER_SENTINEL",
    hidden = await prayerSave(
      pastorClient,
      church,
      prayerCreate("pastoral", {
        content: hiddenMarker,
        requester: { kind: "text", name: hiddenSender },
      }),
    );
  assert(hidden.status === 201, "pastoral-public-command-fixture");
  const shared = await prayerSave(
    owner,
    church,
    prayerCreate("shared", { content: "Lời chung API synthetic", category: "health" }),
  );
  assert(shared.status === 201, "shared-public-command-fixture");
  const target = `${conf.origin}/owner/churches/${church.id}/care`;
  let ownerLeak = false;
  page.on("response", async (r) => {
    if (!r.url().includes("/care/prayers") || !r.headers()["content-type"]?.includes("json"))
      return;
    try {
      const body = await r.text();
      if (body.includes(hiddenMarker) || body.includes(hiddenSender)) ownerLeak = true;
    } catch {}
  });
  await page.goto(target);
  await page.getByRole("button", { name: "Thêm lời cầu thay", exact: true }).click();
  const dialog = page.getByRole("dialog");
  assert(
    (await dialog.getByRole("radio", { name: "Riêng tư · chỉ Mục sư", exact: true }).count()) === 0,
    "owner-no-private-option",
  );
  await dialog
    .getByLabel("Nội dung cầu thay", { exact: true })
    .fill("Chung UI synthetic <script>không thực thi</script>");
  await dialog.getByLabel("Người gửi", { exact: true }).selectOption("text");
  await dialog.getByLabel("Tên người gửi / nhóm", { exact: true }).fill("Nhóm synthetic");
  await capture("owner-prayer-create");
  await dialog.getByRole("button", { name: "Xem trước cầu thay", exact: true }).click();
  await dialog.getByRole("button", { name: "Quay lại sửa", exact: true }).click();
  assert(
    (await dialog.getByLabel("Nội dung cầu thay", { exact: true }).inputValue()).includes(
      "<script>",
    ),
    "prayer-preview-back-preserves-input",
  );
  await dialog.getByRole("button", { name: "Xem trước cầu thay", exact: true }).click();
  assert(
    await dialog.getByRole("button", { name: "Xác nhận lưu cầu thay", exact: true }).isDisabled(),
    "scope-confirmation-required",
  );
  await dialog.getByLabel("Tôi đã kiểm tra nội dung phù hợp phạm vi xem.", { exact: true }).check();
  await dialog.getByRole("button", { name: "Xác nhận lưu cầu thay", exact: true }).click();
  await dialog.waitFor({ state: "hidden" });
  await page.getByRole("button", { name: "Ghi nhận đã chia sẻ", exact: true }).waitFor();
  const ownerId = new URL(page.url()).searchParams.get("prayerId");
  assert(ownerId, "owner-UI-real-prayer-id");
  assert(
    (await db.db.collection("prayer_requests").findOne({ _id: new ObjectId(ownerId) }))
      ?.visibility === "shared",
    "UI-shared-scope-stored",
  );
  assert(
    !(await page.locator("body").innerText()).includes(hiddenMarker) &&
      !(await page.locator("body").innerText()).includes(hiddenSender),
    "owner-no-masked-private-row-or-metadata",
  );
  await capture("owner-prayer-detail");
  const source = await context.newPage();
  await source.goto(`${conf.origin}/__p44_source`);
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
          await subject.evaluate(() =>
            ["table th", ".list .li .t b"].map((selector) => {
              const e = document.querySelector(selector);
              if (!e) return null;
              const c = getComputedStyle(e);
              return [c.fontSize, c.fontFamily, c.padding, c.backgroundColor, c.color];
            }),
          ),
        );
      }
      assert(
        JSON.stringify(styles[0]) === JSON.stringify(styles[1]),
        `source-table-list-parity-${theme}-${width}`,
      );
      parity.push({ theme, width, styles });
    }
  await source.close();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole("button", { name: "Ghi nhận đã chia sẻ", exact: true }).click();
  await dialog
    .getByLabel("Lý do thao tác", { exact: true })
    .fill("Đã chia sẻ trong buổi nhóm synthetic");
  await dialog.getByRole("button", { name: "Xem trước cầu thay", exact: true }).click();
  await dialog.getByLabel("Tôi đã kiểm tra nội dung phù hợp phạm vi xem.", { exact: true }).check();
  await dialog.getByRole("button", { name: "Xác nhận lưu cầu thay", exact: true }).click();
  await dialog.waitFor({ state: "hidden" });
  assert(
    (await db.db.collection("prayer_requests").findOne({ _id: new ObjectId(ownerId) }))?.state ===
      "shared",
    "UI-share-does-not-close-or-send",
  );
  await page.getByRole("button", { name: "Kết thúc cầu thay", exact: true }).click();
  await dialog.getByLabel("Lý do thao tác", { exact: true }).fill("Kết thúc synthetic");
  await dialog.getByRole("button", { name: "Xem trước cầu thay", exact: true }).click();
  await dialog.getByLabel("Tôi đã kiểm tra nội dung phù hợp phạm vi xem.", { exact: true }).check();
  await dialog.getByRole("button", { name: "Xác nhận lưu cầu thay", exact: true }).click();
  await dialog.waitFor({ state: "hidden" });
  await page.getByRole("button", { name: "Lịch sử cầu thay", exact: true }).click();
  await page.getByRole("heading", { name: "Lịch sử cầu thay", exact: true }).waitFor();
  assert(
    (await page.getByRole("button", { name: "Ghi nhận đã chia sẻ", exact: true }).count()) === 0,
    "closed-shared-actions-removed",
  );
  await capture("owner-prayer-history");
  await page.goto(`${conf.origin}/owner/churches/${church.id}/overview`);
  await page.getByRole("button", { name: "Mở lời cầu thay →", exact: true }).click();
  await page.getByRole("heading", { name: "Lời cầu thay", exact: true }).waitFor();
  assert(
    new URL(page.url()).searchParams.get("careSection") === "prayers",
    "W01-prayer-link-opens-real-section",
  );
  assert(!ownerLeak, "owner-responses-contain-no-pastoral-marker-or-sender");
  await context.clearCookies();
  const userPage = await context.newPage();
  screenshotPage = userPage;
  async function reconcilePrayer() {
    const modal = userPage.locator("dialog[open]");
    const target = (await modal.count())
      ? modal.getByRole("button", { name: "Đối soát cầu thay / thử lại cùng yêu cầu", exact: true })
      : userPage
          .getByRole("button", { name: "Đối soát cầu thay / thử lại cùng yêu cầu", exact: true })
          .first();
    await target.click();
  }

  userPage.on("pageerror", (e) => errors.push(e.message));
  const login = async (credentials: { email: string; password: string }) => {
    await userPage.goto(`${conf.origin}/h/${church.code}/login`);
    await userPage.getByLabel("Email", { exact: true }).fill(credentials.email);
    await userPage.getByLabel("Mật khẩu", { exact: true }).fill(credentials.password);
    await userPage.getByRole("button", { name: "Đăng nhập", exact: true }).click();
    await userPage.getByRole("button", { name: "Chăm sóc & Cầu thay", exact: true }).waitFor();
    await userPage.goto(`${conf.origin}/h/${church.code}/care?careSection=prayers`);
    await userPage.getByRole("button", { name: "Thêm lời cầu thay", exact: true }).waitFor();
  };
  await login(pastorAccount);
  await userPage.getByRole("button", { name: "Thêm lời cầu thay", exact: true }).click();
  const ud = userPage.getByRole("dialog");
  assert(
    await ud.getByRole("radio", { name: "Riêng tư · chỉ Mục sư", exact: true }).isChecked(),
    "pastor-default-is-private",
  );
  const privateText = "Riêng tư UI synthetic <script>không thực thi</script>";
  const longProse = "Lời cầu thay tổng hợp tiếng Việt. ".repeat(65).slice(0, 1900);
  await ud.getByLabel("Nội dung cầu thay", { exact: true }).fill(longProse);
  await ud.getByRole("button", { name: "Xem trước cầu thay", exact: true }).click();
  const longConfirm = ud.getByRole("button", { name: "Xác nhận lưu cầu thay", exact: true });
  await longConfirm.scrollIntoViewIfNeeded();
  const longBounds = await longConfirm.boundingBox();
  const longDialog = await ud.boundingBox();
  assert(
    longBounds &&
      longDialog &&
      longBounds.y >= longDialog.y &&
      longBounds.y + longBounds.height <= longDialog.y + longDialog.height + 1,
    "long-Vietnamese-preview-confirm-remains-reachable",
  );
  await ud.getByRole("button", { name: "Quay lại sửa", exact: true }).click();
  assert(
    (await ud.getByLabel("Nội dung cầu thay", { exact: true }).inputValue()) === longProse,
    "long-preview-back-preserves-input",
  );
  await ud.getByLabel("Nội dung cầu thay", { exact: true }).fill(privateText);
  await ud.getByLabel("Người gửi", { exact: true }).selectOption("member");
  const far = church.people.at(-1);
  assert(far, "far requester fixture");
  await ud.getByLabel("Người gửi từ hồ sơ · tìm tên hoặc mã", { exact: true }).fill(far.fullName);
  await ud.getByLabel("Người gửi từ hồ sơ", { exact: true }).selectOption(far._id.toHexString());
  for (let i = 0; i < 12; i++) {
    await userPage.keyboard.press(i % 2 ? "Shift+Tab" : "Tab");
    assert(
      await userPage.evaluate(() => !!document.activeElement?.closest("dialog[open]")),
      `prayer-modal-focus-contained-${i}`,
    );
  }
  await capture("pastor-prayer-create", userPage);
  await ud.getByRole("button", { name: "Xem trước cầu thay", exact: true }).click();
  await ud.getByRole("button", { name: "Xác nhận lưu cầu thay", exact: true }).waitFor();
  await capture("pastor-prayer-preview", userPage);
  await ud.getByLabel("Tôi đã kiểm tra nội dung phù hợp phạm vi xem.", { exact: true }).check();
  const firstAck = userPage.waitForResponse(
    (r) => r.request().method() === "POST" && new URL(r.url()).pathname.endsWith("/care/prayers"),
  );
  losePrayerAcknowledgement = true;
  await ud.getByRole("button", { name: "Xác nhận lưu cầu thay", exact: true }).click();
  await userPage
    .getByRole("button", { name: "Đối soát cầu thay / thử lại cùng yêu cầu", exact: true })
    .first()
    .waitFor();
  assert((await firstAck).status() === 503, "real-commit-response-is-unknown");
  await userPage.waitForFunction(() =>
    Array.from(document.querySelectorAll<HTMLButtonElement>("dialog[open] button")).some(
      (b) => b.textContent?.includes("Đối soát cầu thay") && !b.disabled,
    ),
  );
  assert(lostCommittedPrayer, "real-private-commit-before-lost-ack");
  assert(
    (await userPage
      .getByRole("button", { name: "Đối soát thăm viếng / thử lại cùng yêu cầu", exact: true })
      .count()) === 0,
    "prayer-pending-is-not-consumed-by-visitation",
  );
  assert(
    await userPage.getByRole("button", { name: "+ Tạo hồ sơ", exact: true }).isDisabled(),
    "cross-domain-navigation-and-writes-locked",
  );
  const beforeAgingWrites = logs.filter(
    (r) => (r as { route?: string }).route === "P44.church.requests.root.POST",
  ).length;
  await userPage.evaluate(() => {
    const w = window as unknown as { p44OriginalNow: typeof Date.now };
    w.p44OriginalNow = Date.now;
    const future = Date.now() + 25 * 60 * 60_000;
    Date.now = () => future;
  });
  await db.db
    .collection("sessions")
    .updateMany(
      { principalId: new ObjectId(pastorAccount.id), realm: "church", kind: "full" },
      { $set: { lastActivityAt: new Date(Date.now() - 16 * 60_000) } },
    );
  await reconcilePrayer();
  await userPage.getByRole("heading", { name: "Xác thực lại", exact: true }).waitFor();
  assert(
    !(await userPage.locator("body").innerText()).includes(privateText),
    "private-content-masked-during-reauth",
  );
  await userPage.getByLabel("Mật khẩu", { exact: true }).fill(pastorAccount.password);
  await userPage.getByRole("button", { name: "Tiếp tục", exact: true }).click();
  await reconcilePrayer();
  await userPage.getByRole("button", { name: "Kết thúc cầu thay", exact: true }).waitFor();
  await userPage.evaluate(() => {
    Date.now = (window as unknown as { p44OriginalNow: typeof Date.now }).p44OriginalNow;
  });
  assert(
    logs.filter((r) => (r as { route?: string }).route === "P44.church.requests.root.POST")
      .length === beforeAgingWrites,
    "receipt-read-after-client-replay-window-no-resend",
  );
  const privateId = new URL(userPage.url()).searchParams.get("prayerId");
  assert(privateId, "recovered-private-id");
  assert(
    (await db.db
      .collection("prayer_requests")
      .countDocuments({ churchId: new ObjectId(church.id), content: privateText })) === 1,
    "receipt-recovery-no-private-duplicate",
  );
  assert(
    (await userPage.getByRole("button", { name: "Ghi nhận đã chia sẻ", exact: true }).count()) ===
      0,
    "pastoral-has-no-share-action",
  );
  await capture("pastor-prayer-detail", userPage);
  await userPage.getByRole("button", { name: "Kết thúc cầu thay", exact: true }).click();
  await ud.getByLabel("Lý do thao tác", { exact: true }).fill("Kết thúc riêng tư synthetic");
  await ud.getByRole("button", { name: "Xem trước cầu thay", exact: true }).click();
  await ud.getByLabel("Tôi đã kiểm tra nội dung phù hợp phạm vi xem.", { exact: true }).check();
  await ud.getByRole("button", { name: "Xác nhận lưu cầu thay", exact: true }).click();
  await ud.waitFor({ state: "hidden" });
  await userPage.getByRole("button", { name: "Đính chính cầu thay", exact: true }).click();
  await ud.getByLabel("Nội dung cầu thay", { exact: true }).fill("Riêng tư đính chính synthetic");
  await ud.getByLabel("Lý do thao tác", { exact: true }).fill("Đính chính có lý do synthetic");
  await ud.getByRole("button", { name: "Xem trước cầu thay", exact: true }).click();
  await ud.getByRole("button", { name: "Xác nhận lưu cầu thay", exact: true }).waitFor();
  assert(
    await ud.getByText("Kết thúc riêng tư synthetic", { exact: true }).first().isVisible(),
    "closed-correction-preview-retains-original-close-reason",
  );
  await ud.getByLabel("Tôi đã kiểm tra nội dung phù hợp phạm vi xem.", { exact: true }).check();
  await ud.getByRole("button", { name: "Xác nhận lưu cầu thay", exact: true }).click();
  await ud.waitFor({ state: "hidden" });
  await userPage.getByRole("button", { name: "Lịch sử cầu thay", exact: true }).click();
  await userPage.getByRole("heading", { name: "Lịch sử cầu thay", exact: true }).waitFor();
  await capture("pastor-prayer-history", userPage);
  await userPage
    .getByLabel("Tìm đầu nội dung / người gửi / mã", { exact: true })
    .fill("PRIVATE_SEARCH_SYNTHETIC");
  const searched = userPage.waitForResponse(
    (r) => r.url().includes("/care/prayers?") && r.status() === 200,
  );
  await userPage.getByRole("button", { name: "Lọc cầu thay", exact: true }).click();
  await searched;
  assert(
    !userPage.url().includes("PRIVATE_SEARCH_SYNTHETIC"),
    "private-search-not-persisted-in-URL",
  );
  await userPage.getByRole("button", { name: "Đính chính cầu thay", exact: true }).click();
  await ud.getByLabel("Nội dung cầu thay", { exact: true }).fill("ROLE_LOSS_PRIVATE_SYNTHETIC");
  await ud.getByLabel("Lý do thao tác", { exact: true }).fill("Kiểm chứng mất quyền synthetic");
  await ud.getByRole("button", { name: "Xem trước cầu thay", exact: true }).click();
  await ud.getByLabel("Tôi đã kiểm tra nội dung phù hợp phạm vi xem.", { exact: true }).check();
  const secondAck = userPage.waitForResponse(
    (r) =>
      r.request().method() === "PATCH" &&
      new URL(r.url()).pathname.endsWith(`/care/prayers/${privateId}`),
  );
  losePrayerAcknowledgement = true;
  await ud.getByRole("button", { name: "Xác nhận lưu cầu thay", exact: true }).click();
  await userPage
    .getByRole("button", { name: "Đối soát cầu thay / thử lại cùng yêu cầu", exact: true })
    .first()
    .waitFor();
  assert((await secondAck).status() === 503, "second-private-real-commit-before-role-loss");
  await userPage.waitForFunction(() =>
    Array.from(document.querySelectorAll<HTMLButtonElement>("dialog[open] button")).some(
      (b) => b.textContent?.includes("Đối soát cầu thay") && !b.disabled,
    ),
  );
  await db.db
    .collection("accounts")
    .updateOne(
      { _id: new ObjectId(pastorAccount.id) },
      { $set: { role: "secretary" }, $inc: { version: 1 } },
    );
  await userPage.evaluate(() => {
    const future = Date.now() + 25 * 60 * 60_000;
    Date.now = () => future;
  });
  await reconcilePrayer();
  await ud.waitFor({ state: "hidden" });
  assert(
    !(await userPage.locator("body").innerText()).includes("ROLE_LOSS_PRIVATE_SYNTHETIC") &&
      !(await userPage.locator("body").innerText()).includes("Riêng tư đính chính synthetic"),
    "role-loss-clears-private-detail-history-preview",
  );
  assert(
    (await userPage
      .getByRole("button", { name: "Đối soát cầu thay / thử lại cùng yêu cầu", exact: true })
      .count()) === 0,
    "role-loss-discards-private-pending-body",
  );
  const remainingPrivate = await userPage.evaluate(() =>
    [
      document.body.textContent ?? "",
      ...Array.from(
        document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input,textarea"),
        (element) => element.value,
      ),
    ].join("\n"),
  );
  assert(
    ![
      "ROLE_LOSS_PRIVATE_SYNTHETIC",
      "Riêng tư đính chính synthetic",
      "PRIVATE_SEARCH_SYNTHETIC",
    ].some((marker) => remainingPrivate.includes(marker)),
    "role-loss-clears-private-hidden-DOM-and-form-values",
  );
  await userPage.close();
  await context.clearCookies();
  const secretaryPage = await context.newPage();
  screenshotPage = secretaryPage;
  secretaryPage.on("pageerror", (e) => errors.push(e.message));
  await secretaryPage.goto(`${conf.origin}/h/${church.code}/login`);
  await secretaryPage.getByLabel("Email", { exact: true }).fill(secretaryAccount.email);
  await secretaryPage.getByLabel("Mật khẩu", { exact: true }).fill(secretaryAccount.password);
  await secretaryPage.getByRole("button", { name: "Đăng nhập", exact: true }).click();
  await secretaryPage.getByRole("button", { name: "Chăm sóc & Cầu thay", exact: true }).waitFor();
  await secretaryPage.goto(
    `${conf.origin}/h/${church.code}/care?caseId=${visit.payload.data.caseId}&prayerId=${shared.payload.data.prayerId}&careSection=prayers`,
  );
  await secretaryPage.getByRole("button", { name: "Ghi nhận đã chia sẻ", exact: true }).waitFor();
  assert(
    new URL(secretaryPage.url()).searchParams.get("caseId") === visit.payload.data.caseId &&
      new URL(secretaryPage.url()).searchParams.get("prayerId") === shared.payload.data.prayerId,
    "both-domain-deep-links-survive-URL-effects",
  );
  assert(
    !(await secretaryPage.locator("body").innerText()).includes(hiddenMarker),
    "secretary-no-pastoral-content-or-sender",
  );
  await capture("secretary-prayer-detail", secretaryPage);
  await secretaryPage.getByRole("button", { name: "Hủy lời cầu thay", exact: true }).click();
  const sd = secretaryPage.getByRole("dialog");
  await sd.getByLabel("Lý do thao tác", { exact: true }).fill("Hủy synthetic");
  await sd.getByRole("button", { name: "Xem trước cầu thay", exact: true }).click();
  await sd.getByLabel("Tôi đã kiểm tra nội dung phù hợp phạm vi xem.", { exact: true }).check();
  await sd.getByRole("button", { name: "Xác nhận lưu cầu thay", exact: true }).click();
  await sd.waitFor({ state: "hidden" });
  assert(
    (
      await db.db
        .collection("prayer_requests")
        .findOne({ _id: new ObjectId(shared.payload.data.prayerId) })
    )?.state === "cancelled",
    "secretary-can-cancel-shared-with-reason",
  );
  await secretaryPage.goto(`${conf.origin}/h/${church.code}/care?prayerId=${privateId}`);
  await secretaryPage
    .locator('#prayers > .card [role="alert"]')
    .filter({ hasText: "Không tìm thấy." })
    .waitFor();
  assert(
    !(await secretaryPage.locator("body").innerText()).includes("ROLE_LOSS_PRIVATE_SYNTHETIC"),
    "private-deep-link-is-generic-not-found",
  );
  assert(errors.length === 0, "no-browser-script-errors");
  assert(
    !logs.some(
      (r) =>
        JSON.stringify(r).includes(hiddenMarker) ||
        JSON.stringify(r).includes(privateText) ||
        JSON.stringify(r).includes("PRIVATE_SEARCH_SYNTHETIC"),
    ),
    "transport-logs-contain-no-private-narrative-or-query",
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
