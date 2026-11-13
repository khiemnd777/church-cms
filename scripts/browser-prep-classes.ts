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
import type { Member } from "../api/members/models";
import { localTls } from "./local-tls";
import { seedP2 } from "./p2-fixtures";

const evidence = process.env.CHURCH_EVIDENCE_DIR ?? "output/p3.3";
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
  database: `church_cms_test_browser_p33_${crypto.randomUUID().replaceAll("-", "")}`,
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
        const toolbar = document.querySelector(".prep-enrollment-content .toolbar"),
          table = document.querySelector(".prep-enrollment-content .tbl-wrap");
        const actions = document.querySelector(".attendance-card-actions"),
          progress = document.querySelector(".ui-attendance-track");
        const rows = Array.from(
          document.querySelectorAll<HTMLElement>(".attendance-person"),
        ).filter(visible);
        // Source tabs scroll horizontally; P3.4 enables the five remaining tabs.
        const tablist = document.querySelector<HTMLElement>('[role="tablist"]');
        let tabScroll = true;
        if (tablist && tablist.scrollWidth > tablist.clientWidth) {
          const old = tablist.scrollLeft;
          tablist.scrollLeft = tablist.scrollWidth;
          const last = tablist.lastElementChild;
          tabScroll =
            !!last &&
            last.getBoundingClientRect().right <= tablist.getBoundingClientRect().right + 1;
          tablist.scrollLeft = old;
        }
        const tabLabel = (e: HTMLElement) =>
          e.matches(".tabs .tab") &&
          !!tablist &&
          tablist.getBoundingClientRect().right <= innerWidth + 1 &&
          tablist.getBoundingClientRect().left >= -1;
        return {
          tabScroll,
          attendanceRowWidths: rows.every(
            (row) =>
              Math.abs(
                row.getBoundingClientRect().width -
                  (row.querySelector(".att-item")?.getBoundingClientRect().width ?? 0),
              ) < 1,
          ),
          attendanceActionsGap:
            actions && progress && visible(actions)
              ? actions.getBoundingClientRect().top +
                parseFloat(getComputedStyle(actions).paddingTop) -
                progress.getBoundingClientRect().bottom
              : null,
          page: document.documentElement.scrollWidth <= innerWidth,
          scrollWidth: document.documentElement.scrollWidth,
          badControls: controls
            .filter(
              (e) =>
                !e.closest(".tbl-wrap") &&
                !tabLabel(e) &&
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
              tabLabel(e) ||
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
      assert(layout.tabScroll, `${name}-${theme}-${width}-source-tabs-scroll-reachable`);
      assert(layout.listLines, `${name}-${theme}-${width}-name-detail-separate-lines`);
      assert(layout.attendanceRowWidths, `${name}-${theme}-${width}-attendance-row-widths`);
      if (layout.attendanceActionsGap !== null)
        assert(
          layout.attendanceActionsGap >= 11.5,
          `${name}-${theme}-${width}-attendance-actions-gap12`,
        );
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
      new URL(req.url).pathname === "/__p33_source"
        ? new Response(sourceHtml, { headers: { "content-type": "text/html; charset=utf-8" } })
        : app(req, { ip: "browser-p33" }),
  });
  await mkdir(evidence, { recursive: true });
  const fixture = await new OwnerOperations(db).create({
      email: `class-${crypto.randomUUID()}@example.test`,
      displayName: "Owner synthetic P3.3",
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
      await api("owner/churches", { name: "Hội Thánh lớp dự bị synthetic", province: "Đà Nẵng" })
    ).payload.data.church,
    base = `owner/churches/${church.id}`,
    prefix = `${base}/prep-classes/courses`;
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
  await db.db.collection<Member>("members").updateMany(
    { churchId: new ObjectId(church.id) },
    {
      $set: {
        type: "believer",
        membership: "preparatory",
        participation: "active",
        baptism: { status: "not_baptized", date: null, place: null },
      },
    },
  );
  const members = await db.db
      .collection<Member>("members")
      .find({ churchId: new ObjectId(church.id) })
      .sort({ fullName: 1 })
      .toArray(),
    first = members[0],
    second = members[1],
    third = members[2];
  assert(first && second && third, "synthetic-students");
  await db.db
    .collection<Member>("members")
    .updateOne({ _id: first._id }, { $set: { "baptism.status": "unknown" } });
  await page.goto(`${conf.origin}/owner/churches/${church.id}/rites?tab=class`);
  await page.getByText("Chưa có khóa phù hợp.", { exact: true }).waitFor();
  assert((await page.getByRole("tab").count()) === 6, "W06-six-tabs-retained");
  assert(
    await page.getByRole("tab", { name: "Báp-têm", exact: true }).isEnabled(),
    "P34-tab-enabled-by-approved-plan",
  );
  await capture("classes-empty");
  await page.getByRole("button", { name: "Tạo khóa", exact: true }).click();
  let dialog = page.getByRole("dialog");
  await dialog.getByLabel("Tên khóa", { exact: true }).fill("Khóa dự bị synthetic r1");
  await dialog.getByLabel("Khai giảng", { exact: true }).fill(shiftDay(businessDay(), -14));
  await dialog.getByLabel("Giảng viên", { exact: true }).fill("Giảng viên synthetic");
  await dialog
    .getByLabel("Bài bắt buộc — mỗi dòng một bài", { exact: true })
    .fill("Bài một\nBài hai");
  await capture("class-create");
  await page.keyboard.press("Escape");
  assert(
    await page
      .getByRole("button", { name: "Tạo khóa", exact: true })
      .evaluate((e) => e === document.activeElement),
    "Escape-restores-create-trigger",
  );
  await page.getByRole("button", { name: "Tạo khóa", exact: true }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("Tên khóa", { exact: true }).fill("Khóa dự bị synthetic r1");
  await dialog.getByLabel("Khai giảng", { exact: true }).fill(shiftDay(businessDay(), -14));
  await dialog.getByLabel("Giảng viên", { exact: true }).fill("Giảng viên synthetic");
  await dialog
    .getByLabel("Bài bắt buộc — mỗi dòng một bài", { exact: true })
    .fill("Bài một\nBài hai");
  await dialog.getByRole("button", { name: "Lưu khóa", exact: true }).click();
  await page.getByRole("button", { name: "Bắt đầu khóa", exact: true }).waitFor();
  const id = new URL(page.url()).searchParams.get("courseId");
  assert(id, "created-course-in-URL");
  const path = `${prefix}/${id}`;
  async function enrollUI(person: { fullName: string }, unknown = false) {
    await page.getByRole("button", { name: "Ghi danh", exact: true }).click();
    const d = page.getByRole("dialog");
    await d.getByRole("button", { name: `Chọn ${person.fullName}`, exact: true }).click();
    if (unknown) {
      assert(
        await d.getByRole("button", { name: "Xác nhận ghi danh", exact: true }).isDisabled(),
        "unknown-baptism-needs-explicit-confirmation",
      );
      await d
        .getByLabel("Xác nhận cho ghi danh khi chưa rõ trạng thái Báp-têm", { exact: true })
        .check();
      await d
        .getByLabel("Lý do ghi danh", { exact: true })
        .fill("Đã đối chiếu hồ sơ chưa rõ — synthetic");
      await capture("class-enrollment-unknown");
    }
    await d.getByRole("button", { name: "Xác nhận ghi danh", exact: true }).click();
    await d.waitFor({ state: "hidden" });
    await page.getByRole("button", { name: person.fullName, exact: true }).waitFor();
  }
  await enrollUI(first, true);
  await enrollUI(second);
  await page.getByRole("button", { name: "Bắt đầu khóa", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByLabel("Lý do", { exact: true })
    .fill("Bắt đầu khóa synthetic");
  await page.getByRole("button", { name: "Xác nhận bắt đầu khóa", exact: true }).click();
  await page.getByRole("button", { name: "Đóng khóa", exact: true }).waitFor();
  await page.getByRole("button", { name: "Tạo buổi học", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Tạo buổi học", exact: true }).click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  await page.getByRole("button", { name: `Điểm danh ${businessDay()}`, exact: true }).click();
  await page.getByRole("button", { name: "Xem trước danh sách", exact: true }).click();
  await page.getByText(/2 người trong danh sách nguồn/).waitFor();
  assert(true, "class-roster-two-enrollments-not-eight-church-members");
  await page.getByRole("button", { name: "Xác nhận mở", exact: true }).click();
  await page
    .getByRole("button", { name: `${first.fullName} — Chưa ghi nhận`, exact: true })
    .click();
  await page.getByRole("button", { name: `${first.fullName} — Có mặt`, exact: true }).waitFor();
  const sid = new URL(page.url()).searchParams.get("sessionId");
  assert(sid, "class-attendance-selection");
  await page
    .getByRole("navigation")
    .getByRole("button", { name: /^Sổ lễ nghi/ })
    .click();
  await page.getByRole("table").waitFor();
  let row = page
    .getByRole("row")
    .filter({ has: page.getByRole("button", { name: first.fullName, exact: true }) });
  assert(
    await row.getByText("0/2", { exact: true }).isVisible(),
    "unclosed-session-excluded-from-progress",
  );
  await page.getByRole("button", { name: `Điểm danh ${businessDay()}`, exact: true }).click();
  await page.getByRole("button", { name: "Chốt buổi", exact: true }).click();
  await page.getByRole("button", { name: "Xác nhận chốt buổi", exact: true }).click();
  await page.getByRole("button", { name: "Mở lại", exact: true }).waitFor();
  await page
    .getByRole("navigation")
    .getByRole("button", { name: /^Sổ lễ nghi/ })
    .click();
  await page.getByRole("table").waitFor();
  row = page
    .getByRole("row")
    .filter({ has: page.getByRole("button", { name: first.fullName, exact: true }) });
  await row.getByText("1/2", { exact: true }).waitFor();
  let secondRow = page
    .getByRole("row")
    .filter({ has: page.getByRole("button", { name: second.fullName, exact: true }) });
  await secondRow.getByText("Cần học bù 1 bài", { exact: true }).waitFor();
  await capture("class-progress");
  // Compare retained W06 card/table styles against the approved local-font source.
  const source = await context.newPage();
  await source.goto(`${conf.origin}/__p33_source`);
  await source.locator('.nav-a[data-go="rites"]').click();
  await source.locator('[data-tab="class"]').click();
  const parity = [];
  for (const theme of ["light", "dark"] as const)
    for (const width of [1440, 390]) {
      const values = [];
      for (const target of [page, source]) {
        await target.emulateMedia({ colorScheme: theme });
        await target.setViewportSize({ width, height: 1000 });
        await target.evaluate(() => document.fonts.ready);
        values.push(
          await target.evaluate(() =>
            [".card", "table th", ".tabs .tab.on"].map((selector) => {
              const e = document.querySelector(selector);
              if (!e) throw new Error(`Missing ${selector}`);
              const c = getComputedStyle(e);
              return [c.backgroundColor, c.color, c.fontFamily, c.fontSize, c.borderRadius];
            }),
          ),
        );
      }
      assert(
        JSON.stringify(values[0]) === JSON.stringify(values[1]),
        `W06-source-style-parity-${theme}-${width}`,
      );
      parity.push({ theme, width, actual: values[0], reference: values[1] });
      await source.screenshot({
        path: `${evidence}/source-w06-${width}-${theme}.png`,
        fullPage: true,
      });
    }
  await source.close();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.emulateMedia({ colorScheme: "light" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("region", { name: "Danh sách học viên lớp dự bị", exact: true }).focus();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  const progressButton = page.getByRole("button", {
    name: `Tiến độ ${first.fullName}`,
    exact: true,
  });
  assert(
    await progressButton.evaluate((e) => e === document.activeElement),
    "mobile-table-Tab-reaches-progress-control",
  );
  assert(
    await progressButton.evaluate((e) => {
      const r = e.getBoundingClientRect(),
        frame = e.closest(".tbl-wrap")?.getBoundingClientRect();
      return !!frame && r.left >= frame.left - 1 && r.right <= frame.right + 1;
    }),
    "mobile-table-focus-scrolls-action-into-view",
  );
  await page.keyboard.press("Enter");
  await page.getByRole("dialog").waitFor();
  await page.keyboard.press("Escape");
  assert(
    await progressButton.evaluate((e) => e === document.activeElement),
    "progress-dialog-Escape-restores-table-action",
  );
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole("button", { name: "Học bù", exact: true }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel(new RegExp(`${second.fullName}.*Cần học bù`)).check();
  await capture("class-makeup-create");
  await dialog.getByRole("button", { name: "Tạo buổi học bù", exact: true }).click();
  await dialog.waitFor({ state: "hidden" });
  const makeupRow = page
    .locator(".li")
    .filter({ has: page.getByText("Bài một · Học bù", { exact: true }) });
  await makeupRow.getByRole("button", { name: `Điểm danh ${businessDay()}`, exact: true }).click();
  await page.getByRole("button", { name: "Xem trước danh sách", exact: true }).click();
  await page.getByText(/1 người trong danh sách nguồn/).waitFor();
  await page.getByRole("button", { name: "Xác nhận mở", exact: true }).click();
  await page
    .getByRole("button", { name: `${second.fullName} — Chưa ghi nhận`, exact: true })
    .click();
  await page.getByRole("button", { name: `${second.fullName} — Có mặt`, exact: true }).waitFor();
  await page.getByRole("button", { name: "Chốt buổi", exact: true }).click();
  await page.getByRole("button", { name: "Xác nhận chốt buổi", exact: true }).click();
  await page.getByRole("button", { name: "Mở lại", exact: true }).waitFor();
  await page
    .getByRole("navigation")
    .getByRole("button", { name: /^Sổ lễ nghi/ })
    .click();
  await page.getByRole("table").waitFor();
  secondRow = page
    .getByRole("row")
    .filter({ has: page.getByRole("button", { name: second.fullName, exact: true }) });
  await secondRow.getByText("1/2", { exact: true }).waitFor();
  assert(
    (await secondRow.getByText("Cần học bù 1 bài", { exact: true }).count()) === 0,
    "makeup-updates-progress-without-double-count",
  );
  const old = (
    await api(`${base}/attendance/sessions/${sid}/participants`)
  ).payload.data.items.find((p: { memberId: string }) => p.memberId === second._id.toHexString());
  assert(old.status === "absent", "original-absence-kept-after-makeup");
  await page.getByRole("button", { name: `Phỏng vấn ${first.fullName}`, exact: true }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("Người phỏng vấn", { exact: true }).fill("Mục sư synthetic");
  await dialog.getByLabel("Lý do", { exact: true }).fill("Ghi nhận phỏng vấn synthetic");
  await capture("class-interview");
  await dialog.getByRole("button", { name: "Xác nhận ghi nhận phỏng vấn", exact: true }).click();
  await dialog.waitFor({ state: "hidden" });
  await page.getByText(`Đã phỏng vấn · ${businessDay()}`, { exact: true }).waitFor();
  await page.getByRole("button", { name: "Sửa khóa", exact: true }).click();
  assert(
    await page
      .getByRole("dialog")
      .getByLabel("Bài bắt buộc — mỗi dòng một bài", { exact: true })
      .isDisabled(),
    "curriculum-locked-after-open",
  );
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: first.fullName, exact: true }).click();
  await page
    .getByRole("region", { name: "Lớp dự bị của thuộc viên" })
    .getByText("Khóa dự bị synthetic r1", { exact: true })
    .waitFor();
  await capture("member-class-link");
  await page.getByRole("button", { name: "Xem lớp", exact: true }).click();
  await page.getByRole("table").waitFor();
  assert(new URL(page.url()).searchParams.get("courseId") === id, "W14-to-W06-correct-course");
  const withdrawnRow = page
    .getByRole("row")
    .filter({ has: page.getByRole("button", { name: first.fullName, exact: true }) });
  await withdrawnRow.getByRole("button", { name: "Ngừng học", exact: true }).click();
  await page.getByRole("dialog").getByLabel("Lý do", { exact: true }).fill("Ngừng học synthetic");
  await page.getByRole("button", { name: "Xác nhận thay đổi ghi danh", exact: true }).click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  await withdrawnRow.getByRole("button", { name: "Khôi phục ghi danh", exact: true }).waitFor();
  await withdrawnRow
    .getByRole("button", { name: `Phỏng vấn ${first.fullName}`, exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByLabel("Ngày phỏng vấn", { exact: true })
    .fill(shiftDay(businessDay(), -20));
  await page
    .getByRole("dialog")
    .getByLabel("Lý do", { exact: true })
    .fill("Bổ sung sự kiện đã xảy ra trước khai giảng");
  await page.getByRole("button", { name: "Xác nhận ghi nhận phỏng vấn", exact: true }).click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  await withdrawnRow
    .getByText(`Đã phỏng vấn · ${shiftDay(businessDay(), -20)}`, { exact: true })
    .waitFor();
  assert(
    await withdrawnRow.getByRole("button", { name: "Khôi phục ghi danh", exact: true }).isEnabled(),
    "historical-interview-recorded-without-restoring-withdrawn-enrollment",
  );
  // Discard a genuinely committed enrollment response, then require explicit reconciliation.
  let discarded = false;
  await page.route(`**/${path}/enrollments`, async (route) => {
    if (route.request().method() !== "POST" || discarded) {
      await route.continue();
      return;
    }
    discarded = true;
    const r = route.request(),
      response = await app(
        new Request(r.url(), {
          method: r.method(),
          headers: await r.allHeaders(),
          body: r.postData(),
        }),
        { ip: "p33-lost-response" },
      );
    assert(response.status === 201, "lost-enrollment-response-committed");
    await response.arrayBuffer();
    await route.abort("failed");
  });
  await page.getByRole("button", { name: "Ghi danh", exact: true }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: `Chọn ${third.fullName}`, exact: true }).click();
  await dialog.getByRole("button", { name: "Xác nhận ghi danh", exact: true }).click();
  await page.getByRole("button", { name: "Kiểm tra kết quả lớp", exact: true }).waitFor();
  assert(
    await page.getByRole("button", { name: "Đăng xuất", exact: true }).isDisabled(),
    "pending-enrollment-locks-logout",
  );
  await capture("class-outcome-unknown");
  await page.getByRole("button", { name: "Kiểm tra kết quả lớp", exact: true }).click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  await page.getByRole("button", { name: third.fullName, exact: true }).waitFor();
  await page.unroute(`**/${path}/enrollments`);
  assert(
    (await api(path)).payload.data.enrollmentCount === 3,
    "same-enrollment-intent-replayed-once",
  );
  // Normal idle reauthentication preserves course context and never writes automatically.
  await db.sessions.updateMany(
    { realm: "owner", principalId: new ObjectId(fixture.employeeId), kind: "full" },
    { $set: { lastActivityAt: new Date(Date.now() - 16 * 60_000) } },
  );
  await page.reload();
  await page.getByRole("heading", { name: "Xác thực lại", exact: true }).waitFor();
  await page.getByLabel("Mật khẩu", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Tiếp tục", exact: true }).click();
  await page.getByRole("table").waitFor();
  assert(
    new URL(page.url()).searchParams.get("courseId") === id,
    "reauth-preserves-course-context",
  );
  await page.getByRole("button", { name: "Đóng khóa", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByLabel("Lý do", { exact: true })
    .fill("Đóng khóa với bài chưa diễn ra — synthetic");
  await page.getByRole("button", { name: "Xác nhận đóng khóa", exact: true }).click();
  await page.getByRole("button", { name: "Mở lại khóa", exact: true }).waitFor();
  assert(
    await page.getByRole("button", { name: "Ghi danh", exact: true }).isDisabled(),
    "closed-course-read-only",
  );
  await capture("class-closed");
  const memberAfter = await db.db.collection<Member>("members").findOne({ _id: first._id });
  assert(
    memberAfter?.baptism.status === "unknown" && memberAfter.membership === "preparatory",
    "no-auto-baptism-or-completion",
  );
  // Secretary can view/manage classes but receives no interview write control.
  const email = `secretary-${crypto.randomUUID()}@example.test`,
    userPassword = `User 🌿 ${crypto.randomUUID()}`,
    made = await api(`${base}/accounts`, {
      email,
      displayName: "Thư ký synthetic P3.3",
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
  await userPage.goto(`${conf.origin}/h/${church.code}/rites?tab=class&courseId=${id}`);
  await userPage.getByRole("table").waitFor();
  assert(
    (await userPage
      .getByRole("button", { name: `Phỏng vấn ${first.fullName}`, exact: true })
      .count()) === 0,
    "secretary-no-interview-write-control",
  );
  assert(
    new URL(userPage.url()).searchParams.get("courseId") === id &&
      new URL(userPage.url()).pathname.endsWith("/rites"),
    "church-realm-load-preserves-course-route",
  );
  await db.sessions.updateMany(
    { realm: "church", churchId: new ObjectId(church.id), kind: "full" },
    { $set: { lastActivityAt: new Date(Date.now() - 16 * 60_000) } },
  );
  await userPage.reload();
  await userPage.getByRole("heading", { name: "Xác thực lại", exact: true }).waitFor();
  await userPage.getByLabel("Mật khẩu", { exact: true }).fill(userPassword);
  await userPage.getByRole("button", { name: "Tiếp tục", exact: true }).click();
  await userPage.getByRole("table").waitFor();
  assert(
    new URL(userPage.url()).searchParams.get("courseId") === id &&
      new URL(userPage.url()).pathname.endsWith("/rites"),
    "church-reauth-preserves-course-route",
  );
  await capture("class-secretary", userPage);
  await userPage.close();
  assert(
    !JSON.stringify(logs).includes("Ghi nhận phỏng vấn synthetic"),
    "interview-change-reason-not-in-request-logs",
  );
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
          "Local synthetic/private CA",
          "No physical camera/paper/Safari/UAT/production",
          "No multi-replica proof",
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
