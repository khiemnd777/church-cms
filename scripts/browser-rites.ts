import { mkdir, readdir, readFile } from "node:fs/promises";
import { firefox } from "@playwright/test";
import { ObjectId } from "mongodb";
import { createApp } from "../api/app";
import type { Config } from "../api/config";
import { OwnerOperations } from "../api/identity/owner-operations";
import { Identity } from "../api/identity/service";
import { Database, initialize } from "../api/infrastructure/database";
import { RateLimit } from "../api/infrastructure/rate-limit";
import type { Member } from "../api/members/models";
import { localTls } from "./local-tls";
import { seedP2 } from "./p2-fixtures";

const evidence = process.env.CHURCH_EVIDENCE_DIR ?? "output/p3.4";
// Only executed in the disposable browser container; CA trust is private to its Firefox profile.
if (process.platform !== "linux" || !process.env.CHURCH_BROWSER_CONTAINER)
  throw new Error("Use the isolated browser container");
const conf: Config = {
  cert: "/tmp/church-cert.pem",
  key: "/tmp/church-key.pem",
  origin: "https://localhost:3466",
  port: 3466,
  mongoUrl: "mongodb://host.docker.internal:27119/?replicaSet=church-local&directConnection=true",
  redisUrl: "redis://host.docker.internal:6391",
  database: `church_cms_test_browser_p34_${crypto.randomUUID().replaceAll("-", "")}`,
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
      await subject.setViewportSize({ width, height: 1000 });
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
            'dialog[open] input:not([type="checkbox"]),dialog[open] select, main .toolbar input,main .toolbar select',
          ),
        ).filter((e) => e.getClientRects().length > 0);
        const section = document.querySelector('.rites-section [role="tabpanel"]');
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
      new URL(req.url).pathname === "/__p34_source"
        ? new Response(sourceHtml, { headers: { "content-type": "text/html; charset=utf-8" } })
        : app(req, { ip: "browser-p34" }),
  });
  await mkdir(evidence, { recursive: true });
  const fixture = await new OwnerOperations(db).create({
      email: `rite-${crypto.randomUUID()}@example.test`,
      displayName: "Owner synthetic P3.4",
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
  const church = (
      await api("owner/churches", { name: "Hội Thánh lễ nghi synthetic", province: "Đà Nẵng" })
    ).payload.data.church,
    base = `owner/churches/${church.id}`,
    prefix = `${base}/rites/records`;
  assert(
    (
      await api(`${base}/organization/settings`, {
        unitType: "area",
        defaultAssignmentMode: "auto",
      })
    ).status === 201,
    "configured-church",
  );
  await seedP2(db, church.id, fixture.employeeId, 8);
  const people = await db.db
    .collection<Member>("members")
    .find({ churchId: new ObjectId(church.id) })
    .sort({ _id: 1 })
    .toArray();
  const first = people[0];
  assert(first, "member-fixture-present");
  await page.goto(`${conf.origin}/owner/churches/${church.id}/rites?tab=bap`);
  await page.getByRole("button", { name: "+ Ghi lễ", exact: true }).waitFor();
  await page.getByRole("table").first().waitFor();
  for (const name of ["Báp-têm", "Lớp dự bị", "Dâng con", "Thành hôn", "An táng", "Tiệc Thánh"])
    assert(await page.getByRole("tab", { name, exact: true }).isEnabled(), `enabled-tab-${name}`);
  await capture("baptism-list");
  await page.getByRole("tab", { name: "Báp-têm", exact: true }).focus();
  await page.keyboard.press("End");
  await page.getByRole("tab", { name: "Tiệc Thánh", exact: true }).waitFor();
  await page.waitForFunction(() => document.activeElement?.id === "rites-tab-com");
  assert(
    new URL(page.url()).searchParams.get("tab") === "com",
    "keyboard-switch-retains-selected-tab-focus",
  );
  await page.keyboard.press("Home");
  await page.waitForFunction(() => document.activeElement?.id === "rites-tab-bap");
  const source = await context.newPage();
  await source.goto(`${conf.origin}/__p34_source`);
  await source.locator('.nav-a[data-go="rites"]').click();
  const parity: unknown[] = [];
  for (const [tab, name] of [
    ["bap", "Báp-têm"],
    ["ded", "Dâng con"],
    ["wed", "Thành hôn"],
    ["fun", "An táng"],
    ["com", "Tiệc Thánh"],
  ]) {
    await page.getByRole("tab", { name, exact: true }).click();
    await page.getByRole("table").first().waitFor();
    await source.locator(`[data-tab="${tab}"]`).click();
    for (const theme of ["light", "dark"] as const)
      for (const width of [1440, 390]) {
        const values = [];
        for (const target of [page, source]) {
          await target.emulateMedia({ colorScheme: theme });
          await target.setViewportSize({ width, height: 1000 });
          // Compare neutral style in both pages. Keyboard focus has its own asserted
          // UI-STD-r1 6px radius, already present in the approved source stylesheet.
          await target.evaluate(() => {
            (document.activeElement as HTMLElement)?.blur();
            return document.fonts.ready;
          });
          values.push(
            await target.evaluate(() =>
              ["table th", ".tabs .tab.on"].map((sel) => {
                const e = document.querySelector(sel);
                if (!e) throw Error(`Missing ${sel}`);
                const c = getComputedStyle(e);
                return [c.backgroundColor, c.color, c.fontFamily, c.fontSize, c.borderRadius];
              }),
            ),
          );
        }
        if (JSON.stringify(values[0]) !== JSON.stringify(values[1]))
          console.info(JSON.stringify({ tab, theme, width, values }));
        assert(
          JSON.stringify(values[0]) === JSON.stringify(values[1]),
          `W06-${tab}-${theme}-${width}-source-parity`,
        );
        parity.push({ tab, theme, width, actual: values[0], reference: values[1] });
      }
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.emulateMedia({ colorScheme: "light" });
    await capture(`tab-${tab}`);
  }
  await source.close();
  const chosenPerson = first;
  async function choose(label: string) {
    const group = page.getByRole("group", { name: label, exact: true });
    await group
      .getByRole("button", { name: `${chosenPerson.fullName} · ${chosenPerson.code}`, exact: true })
      .click();
  }
  async function start(tab: string) {
    await page.getByRole("tab", { name: tab, exact: true }).click();
    await page.getByRole("button", { name: "+ Ghi lễ", exact: true }).click();
    await page.getByRole("dialog").waitFor();
  }
  async function confirm() {
    await page.getByRole("button", { name: "Xem trước xác nhận", exact: true }).click();
    await page
      .getByRole("heading", { name: "Preview xác nhận / đính chính", exact: true })
      .waitFor();
    await page.getByLabel("Tôi xác nhận sự kiện và thông tin trước/sau").check();
    await page.getByRole("button", { name: "Xác nhận", exact: true }).click();
    await page.getByRole("dialog").waitFor({ state: "hidden" });
  }
  await start("Báp-têm");
  await choose("Người chịu Báp-têm");
  await page.getByRole("dialog").getByLabel("Nơi", { exact: true }).fill("Nơi ghi lễ synthetic");
  await page.getByRole("dialog").getByLabel("Trạng thái", { exact: true }).selectOption("recorded");
  await capture("baptism-form");
  await page.getByRole("button", { name: "Xem trước xác nhận", exact: true }).click();
  await page.getByRole("heading", { name: "Preview xác nhận / đính chính", exact: true }).waitFor();
  assert(
    await page.getByRole("button", { name: "Xác nhận", exact: true }).isDisabled(),
    "preview-needs-explicit-confirmation",
  );
  await capture("baptism-preview");
  await page.getByRole("button", { name: "Quay lại", exact: true }).click();
  assert(
    (await page.getByRole("dialog").getByLabel("Nơi", { exact: true }).inputValue()) ===
      "Nơi ghi lễ synthetic",
    "preview-back-preserves-form",
  );
  await confirm();
  await page.getByRole("heading", { name: "Chi tiết Báp-têm", exact: true }).waitFor();
  const baptismId = new URL(page.url()).searchParams.get("riteId");
  assert(baptismId, "baptism-id-in-url");
  const member = await api(`${base}/members/${first._id}`);
  assert(
    member.payload.data.baptism.status === "baptized" &&
      member.payload.data.baptism.place === "Nơi ghi lễ synthetic",
    "UI-writes-canonical-baptism",
  );
  await page.getByRole("button", { name: "Xem hồ sơ", exact: true }).last().click();
  await page
    .getByRole("region", { name: "Sổ lễ nghi của thuộc viên" })
    .getByRole("button", { name: "Mở sổ", exact: true })
    .click();
  await page.getByRole("heading", { name: "Chi tiết Báp-têm", exact: true }).waitFor();
  assert(new URL(page.url()).searchParams.get("riteId") === baptismId, "W06-W14-W06-context");
  await page.getByRole("button", { name: "Lịch sử", exact: true }).click();
  await page.getByRole("heading", { name: "Lịch sử lễ", exact: true }).waitFor();
  await page.keyboard.press("Escape");
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  await page.waitForFunction(() => document.activeElement?.textContent?.trim() === "Lịch sử");
  assert(
    await page
      .getByRole("button", { name: "Lịch sử", exact: true })
      .evaluate((e) => e === document.activeElement),
    "history-escape-restores-focus",
  );
  await start("Dâng con");
  await choose("Con được dâng");
  await page.getByRole("button", { name: "Thêm cha mẹ/người giám hộ", exact: true }).click();
  await page.getByLabel("Vai trò người 1", { exact: true }).selectOption("father");
  await page.getByLabel("Người liên quan 1 · nguồn", { exact: true }).selectOption("external");
  await page
    .getByLabel("Người liên quan 1 · họ tên", { exact: true })
    .fill("Cha nhập rõ synthetic");
  await page.getByRole("dialog").getByLabel("Trạng thái", { exact: true }).selectOption("recorded");
  await capture("dedication-form");
  await confirm();
  await page.getByRole("heading", { name: "Chi tiết Dâng con", exact: true }).waitFor();
  assert(
    (await api(`${prefix}/${new URL(page.url()).searchParams.get("riteId")}`)).payload.data
      .people[1].fullName === "Cha nhập rõ synthetic",
    "explicit-parent-snapshot",
  );
  await start("Thành hôn");
  await choose("Chú rể");
  await page
    .getByLabel("Cô dâu · họ tên", { exact: true })
    .fill("Người phối ngẫu ngoài HT synthetic");
  await page.getByRole("button", { name: "Thêm lần rao", exact: true }).click();
  await page.getByLabel("Trạng thái rao 1", { exact: true }).selectOption("announced");
  await page.getByLabel("Ghi chú rao 1", { exact: true }).fill("Đã rao synthetic");
  await page.getByRole("dialog").getByLabel("Trạng thái", { exact: true }).selectOption("planned");
  await capture("marriage-form");
  await page.getByRole("button", { name: "Lưu", exact: true }).click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  await page.getByRole("heading", { name: "Chi tiết Thành hôn", exact: true }).waitFor();
  assert(
    (await page.getByText("Đã rao synthetic", { exact: false }).count()) > 0,
    "marriage-announcement-retained",
  );
  await start("An táng");
  await choose("Người qua đời");
  await page.getByRole("dialog").getByLabel("Trạng thái", { exact: true }).selectOption("recorded");
  await confirm();
  await page.getByRole("heading", { name: "Chi tiết An táng", exact: true }).waitFor();
  assert(
    (await api(`${base}/members/${first._id}`)).payload.data.participation ===
      member.payload.data.participation,
    "funeral-does-not-change-participation",
  );
  await start("Tiệc Thánh");
  await page.getByLabel("Số người dự · nhập tay", { exact: true }).fill("0");
  await page.getByRole("dialog").getByLabel("Trạng thái", { exact: true }).selectOption("recorded");
  await confirm();
  await page.getByRole("heading", { name: "Chi tiết Tiệc Thánh", exact: true }).waitFor();
  const communionId = new URL(page.url()).searchParams.get("riteId");
  assert(
    (await api(`${prefix}/${communionId}`)).payload.data.record.payload.count === 0,
    "communion-zero-not-unknown",
  );
  await capture("communion-detail");
  // Drop an actual committed HTTP response. Retry must replay the same operation once.
  await page.getByRole("button", { name: "+ Ghi lễ", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByLabel("Ghi chú", { exact: true })
    .fill("Ý định mất phản hồi synthetic");
  let lost = false,
    committed = false,
    routeError = "";
  let finishRoute!: () => void;
  const routed = new Promise<void>((resolve) => {
    finishRoute = resolve;
  });
  await page.route(`**/api/v1/${prefix}`, async (route) => {
    if (!lost && route.request().method() === "POST") {
      lost = true;
      try {
        const request = route.request(),
          forwarded = new Headers(await request.allHeaders());
        // Bun supplies Host/SNI and byte length from URL/body. A forwarded Host
        // containing :port becomes an invalid TLS servername in this transport.
        for (const header of ["host", "content-length", "connection"]) forwarded.delete(header);
        const response = await fetch(request.url(), {
          method: request.method(),
          headers: forwarded,
          body: request.postData(),
          tls: { ca: await Bun.file(tls.ca).text() },
          signal: AbortSignal.timeout(10000),
        });
        committed = response.status === 201;
        await response.arrayBuffer();
      } catch (error) {
        routeError = error instanceof Error ? error.message : "Synthetic forwarding failed";
      } finally {
        await route.abort("failed");
        finishRoute();
      }
    } else await route.continue();
  });
  await page.getByRole("button", { name: "Lưu", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Thử lại / kiểm tra thao tác", exact: true })
    .waitFor();
  await routed;
  assert(committed, `lost-response-was-committed${routeError ? `: ${routeError}` : ""}`);
  assert(lost, "pending-intent-visible-in-modal");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Thử lại / kiểm tra thao tác", exact: true })
    .click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  await page.unroute(`**/api/v1/${prefix}`);
  assert(
    (await db.db.collection("rite_records").countDocuments({
      churchId: new ObjectId(church.id),
      "input.note": "Ý định mất phản hồi synthetic",
    })) === 1,
    "unknown-outcome-replayed-once",
  );
  const activeId = new URL(page.url()).searchParams.get("riteId");
  await db.sessions.updateMany(
    { realm: "owner", principalId: new ObjectId(fixture.employeeId), kind: "full" },
    { $set: { lastActivityAt: new Date(Date.now() - 16 * 60_000) } },
  );
  await page.reload();
  await page.getByRole("heading", { name: "Xác thực lại", exact: true }).waitFor();
  await page.getByLabel("Mật khẩu", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Tiếp tục", exact: true }).click();
  await page.getByRole("table").first().waitFor();
  assert(
    new URL(page.url()).searchParams.get("tab") === "com" &&
      new URL(page.url()).searchParams.get("riteId") === activeId,
    "owner-reauth-retains-rite-context",
  );
  const email = `secretary-${crypto.randomUUID()}@example.test`,
    userPassword = `User 🌿 ${crypto.randomUUID()}`,
    made = await api(`${base}/accounts`, {
      email,
      displayName: "Thư ký sổ synthetic",
      role: "secretary",
      scope: { kind: "church" },
    });
  assert(made.status === 201, "secretary-created");
  secrets.push(userPassword, made.payload.data.temporaryCredential.password);
  const userPage = await context.newPage();
  await userPage.goto(`${conf.origin}/h/${church.code}/login`);
  await userPage.getByLabel("Email", { exact: true }).fill(email);
  await userPage
    .getByLabel("Mật khẩu", { exact: true })
    .fill(made.payload.data.temporaryCredential.password);
  await userPage.getByRole("button", { name: "Đăng nhập", exact: true }).click();
  await userPage.getByLabel("Mật khẩu mới", { exact: true }).fill(userPassword);
  await userPage.getByLabel("Nhập lại mật khẩu", { exact: true }).fill(userPassword);
  await userPage.getByRole("button", { name: "Lưu mật khẩu", exact: true }).click();
  await userPage.getByRole("heading", { name: "Đăng nhập", exact: true }).waitFor();
  await userPage.getByLabel("Mật khẩu", { exact: true }).fill(userPassword);
  await userPage.getByRole("button", { name: "Đăng nhập", exact: true }).click();
  await userPage
    .getByRole("navigation")
    .getByRole("button", { name: /^Sổ lễ nghi/ })
    .waitFor();
  await userPage.goto(`${conf.origin}/h/${church.code}/rites?tab=com&riteId=${communionId}`);
  await userPage.getByRole("heading", { name: "Chi tiết Tiệc Thánh", exact: true }).waitFor();
  await userPage.getByRole("button", { name: "Sửa / đính chính", exact: true }).click();
  await userPage.getByLabel("Ghi chú", { exact: true }).fill("Thư ký đính chính synthetic");
  await userPage.getByLabel("Lý do", { exact: true }).fill("Ghi rõ sự kiện synthetic");
  await userPage.getByRole("button", { name: "Xem trước xác nhận", exact: true }).click();
  await userPage.getByLabel("Tôi xác nhận sự kiện và thông tin trước/sau").check();
  await userPage.getByRole("button", { name: "Xác nhận", exact: true }).click();
  await userPage.getByRole("dialog").waitFor({ state: "hidden" });
  assert(
    (
      await api(
        `churches/${church.id}/rites/records/${communionId}`,
        undefined,
        undefined,
        "church",
        userPage,
      )
    ).payload.data.record.note === "Thư ký đính chính synthetic",
    "secretary-confirms-factual-record",
  );
  await capture("secretary-communion", userPage);
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
        engine: "Firefox Playwright",
        bundleIndexSha256: new Bun.CryptoHasher("sha256")
          .update(await Bun.file("dist/index.html").arrayBuffer())
          .digest("hex"),
        limits: [
          "Local/synthetic/private CA",
          "Physical camera/paper/Safari/UAT/production/multi-replica NOT_RUN",
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
