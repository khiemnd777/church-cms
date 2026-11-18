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
import type { ScheduleCommand } from "../api/scheduling/validation";
import { assertComposition } from "./browser-composition";
import { localTls } from "./local-tls";
import { SyntheticClient, seedP2, syntheticUser } from "./p2-fixtures";

const evidence = process.env.CHURCH_EVIDENCE_DIR ?? "output/p4.1";
// Only executed in the disposable browser container; CA trust is private to its Firefox profile.
if (process.platform !== "linux" || !process.env.CHURCH_BROWSER_CONTAINER)
  throw new Error("Use the isolated browser container");
const conf: Config = {
  cert: "/tmp/church-cert.pem",
  key: "/tmp/church-key.pem",
  origin: "https://localhost:3474",
  port: 3474,
  mongoUrl: "mongodb://host.docker.internal:27119/?replicaSet=church-local&directConnection=true",
  redisUrl: "redis://host.docker.internal:6391",
  database: `church_cms_test_browser_p41_${crypto.randomUUID().replaceAll("-", "")}`,
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
            'dialog[open] input:not([type="checkbox"]),dialog[open] select, main .toolbar input,main .toolbar select',
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
      new URL(req.url).pathname === "/__p41_source"
        ? new Response(sourceHtml, { headers: { "content-type": "text/html; charset=utf-8" } })
        : app(req, { ip: req.headers.get("x-synthetic-client") ?? "browser-p41" }),
  });
  await mkdir(evidence, { recursive: true });
  const fixture = await new OwnerOperations(db).create({
      email: `rite-${crypto.randomUUID()}@example.test`,
      displayName: "Owner synthetic P4.1",
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
      await api("owner/churches", { name: "Hội Thánh lịch synthetic", province: "Đà Nẵng" })
    ).payload.data.church,
    base = `owner/churches/${church.id}`,
    prefix = `${base}/scheduling/occurrences`;
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

  const day = shiftDay(businessDay(), 30),
    n = new Date(`${day}T00:00:00Z`).getUTCDay(),
    sunday = shiftDay(day, (7 - n) % 7);
  const make = (label: string): ScheduleCommand => ({
    input: {
      label,
      kind: "worship",
      scope: "church",
      unitId: null,
      day: sunday,
      startTime: "07:30",
      endDay: sunday,
      endTime: "09:00",
      location: "Nhà thờ synthetic",
      scripture: "Giăng 15:1–8",
      theme: "Đề tài synthetic",
      speaker: { source: "external", fullName: "Người giảng synthetic" },
      leaderId: null,
      choirId: null,
      communion: true,
      repeat: { kind: "weekly", interval: 1, weekdays: [0], until: shiftDay(sunday, 35) },
    },
    state: "scheduled",
    range: "one",
    reason: null,
    preview: null,
    conflictsConfirmed: false,
    exceptionsConfirmed: false,
  });
  const seed = make("Thờ phượng synthetic");
  const p = await api(`${prefix}/preview`, seed);
  assert(p.status === 200, "public-preview-seed");
  const made = await api(prefix, { ...seed, preview: p.payload.data.context });
  assert(made.status === 201, "public-create-six-sundays");
  const first = (await api(`${prefix}?from=${sunday}&to=${shiftDay(sunday, 41)}`)).payload.data
    .items[0];
  const target = `${conf.origin}/owner/churches/${church.id}/worship?from=${sunday}&week=${sunday}`;
  await page.goto(target);
  await page.getByRole("button", { name: "Chi tiết Thờ phượng synthetic" }).first().waitFor();
  assert(
    (await page
      .getByRole("region", { name: "Phân công sáu Chúa nhật" })
      .getByRole("table")
      .locator("tbody tr")
      .count()) === 6,
    "six-calendar-sundays",
  );
  assert(
    await page.getByRole("button", { name: /Thờ phượng & Lịch giảng/ }).isVisible(),
    "visible-menu-text",
  );
  await capture("owner-w07");
  const source = await context.newPage();
  await source.goto(`${conf.origin}/__p41_source`);
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
            ["table th", ".pill.p-gold"].map((sel) => {
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
  await page.getByRole("button", { name: "Tạo lịch", exact: true }).click();
  await page.getByRole("dialog").waitFor();
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press(i % 2 ? "Shift+Tab" : "Tab");
    assert(
      await page.evaluate(() => !!document.activeElement?.closest("dialog[open]")),
      `dialog-keyboard-focus-contained-${i}`,
    );
  }
  await page.getByLabel("Tên lịch", { exact: true }).fill("Sinh hoạt mới synthetic");
  await page.getByLabel("Ngày bắt đầu", { exact: true }).fill(sunday);
  await page.getByLabel("Ngày kết thúc", { exact: true }).fill(sunday);
  await page.getByRole("button", { name: "Xem trước", exact: true }).click();
  await page.getByRole("heading", { name: "Xác nhận thay đổi", exact: true }).waitFor();
  await capture("create-preview");
  await page.getByRole("button", { name: "Xác nhận lưu", exact: true }).click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  await page.getByRole("button", { name: "Chi tiết Sinh hoạt mới synthetic" }).first().waitFor();
  assert(true, "UI-create-through-preview-commit");
  await page.getByRole("button", { name: "Chi tiết Sinh hoạt mới synthetic" }).first().click();
  await page.getByRole("button", { name: "Sửa lịch", exact: true }).click();
  await page.getByLabel("Chủ đề", { exact: true }).fill("Chủ đề đã sửa synthetic");
  await page
    .getByLabel("Lý do thay đổi / xác nhận trùng giờ", { exact: true })
    .fill("Đính chính synthetic");
  await page.getByRole("button", { name: "Xem trước", exact: true }).click();
  await page.getByRole("heading", { name: "Xác nhận thay đổi", exact: true }).waitFor();
  await page.getByRole("button", { name: "Xác nhận lưu", exact: true }).click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  await page.getByRole("button", { name: "Chi tiết Sinh hoạt mới synthetic" }).first().click();
  await page.getByRole("button", { name: "Lịch sử", exact: true }).click();
  await page.getByText("Đính chính synthetic", { exact: false }).first().waitFor();
  await capture("owner-history");
  await page.getByRole("button", { name: "Đóng", exact: true }).click();
  await page.reload();
  await page.getByRole("button", { name: "Chi tiết Sinh hoạt mới synthetic" }).first().waitFor();
  assert(new URL(page.url()).searchParams.get("from") === sunday, "refresh-preserves-filter");
  await page.goto(
    `${conf.origin}/owner/churches/${church.id}/worship?from=${sunday}&week=${sunday}&occurrenceId=${first.id}`,
  );
  await page.getByRole("dialog").waitFor();
  assert(
    await page.getByRole("button", { name: "Sửa lịch", exact: true }).isVisible(),
    "deep-link-opens-occurrence",
  );
  await page.keyboard.press("Escape");
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  assert(true, "escape-closes-dialog");
  const userPage = await context.newPage();
  userPage.on("pageerror", (error) => errors.push(error.message));
  const transport = (req: Request) => {
    const h = new Headers(req.headers);
    h.set("x-synthetic-client", crypto.randomUUID());
    return fetch(new Request(req, { headers: h }), { tls: { ca: awaitCa } });
  };
  const awaitCa = await Bun.file(tls.ca).text();
  const ownerClient = new SyntheticClient("owner", conf.origin, transport);
  assert((await ownerClient.login(fixture.email, password)).status === 200, "fixture-owner-client");
  const secClient = new SyntheticClient("church", conf.origin, transport);
  const sec = await syntheticUser(ownerClient, secClient, church);
  secrets.push(sec.password);
  await userPage.goto(`${conf.origin}/h/${church.code}/login`);
  await userPage.getByLabel("Email", { exact: true }).fill(sec.email);
  await userPage.getByLabel("Mật khẩu", { exact: true }).fill(sec.password);
  await userPage.getByRole("button", { name: "Đăng nhập", exact: true }).click();
  await userPage.getByRole("button", { name: /Thờ phượng & Lịch giảng/ }).click();
  await userPage.goto(`${conf.origin}/h/${church.code}/worship?from=${sunday}&week=${sunday}`);
  await userPage.getByRole("button", { name: "Chi tiết Thờ phượng synthetic" }).first().waitFor();
  await capture("secretary-w07", userPage);
  assert(true, "church-realm-W07");
  // Real-commit response loss: browser receives a transport abort after the server committed.
  await userPage.route(`**/api/v1/churches/${church.id}/scheduling/occurrences`, async (route) => {
    if (route.request().method() === "POST") {
      await route.fetch();
      await route.abort("failed");
    } else await route.continue();
  });
  await userPage.getByRole("button", { name: "Tạo lịch", exact: true }).click();
  await userPage.getByLabel("Tên lịch", { exact: true }).fill("Mất phản hồi synthetic");
  await userPage.getByLabel("Ngày bắt đầu", { exact: true }).fill(sunday);
  await userPage.getByLabel("Ngày kết thúc", { exact: true }).fill(sunday);
  await userPage.getByRole("button", { name: "Xem trước", exact: true }).click();
  await userPage.getByRole("heading", { name: "Xác nhận thay đổi", exact: true }).waitFor();
  await userPage.getByRole("button", { name: "Xác nhận lưu", exact: true }).click();
  const reconcile = userPage
    .getByRole("dialog")
    .getByRole("button", { name: "Đối soát / thử lại cùng yêu cầu", exact: true });
  await reconcile.waitFor();
  await userPage.waitForFunction(() =>
    Array.from(document.querySelectorAll<HTMLButtonElement>("dialog[open] button")).some(
      (b) => b.textContent?.includes("Đối soát / thử lại cùng yêu cầu") && !b.disabled,
    ),
  );
  await userPage.unroute(`**/api/v1/churches/${church.id}/scheduling/occurrences`);
  await reconcile.click();
  await userPage.getByRole("dialog").waitFor({ state: "hidden" });
  assert(
    (await db.db.collection("schedule_occurrences").countDocuments({
      churchId: new ObjectId(church.id),
      "input.label": "Mất phản hồi synthetic",
    })) === 1,
    "lost-response-replay-single-occurrence",
  );
  await db.sessions.updateMany(
    { principalId: new ObjectId(sec.id) },
    { $set: { lastActivityAt: new Date(Date.now() - 16 * 60000) } },
  );
  await userPage.reload();
  await userPage.getByLabel("Mật khẩu", { exact: true }).waitFor();
  await userPage.getByLabel("Mật khẩu", { exact: true }).fill(sec.password);
  await userPage.getByRole("button", { name: "Tiếp tục", exact: true }).click();
  await userPage.getByRole("button", { name: "Chi tiết Thờ phượng synthetic" }).first().waitFor();
  assert(
    new URL(userPage.url()).searchParams.get("from") === sunday,
    "reauth-preserves-route-filter",
  );

  const unitMade = await ownerClient.call(`${base}/organization/units`, {
    kind: "service_ministry",
    name: "Ban UI synthetic",
  });
  assert(unitMade.status === 201, "public-unit-for-picker");
  const unitId = unitMade.payload.data.unit.id as string;
  const people = await ownerClient.call(`${base}/scheduling/people`);
  assert(
    people.status === 200 && people.payload.data.items.length > 0,
    "bounded-reduced-people-picker",
  );
  const person = people.payload.data.items[0];
  const assignment = {
    ...make("Lịch trùng synthetic"),
    input: {
      ...make("Lịch trùng synthetic").input,
      repeat: { kind: "once" as const },
      leaderId: person.id,
    },
  };
  const ap = await ownerClient.call(`${base}/scheduling/occurrences/preview`, assignment);
  assert(ap.status === 200, "conflict-fixture-preview");
  assert(
    (
      await ownerClient.call(`${base}/scheduling/occurrences`, {
        ...assignment,
        preview: ap.payload.data.context,
      })
    ).status === 201,
    "conflict-fixture-commit",
  );
  await page.goto(target);
  await page.getByRole("button", { name: "Tạo lịch", exact: true }).waitFor();
  await page.getByRole("button", { name: "Tạo lịch", exact: true }).click();
  await page.getByLabel("Tên lịch", { exact: true }).fill("Lịch ban UI synthetic");
  await page.getByLabel("Ngày bắt đầu", { exact: true }).fill(sunday);
  await page.getByLabel("Ngày kết thúc", { exact: true }).fill(sunday);
  await page.getByRole("dialog").getByLabel("Phạm vi", { exact: true }).selectOption("unit");
  await page.getByLabel("Đơn vị", { exact: true }).selectOption(unitId);
  await page.getByLabel("Người hướng dẫn", { exact: true }).selectOption(person.id);
  await page.getByLabel("Lặp", { exact: true }).selectOption("weekly");
  await page
    .getByRole("dialog")
    .getByLabel("Trạng thái", { exact: true })
    .selectOption("scheduled");
  await page.getByRole("button", { name: "Xem trước", exact: true }).click();
  await page.getByRole("heading", { name: "Xác nhận thay đổi", exact: true }).waitFor();
  assert(
    await page.getByText("Tạo chuỗi lịch", { exact: true }).isVisible(),
    "new-series-preview-names-whole-series",
  );
  assert(
    await page.getByRole("button", { name: "Xác nhận lưu", exact: true }).isDisabled(),
    "conflict-confirmation-disabled-before-human-acceptance",
  );
  await page.getByRole("button", { name: "Quay lại", exact: true }).click();
  await page
    .getByLabel("Lý do thay đổi / xác nhận trùng giờ", { exact: true })
    .fill("Phân công có chủ đích synthetic");
  await page.getByRole("button", { name: "Xem trước", exact: true }).click();
  await page.getByRole("heading", { name: "Xác nhận thay đổi", exact: true }).waitFor();
  await page
    .getByLabel("Tôi xác nhận tiếp tục với các xung đột đã hiển thị", { exact: true })
    .check();
  await capture("assignment-conflict-preview");
  await page.getByRole("button", { name: "Xác nhận lưu", exact: true }).click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  await page.getByRole("button", { name: "Chi tiết Lịch ban UI synthetic" }).first().waitFor();
  assert(true, "UI-unit-person-weekly-assignment-real-commit");
  await page.getByRole("button", { name: "Chi tiết Lịch ban UI synthetic" }).first().click();
  await page.getByRole("button", { name: "Sửa lịch", exact: true }).click();
  await page.getByLabel("Chủ đề", { exact: true }).fill("Ngoại lệ UI synthetic");
  await page
    .getByLabel("Lý do thay đổi / xác nhận trùng giờ", { exact: true })
    .fill("Chỉnh riêng synthetic");
  await page.getByRole("button", { name: "Xem trước", exact: true }).click();
  await page.getByRole("heading", { name: "Xác nhận thay đổi", exact: true }).waitFor();
  await page
    .getByLabel("Tôi xác nhận tiếp tục với các xung đột đã hiển thị", { exact: true })
    .check();
  await page.getByRole("button", { name: "Xác nhận lưu", exact: true }).click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  await page.getByRole("button", { name: "Chi tiết Lịch ban UI synthetic" }).first().click();
  await page.getByRole("button", { name: "Sửa lịch", exact: true }).click();
  await page.getByLabel("Áp dụng thay đổi", { exact: true }).selectOption("future");
  await page.getByLabel("Trạng thái", { exact: true }).last().selectOption("cancelled");
  await page
    .getByLabel("Lý do thay đổi / xác nhận trùng giờ", { exact: true })
    .fill("Hủy phần tương lai synthetic");
  await page.getByRole("button", { name: "Xem trước", exact: true }).click();
  await page.getByRole("heading", { name: "Xác nhận thay đổi", exact: true }).waitFor();
  assert(
    await page.getByRole("button", { name: "Xác nhận lưu", exact: true }).isDisabled(),
    "future-exception-needs-explicit-confirmation",
  );
  await page.getByLabel("Tôi xác nhận thay thế các lần đã chỉnh riêng", { exact: true }).check();
  await page.getByRole("button", { name: "Xác nhận lưu", exact: true }).click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  const ownUnit = {
    ...assignment,
    input: {
      ...assignment.input,
      label: "Lịch lead synthetic",
      scope: "unit" as const,
      unitId,
      leaderId: null,
    },
    state: "scheduled" as const,
  };
  const lp = await ownerClient.call(`${base}/scheduling/occurrences/preview`, ownUnit);
  assert(lp.status === 200, "lead-fixture-preview");
  assert(
    (
      await ownerClient.call(`${base}/scheduling/occurrences`, {
        ...ownUnit,
        preview: lp.payload.data.context,
      })
    ).status === 201,
    "lead-fixture-commit",
  );
  await api("auth/logout", {}, undefined, "church", userPage);
  const leadClient = new SyntheticClient("church", conf.origin, transport);
  const lead = await syntheticUser(ownerClient, leadClient, church, "ministry_lead", [unitId]);
  secrets.push(lead.password);
  await userPage.goto(`${conf.origin}/h/${church.code}/login`);
  await userPage.getByLabel("Email", { exact: true }).fill(lead.email);
  await userPage.getByLabel("Mật khẩu", { exact: true }).fill(lead.password);
  await userPage.getByRole("button", { name: "Đăng nhập", exact: true }).click();
  await userPage.getByRole("button", { name: /Thờ phượng & Lịch giảng/ }).waitFor();
  await userPage.goto(`${conf.origin}/h/${church.code}/worship?from=${sunday}&week=${sunday}`);
  await userPage.getByRole("button", { name: "Chi tiết Lịch lead synthetic" }).first().waitFor();
  assert(
    await userPage.getByRole("button", { name: "Tạo lịch", exact: true }).isDisabled(),
    "lead-read-only-create-disabled",
  );
  assert(
    (await userPage.getByRole("button", { name: "Chi tiết Thờ phượng synthetic" }).count()) === 0,
    "lead-no-churchwide-occurrences",
  );
  await capture("lead-scoped-w07", userPage);
  await userPage.getByRole("button", { name: "Chi tiết Lịch lead synthetic" }).first().click();
  await userPage.getByRole("dialog").waitFor();
  assert(
    (await userPage.getByRole("button", { name: "Sửa lịch", exact: true }).count()) === 0 &&
      (await userPage.getByRole("button", { name: "Lịch sử", exact: true }).count()) === 0,
    "lead-no-management-history-controls",
  );
  await userPage.keyboard.press("Escape");
  await userPage.close();
  await page.goto(`${conf.origin}/owner/churches/${church.id}/overview`);
  await page.getByRole("button", { name: "Lịch giảng & sinh hoạt", exact: true }).click();
  await page.getByRole("heading", { name: "Phân công sáu Chúa nhật", exact: true }).waitFor();
  assert(new URL(page.url()).pathname.endsWith("/worship"), "W01-opens-real-W07");
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
          "Safari/physical/UAT/production/multi-replica NOT_RUN",
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
