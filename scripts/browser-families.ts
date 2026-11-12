import { readFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { request as httpsRequest } from "node:https";
import { firefox } from "@playwright/test";
import { ObjectId } from "mongodb";
import { createApp } from "../api/app";
import type { Config } from "../api/config";
import { OwnerOperations } from "../api/identity/owner-operations";
import { Identity } from "../api/identity/service";
import { Database, initialize } from "../api/infrastructure/database";
import { RateLimit } from "../api/infrastructure/rate-limit";
import { localTls } from "./local-tls";

const evidence = process.env.CHURCH_EVIDENCE_DIR ?? "output/p2.3";
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
  database: `church_cms_test_browser_p23_${crypto.randomUUID().replaceAll("-", "")}`,
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
        const groups = Array.from(document.querySelectorAll(".family-section")).filter(visible);
        const gaps = groups.slice(1).flatMap((g, i) => {
          const before = groups[i] as Element;
          return before.parentElement === g.parentElement
            ? [g.getBoundingClientRect().top - before.getBoundingClientRect().bottom]
            : [];
        });
        const groupSpacing = groups.map((g) => parseFloat(getComputedStyle(g).rowGap));
        const cards = Array.from(document.querySelectorAll(".family-card")).filter(visible);
        const cardHeaderSpacing = cards.flatMap((card) => {
          const header = card.querySelector(".card-h"),
            body = card.querySelector(".family-section");
          return header && body
            ? [body.getBoundingClientRect().top - header.getBoundingClientRect().bottom]
            : [];
        });
        const scrollers = Array.from(
          document.querySelectorAll<HTMLElement>("dialog[open] .tbl-wrap"),
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
        const toolbar = document.querySelector(".members-section .toolbar"),
          table = document.querySelector(".members-section .tbl-wrap");
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
      assert(
        layout.groupSpacing.every((g) => g >= 17.5) &&
          layout.cardHeaderSpacing.length === layout.cardCount &&
          layout.cardHeaderSpacing.every((g) => g >= 11.5),
        `${name}-${theme}-${width}-groups18-card-heading12`,
      );
      assert(layout.reachable, `${name}-${theme}-${width}-table-last-column-reachable`);
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
      await api("owner/churches", { name: "Hội Thánh P2.3 — synthetic", province: "Đà Nẵng" })
    ).payload.data.church,
    base = `owner/churches/${church.id}`,
    families = `${base}/families`,
    members = `${base}/members`;
  await api(`${base}/organization/settings`, { unitType: "area", defaultAssignmentMode: "auto" });
  const area = (await api(`${base}/organization/units`, { kind: "area", name: "Khu vực An Bình" }))
      .payload.data.unit,
    area2 = (await api(`${base}/organization/units`, { kind: "area", name: "Khu vực Hy Vọng" }))
      .payload.data.unit;
  await page.goto(`${conf.origin}/owner/churches/${church.id}`);
  await page.getByRole("main").getByRole("button", { name: "Gia đình", exact: true }).click();
  await page.getByText("Chưa có gia đình trong Hội Thánh này.", { exact: true }).waitFor();
  assert(page.url().endsWith("/families"), "O02-families-route");
  await capture("w03-empty");
  await page.getByRole("button", { name: "Thêm gia đình", exact: true }).click();
  let dialog = page.getByRole("dialog", { name: "Thêm gia đình", exact: true });
  await dialog.getByLabel("Tên gia đình", { exact: true }).fill("Gia đình An synthetic");
  await dialog.getByLabel("Khu vực", { exact: true }).selectOption(area.id);
  await dialog.getByLabel("Địa chỉ", { exact: true }).fill("01 đường synthetic");
  await capture("w03-create-unknown-year");
  await dialog.getByRole("button", { name: "Lưu gia đình", exact: true }).focus();
  await page.keyboard.press("Tab");
  assert(
    await dialog
      .getByRole("button", { name: "Đóng", exact: true })
      .evaluate((e) => e === document.activeElement),
    "family-modal-focus-trap",
  );
  await dialog.getByRole("button", { name: "Lưu gia đình", exact: true }).click();
  await dialog.waitFor({ state: "hidden" });
  let drawer = page.getByRole("dialog", { name: /^Gia đình GD-/ });
  await drawer.waitFor();
  assert(await drawer.getByText("Chưa rõ", { exact: true }).isVisible(), "sinceYear-not-createdAt");
  const source = (await api(`${families}?view=cards`)).payload.data.items[0];
  await drawer.getByRole("button", { name: "Đóng", exact: true }).click();
  const options = (await api(`${members}/options`)).payload.data,
    body = (fullName: string, extra: object = {}) => ({
      fullName,
      gender: "unknown",
      birthDate: null,
      phone: "0900123456",
      type: "believer",
      membership: "member",
      householdRole: "other",
      baptism: { status: "unknown", date: null, place: null },
      visitor: null,
      family: { kind: "existing", id: source.id },
      assignment: { mode: "auto", unitIds: [] },
      assignmentContext: { settingsVersion: options.settings.version, asOfDate: options.asOfDate },
      consent: true,
      ...extra,
    });
  const people = [] as { id: string; fullName: string }[];
  for (const [name, role] of [
    ["Nguyễn An synthetic", "head"],
    ["Trần Lan synthetic", "child"],
    ["Trần Minh synthetic", "other"],
    ["Historical synthetic", "relative"],
  ]) {
    const made = await api(members, body(name as string, { householdRole: role }));
    assert(made.status === 201, `seed-member-${people.length}`);
    people.push({ id: made.payload.data.member.id, fullName: name as string });
  }
  const historical = people[3] as { id: string };
  await api(
    `${members}/${historical.id}/participation`,
    {
      status: "deceased",
      eventDate: null,
      reason: "Synthetic history",
      effectiveOn: options.asOfDate,
    },
    1,
  );
  await page.reload();
  await page.getByRole("button", { name: `Chi tiết ${source.code}`, exact: true }).waitFor();
  await capture("w03-cards");
  await page.getByRole("button", { name: `Chi tiết ${source.code}`, exact: true }).click();
  drawer = page.getByRole("dialog", { name: `Gia đình ${source.code}`, exact: true });
  await drawer.waitFor();
  await drawer.getByRole("button", { name: "Lịch sử và liên kết hộ", exact: true }).click();
  await drawer.getByText("Thêm thành viên", { exact: true }).first().waitFor();
  await capture("w03-detail-history");
  // Change head through an actual preview and atomic command.
  await drawer.getByRole("button", { name: "Đổi chủ hộ / vai trò", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "Đổi chủ hộ / vai trò", exact: true });
  await dialog
    .getByLabel("Vai trò của Nguyễn An synthetic", { exact: true })
    .selectOption("spouse");
  await dialog.getByLabel("Vai trò của Trần Lan synthetic", { exact: true }).selectOption("head");
  await dialog.getByLabel("Lý do", { exact: true }).fill("Đổi chủ hộ synthetic");
  await dialog.getByRole("button", { name: "Xem trước", exact: true }).click();
  const preview = page.getByRole("dialog", { name: "Xem trước thay đổi gia đình", exact: true });
  await preview.waitFor();
  await capture("w03-head-preview");
  await preview.getByRole("button", { name: "Xác nhận thay đổi", exact: true }).click();
  await preview.waitFor({ state: "hidden" });
  await drawer
    .locator(".ui-kv-row")
    .filter({ has: page.locator("dt").filter({ hasText: /^Chủ hộ$/ }) })
    .getByText("Trần Lan synthetic", { exact: true })
    .waitFor();
  assert(true, "head-swap-canonical-readback");
  // Area change has a preview; no member assignment is rewritten.
  await drawer.getByRole("button", { name: "Sửa hộ", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "Sửa hộ", exact: true });
  await dialog.getByLabel("Khu vực", { exact: true }).selectOption(area2.id);
  await dialog.getByLabel("Lý do", { exact: true }).fill("Đổi khu vực synthetic");
  await dialog.getByRole("button", { name: "Xem trước", exact: true }).click();
  await preview.waitFor();
  await preview.getByText(/4 hồ sơ đọc theo khu vực mới/).waitFor();
  await preview.getByRole("button", { name: "Xác nhận thay đổi", exact: true }).click();
  await preview.waitFor({ state: "hidden" });
  await drawer.getByText("Khu vực Hy Vọng", { exact: true }).waitFor();
  assert(true, "area-change-derived-for-all-members");
  // Split two selected members into a new household.
  await drawer.getByRole("button", { name: "Tách hộ", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "Tách hộ", exact: true });
  await dialog.getByLabel("Tên gia đình", { exact: true }).fill("Gia đình mới synthetic");
  await dialog.getByLabel("Chuyển Trần Lan synthetic", { exact: true }).check();
  await dialog.getByLabel("Chuyển Trần Minh synthetic", { exact: true }).check();
  await dialog
    .getByLabel("Vai trò của Trần Minh synthetic", { exact: true })
    .selectOption("spouse");
  await dialog.getByLabel("Lý do", { exact: true }).fill("Lập hộ riêng synthetic");
  await capture("w03-split-form");
  await dialog.getByRole("button", { name: "Xem trước", exact: true }).click();
  await preview.waitFor();
  await preview.getByText(/Đích: 0 → 2 hồ sơ/).waitFor();
  await capture("w03-split-preview");
  await preview.getByRole("button", { name: "Xác nhận thay đổi", exact: true }).click();
  await preview.waitFor({ state: "hidden" });
  const split = (await api(`${families}?view=cards&q=${encodeURIComponent("Gia đình mới")}`))
    .payload.data.items[0];
  assert(!!split && split.id !== source.id, "split-new-code-real-family");
  drawer = page.getByRole("dialog", { name: `Gia đình ${split.code}`, exact: true });
  await drawer.waitFor();
  await drawer.getByRole("button", { name: "Lịch sử và liên kết hộ", exact: true }).click();
  await drawer.getByRole("button", { name: source.code, exact: true }).click();
  drawer = page.getByRole("dialog", { name: `Gia đình ${source.code}`, exact: true });
  await drawer.waitFor();
  assert(
    await drawer.getByText("Chưa có chủ hộ", { exact: true }).isVisible(),
    "split-no-inferred-source-head",
  );
  // Move a historical profile; its participation must remain unchanged.
  await drawer.getByRole("button", { name: "Chuyển người", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "Chuyển người", exact: true });
  await dialog.getByLabel("Gia đình có sẵn", { exact: true }).selectOption(split.id);
  await dialog.getByLabel("Chuyển Historical synthetic", { exact: true }).check();
  await dialog.getByLabel("Lý do", { exact: true }).fill("Chuyển hồ sơ lịch sử synthetic");
  await dialog.getByRole("button", { name: "Xem trước", exact: true }).click();
  await preview.waitFor();
  await preview.getByRole("button", { name: "Xác nhận thay đổi", exact: true }).click();
  await preview.waitFor({ state: "hidden" });
  assert(
    (await api(`${members}/${historical.id}`)).payload.data.participation === "deceased",
    "transfer-retains-historical-participation",
  );
  drawer = page.getByRole("dialog", { name: `Gia đình ${split.code}`, exact: true });
  await drawer.waitFor();
  await drawer.getByRole("button", { name: "Đóng", exact: true }).click();
  // Merge all remaining source profiles, retaining the source ID/code/link.
  await page.getByRole("button", { name: `Chi tiết ${source.code}`, exact: true }).click();
  drawer = page.getByRole("dialog", { name: `Gia đình ${source.code}`, exact: true });
  await drawer.getByRole("button", { name: "Gộp hộ", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "Gộp hộ", exact: true });
  await dialog.getByLabel("Gia đình có sẵn", { exact: true }).selectOption(split.id);
  await dialog.getByLabel("Lý do", { exact: true }).fill("Gộp hộ synthetic");
  await dialog.getByRole("button", { name: "Xem trước", exact: true }).click();
  await preview.waitFor();
  await capture("w03-merge-preview");
  await preview.getByRole("button", { name: "Xác nhận thay đổi", exact: true }).click();
  await preview.waitFor({ state: "hidden" });
  drawer = page.getByRole("dialog", { name: `Gia đình ${split.code}`, exact: true });
  await drawer.waitFor();
  await drawer.getByRole("button", { name: "Đóng", exact: true }).click();
  await page.getByLabel("Trạng thái hộ", { exact: true }).selectOption("merged");
  await page.getByRole("button", { name: `Chi tiết ${source.code}`, exact: true }).click();
  drawer = page.getByRole("dialog", { name: `Gia đình ${source.code}`, exact: true });
  await drawer.getByRole("button", { name: "Xem hộ đích", exact: true }).waitFor();
  assert(
    (await drawer.getByRole("button", { name: "Gộp hộ", exact: true }).count()) === 0,
    "merged-source-read-only",
  );
  await capture("w03-merged-source");
  await drawer.getByRole("button", { name: "Xem hộ đích", exact: true }).click();
  drawer = page.getByRole("dialog", { name: `Gia đình ${split.code}`, exact: true });
  await drawer.getByRole("button", { name: "Trần Minh synthetic", exact: true }).click();
  await page.getByRole("heading", { name: /Trần Minh synthetic · TH-/ }).waitFor();
  await page.getByRole("button", { name: `Xem gia đình ${split.code}`, exact: true }).click();
  await page.getByRole("dialog", { name: `Gia đình ${split.code}`, exact: true }).waitFor();
  assert(true, "W03-W14-family-cross-navigation");
  await page.getByRole("dialog").getByRole("button", { name: "Đóng", exact: true }).click();
  // Stale editor retains the draft and reloads before a new write.
  await page.getByLabel("Trạng thái hộ", { exact: true }).selectOption("active");
  await page.getByRole("button", { name: `Chi tiết ${split.code}`, exact: true }).click();
  drawer = page.getByRole("dialog", { name: `Gia đình ${split.code}`, exact: true });
  await drawer.getByRole("button", { name: "Sửa hộ", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "Sửa hộ", exact: true });
  await dialog.getByLabel("Tên gia đình", { exact: true }).fill("Draft stale synthetic");
  const old = (await api(`${families}/${split.id}`)).payload.data;
  assert(
    (await api(`${families}/${split.id}`, { name: "Bản mới synthetic" }, old.version)).status ===
      200,
    "other-tab-edits-family",
  );
  await dialog.getByRole("button", { name: "Lưu gia đình", exact: true }).click();
  await dialog.getByRole("button", { name: "Tải bản mới", exact: true }).waitFor();
  assert(
    (await dialog.getByLabel("Tên gia đình", { exact: true }).inputValue()) ===
      "Draft stale synthetic",
    "stale-family-draft-retained",
  );
  await dialog.getByRole("button", { name: "Tải bản mới", exact: true }).click();
  await page.waitForFunction(
    () =>
      document.querySelector<HTMLInputElement>("dialog[open].modal input")?.value ===
      "Bản mới synthetic",
  );
  await dialog.getByRole("button", { name: "Hủy", exact: true }).click();
  await drawer.getByRole("button", { name: "Đóng", exact: true }).click();
  // Bounded card pagination and member-name search.
  for (let i = 0; i < 13; i++)
    assert(
      (
        await api(families, {
          name: `Hộ paging ${i}`,
          address: null,
          notes: null,
          areaId: null,
          sinceYear: null,
        })
      ).status === 201,
      `seed-family-${i}`,
    );
  await page.reload();
  await page.getByRole("button", { name: "Xem thêm", exact: true }).waitFor();
  assert((await page.locator(".family-card").count()) === 12, "family-default-page12");
  await page.getByRole("button", { name: "Xem thêm", exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll(".family-card").length === 14);
  assert(true, "family-keyset-more14");
  await capture("w03-list-paged");
  await page.getByLabel("Tìm mã hộ, tên hộ hoặc thành viên", { exact: true }).fill("Trần Minh");
  await page.getByRole("button", { name: "Tìm", exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll(".family-card").length === 1);
  assert(true, "family-search-via-members-contract");
  // Lose the first response after a true commit, then reauth and explicitly replay.
  await page.getByRole("button", { name: "Thêm gia đình", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "Thêm gia đình", exact: true });
  await dialog.getByLabel("Tên gia đình", { exact: true }).fill("Hộ mất phản hồi synthetic");
  let complete = () => {};
  const forwarded = new Promise<void>((r) => {
    complete = r;
  });
  const keys: string[] = [];
  page.on("request", (r) => {
    if (r.method() === "POST" && r.url().endsWith(`/api/v1/${families}`))
      keys.push(r.headers()["idempotency-key"] ?? "");
  });
  await page.route(
    `**/api/v1/${families}`,
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
        forward.on("error", () => reject(new Error("Private-CA forwarding failed")));
        forward.end(req.postData());
      });
      assert(status === 201, "lost-response-real-family-commit");
      await route.abort("failed");
      complete();
    },
    { times: 1 },
  );
  await dialog.getByRole("button", { name: "Lưu gia đình", exact: true }).click();
  await forwarded;
  await dialog.getByRole("button", { name: "Kiểm tra kết quả", exact: true }).waitFor();
  await page.keyboard.press("Escape");
  assert(await dialog.isVisible(), "pending-family-blocks-Escape");
  await capture("w03-pending-family");
  await db.sessions.updateMany(
    { realm: "owner", revokedAt: { $exists: false } },
    { $set: { lastActivityAt: new Date(Date.now() - 16 * 60_000) } },
  );
  await dialog.getByRole("button", { name: "Kiểm tra kết quả", exact: true }).click();
  await page.getByRole("heading", { name: "Xác thực lại", exact: true }).waitFor();
  const beforeAuth = keys.length;
  await page.getByLabel("Mật khẩu", { exact: true }).fill(ownerPassword);
  await page.getByRole("button", { name: "Tiếp tục", exact: true }).click();
  await page.getByRole("button", { name: "Kiểm tra kết quả", exact: true }).waitFor();
  assert(keys.length === beforeAuth, "family-reauth-no-auto-replay");
  await page.getByRole("button", { name: "Kiểm tra kết quả", exact: true }).click();
  await page.getByRole("dialog", { name: /^Gia đình GD-/ }).waitFor();
  assert(new Set(keys).size === 1 && keys.length >= 2, "family-retry-preserves-key");
  assert(
    (await db.db
      .collection("families")
      .countDocuments({ churchId: new ObjectId(church.id), name: "Hộ mất phản hồi synthetic" })) ===
      1,
    "family-retry-one-record",
  );
  await page.getByRole("dialog").getByRole("button", { name: "Đóng", exact: true }).click();
  const userPage = await context.newPage();
  userPage.on("pageerror", (e) => errors.push(e.message));
  for (const role of ["secretary", "treasurer"]) {
    const account = (
        await api(`${base}/accounts`, {
          email: `${role}-${crypto.randomUUID()}@example.test`,
          displayName: `Synthetic ${role}`,
          role,
          scope: { kind: "church" },
        })
      ).payload.data,
      pw = `User 🕊 ${crypto.randomUUID()}`;
    secrets.push(pw, account.temporaryCredential.password);
    await userPage.goto(`${conf.origin}/h/${church.code}/login`);
    await userPage.getByLabel("Email", { exact: true }).fill(account.account.email);
    await userPage
      .getByLabel("Mật khẩu", { exact: true })
      .fill(account.temporaryCredential.password);
    await userPage.getByRole("button", { name: "Đăng nhập", exact: true }).click();
    await userPage.getByLabel("Mật khẩu mới", { exact: true }).fill(pw);
    await userPage.getByLabel("Nhập lại mật khẩu", { exact: true }).fill(pw);
    await userPage.getByRole("button", { name: "Lưu mật khẩu", exact: true }).click();
    await userPage.getByRole("heading", { name: "Đăng nhập", exact: true }).waitFor();
    await userPage.getByLabel("Mật khẩu", { exact: true }).fill(pw);
    await userPage.getByRole("button", { name: "Đăng nhập", exact: true }).click();
    await userPage
      .getByRole("heading", {
        name: role === "secretary" ? "Tổng quan" : "Thông tin truy cập",
        exact: true,
        level: 1,
      })
      .waitFor();
    if (role === "secretary") {
      await userPage
        .getByRole("navigation")
        .getByRole("button", { name: "Gia đình", exact: true })
        .click();
      await userPage.getByRole("button", { name: "Thêm gia đình", exact: true }).waitFor();
      await capture("w03-secretary", userPage);
      assert(
        (
          await api(
            `churches/${church.id}/families`,
            {
              name: "Hộ secretary synthetic",
              areaId: null,
              address: null,
              notes: null,
              sinceYear: null,
            },
            undefined,
            "church",
            userPage,
          )
        ).status === 201,
        "secretary-real-family-write",
      );
    } else {
      assert(
        (await userPage.getByRole("button", { name: "Gia đình", exact: true }).count()) === 0,
        "treasurer-no-family-menu",
      );
      await userPage.goto(`${conf.origin}/h/${church.code}/families`);
      await userPage
        .getByRole("alert")
        .filter({ hasText: "Bạn không có quyền xem gia đình Hội Thánh." })
        .waitFor();
      assert(
        (
          await api(
            `churches/${church.id}/families?view=cards`,
            undefined,
            undefined,
            "church",
            userPage,
          )
        ).status === 403,
        "treasurer-family-API-denied",
      );
      await capture("w03-denied", userPage);
    }
    await userPage.getByRole("button", { name: "Đăng xuất", exact: true }).click();
    await userPage.getByRole("heading", { name: "Đăng nhập", exact: true }).waitFor();
  }
  await userPage.close();
  assert((await api("owner/auth/me")).status === 200, "family-user-does-not-replace-owner");
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
          "Local synthetic, private CA",
          "Viewport emulation; physical devices/Safari/production NOT_RUN",
          "Forwarding trusts CA and loses response after real commit",
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
    JSON.stringify({ error: safe, errors, checks: result }, null, 2),
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
