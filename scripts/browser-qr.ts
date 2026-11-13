import { mkdir } from "node:fs/promises";
import { firefox } from "@playwright/test";
import { ObjectId } from "mongodb";
import { createApp } from "../api/app";
import type { Config } from "../api/config";
import { OwnerOperations } from "../api/identity/owner-operations";
import { Identity } from "../api/identity/service";
import { Database, initialize } from "../api/infrastructure/database";
import { RateLimit } from "../api/infrastructure/rate-limit";
import { businessDay } from "../api/members/dates";
import { localTls } from "./local-tls";
import { seedP2 } from "./p2-fixtures";

const evidence = process.env.CHURCH_EVIDENCE_DIR ?? "output/p3.2";
// Only executed in the disposable browser container; CA trust is private to its Firefox profile.
if (process.platform !== "linux" || !process.env.CHURCH_BROWSER_CONTAINER)
  throw new Error("Use the isolated browser container");
const conf: Config = {
  cert: "/tmp/church-cert.pem",
  key: "/tmp/church-key.pem",
  origin: "https://localhost:3464",
  port: 3464,
  mongoUrl: "mongodb://host.docker.internal:27119/?replicaSet=church-local&directConnection=true",
  redisUrl: "redis://host.docker.internal:6391",
  database: `church_cms_test_browser_p32_${crypto.randomUUID().replaceAll("-", "")}`,
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
        const actions = document.querySelector(".attendance-card-actions"),
          progress = document.querySelector(".ui-attendance-track");
        const rows = Array.from(
          document.querySelectorAll<HTMLElement>(".attendance-person"),
        ).filter(visible);
        return {
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
  server = Bun.serve({
    hostname: "127.0.0.1",
    port: conf.port,
    tls: { cert: Bun.file(conf.cert), key: Bun.file(conf.key) },
    fetch: (req) => app(req, { ip: "browser-p32" }),
  });
  await mkdir(evidence, { recursive: true });
  const fixture = await new OwnerOperations(db).create({
      email: `qr-${crypto.randomUUID()}@example.test`,
      displayName: "Owner synthetic P3.2",
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
      await api("owner/churches", { name: "Hội Thánh QR synthetic", province: "Đà Nẵng" })
    ).payload.data.church,
    base = `owner/churches/${church.id}`;
  assert(
    (
      await api(`${base}/organization/settings`, {
        unitType: "area",
        defaultAssignmentMode: "auto",
      })
    ).status === 201,
    "configured-synthetic-church",
  );
  await seedP2(db, church.id, fixture.employeeId, 8);
  await db.db
    .collection("members")
    .updateMany({ churchId: new ObjectId(church.id) }, { $set: { participation: "active" } });
  const member = await db.db
    .collection("members")
    .findOne({ churchId: new ObjectId(church.id), fullName: "Nguyễn synthetic 00000" });
  assert(member, "synthetic-member");
  await page.goto(`${conf.origin}/owner/churches/${church.id}/members?memberId=${member._id}`);
  await page.getByRole("button", { name: "Cấp thẻ", exact: true }).waitFor();
  await capture("card-before-issue");
  await page.getByRole("button", { name: "Cấp thẻ", exact: true }).click();
  await page.getByRole("button", { name: "In thẻ", exact: true }).waitFor();
  await capture("card-active");
  const card = (await api(`${base}/members/${member._id}/card`)).payload.data.card,
    image = (await api(`${base}/cards/${card.id}/render`)).payload.data;
  assert(/^QLHT1:[A-Za-z0-9_-]{43}$/.test(image.payload), "opaque-qr-format");
  const popupPromise = page.waitForEvent("popup");
  await page.getByRole("button", { name: "In thẻ", exact: true }).click();
  const print = await popupPromise;
  await print.waitForLoadState();
  assert(
    (await print.getByRole("button", { name: "In thẻ", exact: true }).count()) === 1,
    "protected-print-page",
  );
  await print.emulateMedia({ media: "print" });
  const printGeometry = await print.locator(".ui-member-card").evaluate((e) => ({
    width: e.getBoundingClientRect().width,
    height: e.getBoundingClientRect().height,
    text: e.textContent,
    background: getComputedStyle(e).backgroundColor,
    color: getComputedStyle(e).color,
  }));
  assert(
    Math.abs(printGeometry.width - (86 * 96) / 25.4) < 1 &&
      Math.abs(printGeometry.height - (54 * 96) / 25.4) < 1,
    "print-css-86x54mm",
  );
  assert(
    printGeometry.background === "rgb(255, 255, 255)" && printGeometry.color === "rgb(0, 0, 0)",
    "print-ink-paper-colors",
  );
  await print.screenshot({ path: `${evidence}/card-print-layout.png` });
  await print.locator(".ui-member-card").screenshot({ path: `${evidence}/card-print.png` });
  // The same layout accepts maximum-length names without silently clipping text.
  const longLayout = await print.locator(".ui-member-card").evaluate((e) => {
    e.classList.add("ui-member-card-long");
    const bold = e.querySelectorAll("strong");
    if (bold[0]) bold[0].textContent = "Hội Thánh ".repeat(20);
    if (bold[1]) bold[1].textContent = "Nguyễn Văn ".repeat(20);
    const body = e.querySelector(".ui-member-card-body"),
      copy = body?.firstElementChild;
    return (
      !!body &&
      !!copy &&
      copy.getBoundingClientRect().bottom <= e.getBoundingClientRect().bottom &&
      copy.scrollHeight <= copy.clientHeight + 1 &&
      e.scrollHeight <= e.clientHeight + 1
    );
  });
  assert(longLayout, "print-maximum-name-layout-no-clipping");
  await print.close();
  await page.getByRole("button", { name: "Thay thẻ", exact: true }).click();
  const dialog = page.getByRole("dialog").last();
  await dialog.getByLabel("Lý do", { exact: true }).fill("Mất thẻ — synthetic");
  await capture("card-replace-confirm");
  await dialog.getByRole("button", { name: "Xác nhận thay thẻ", exact: true }).click();
  await page
    .getByRole("button", { name: "Xác nhận thay thẻ", exact: true })
    .waitFor({ state: "hidden" });
  await page.getByText("Đang hiệu lực · Phiên bản 2", { exact: true }).waitFor();
  assert(
    (await api(`${base}/cards/${card.id}/render?version=1`)).status === 412,
    "stale-print-revision-denied",
  );
  let currentImage = (await api(`${base}/cards/${card.id}/render`)).payload.data;
  await page.getByRole("button", { name: "Lịch sử thẻ", exact: true }).click();
  await page.locator(".member-history details summary").first().click();
  await page
    .locator("p")
    .filter({ hasText: /^Mất thẻ — synthetic$/ })
    .waitFor();
  await db.sessions.updateMany(
    { realm: "owner", principalId: new ObjectId(fixture.employeeId), kind: "full" },
    { $set: { lastActivityAt: new Date(Date.now() - 16 * 60_000) } },
  );
  await page.getByRole("button", { name: "Thay thẻ", exact: true }).click();
  await page
    .getByRole("dialog")
    .last()
    .getByLabel("Lý do", { exact: true })
    .fill("Thay sau xác thực — synthetic");
  await page.getByRole("button", { name: "Xác nhận thay thẻ", exact: true }).click();
  await page.getByRole("heading", { name: "Xác thực lại", exact: true }).waitFor();
  await page.getByLabel("Mật khẩu", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Tiếp tục", exact: true }).click();
  await page.getByRole("button", { name: "Kiểm tra kết quả thẻ", exact: true }).waitFor();
  assert(
    (await api(`${base}/members/${member._id}/card`)).payload.data.card.version === 2,
    "reauth-preserves-card-intent-without-auto-replay",
  );
  await page.getByRole("button", { name: "Kiểm tra kết quả thẻ", exact: true }).click();
  await page.getByText("Đang hiệu lực · Phiên bản 3", { exact: true }).waitFor();
  assert(
    (await api(`${base}/cards/${card.id}/history`)).payload.data.items.length === 3,
    "card-explicit-replay-after-reauth-once",
  );
  currentImage = (await api(`${base}/cards/${card.id}/render`)).payload.data;
  // The browser fixture supplies real canvas frames to the real decoder/worker. No physical camera evidence.
  const created = await api(`${base}/attendance/sessions`, {
      label: "Buổi QR synthetic",
      heldOn: businessDay(),
      location: null,
      scope: "church",
      unitId: null,
    }),
    sid = created.payload.data.sessionId,
    path = `${base}/attendance/sessions/${sid}`;
  const preview = (await api(`${path}/candidates`)).payload.data;
  assert(
    (await api(`${path}/open`, { previewToken: preview.previewToken }, 1, "owner", page, "POST"))
      .status === 200,
    "open-qr-session",
  );
  await page.goto(`${conf.origin}/owner/churches/${church.id}/attendance?sessionId=${sid}`);
  await page.getByRole("button", { name: "Quét QR", exact: true }).waitFor();
  const requests: string[] = [];
  page.on("request", (r) => requests.push(`${r.method()} ${new URL(r.url()).pathname}`));
  await page.evaluate(
    ({ svg }) => {
      const state = {
        streams: [] as MediaStream[],
        calls: 0,
        deny: false,
        delay: false,
        release: null as null | (() => void),
        svg,
        lastConstraints: null as MediaStreamConstraints | null,
      };
      (window as unknown as { qrFixture: typeof state }).qrFixture = state;
      Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
        configurable: true,
        value: async (constraints: MediaStreamConstraints) => {
          state.calls++;
          state.lastConstraints = constraints;
          if (state.deny) throw new DOMException("Denied", "NotAllowedError");
          const canvas = document.createElement("canvas");
          canvas.width = 640;
          canvas.height = 480;
          const ctx = canvas.getContext("2d");
          if (!ctx) throw new Error("Canvas context unavailable");
          const image = new Image();
          image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(state.svg)}`;
          await image.decode();
          const draw = () => {
            ctx.fillStyle = "white";
            ctx.fillRect(0, 0, 640, 480);
            ctx.drawImage(image, 100, 20, 440, 440);
          };
          draw();
          const stream = canvas.captureStream(12);
          state.streams.push(stream);
          const timer = setInterval(draw, 80);
          stream.getTracks().forEach((t) => {
            const old = t.stop.bind(t);
            t.stop = () => {
              clearInterval(timer);
              old();
            };
          });
          if (state.delay)
            await new Promise<void>((r) => {
              state.release = r;
            });
          return stream;
        },
      });
    },
    { svg: currentImage.svg },
  );
  await page.getByRole("button", { name: "Quét QR", exact: true }).click();
  await page.getByRole("button", { name: "Bật camera", exact: true }).waitFor();
  assert(
    (await page.evaluate(
      () => (window as unknown as { qrFixture: { calls: number } }).qrFixture.calls,
    )) === 0,
    "camera-explicit-opt-in-only",
  );
  await capture("qr-ready");
  await page.getByRole("button", { name: "Bật camera", exact: true }).click();
  await page
    .getByText(
      `${member.fullName} · ${member.code}: đã ghi nhận có mặt. Người đã có mặt được giữ nguyên.`,
      { exact: true },
    )
    .waitFor({ timeout: 20000 });
  assert((await api(path)).payload.data.presentCount === 1, "canvas-qr-worker-roundtrip-commit");
  assert(
    requests.some((x) => x.endsWith("/qr-resolutions")) &&
      requests.some((x) => x.endsWith("/scans")),
    "decode-resolve-commit-real-ui-api",
  );
  await capture("qr-confirmed");
  await page.getByRole("button", { name: "Đóng — dùng điểm danh tay", exact: true }).click();
  assert(
    await page.evaluate(() =>
      (window as unknown as { qrFixture: { streams: MediaStream[] } }).qrFixture.streams.every(
        (s) => s.getTracks().every((t) => t.readyState === "ended"),
      ),
    ),
    "close-stops-all-tracks",
  );
  // Permission rejection and late grant cleanup.
  await page.evaluate(() => {
    (window as unknown as { qrFixture: { deny: boolean } }).qrFixture.deny = true;
  });
  await page.getByRole("button", { name: "Quét QR", exact: true }).click();
  await page.getByRole("button", { name: "Bật camera", exact: true }).click();
  await page
    .getByText("Không mở được camera. Kiểm tra quyền camera hoặc dùng điểm danh tay.", {
      exact: true,
    })
    .waitFor();
  await page.getByRole("button", { name: "Đóng — dùng điểm danh tay", exact: true }).click();
  await page.evaluate(() => {
    const s = (window as unknown as { qrFixture: { deny: boolean; delay: boolean } }).qrFixture;
    s.deny = false;
    s.delay = true;
  });
  await page.getByRole("button", { name: "Quét QR", exact: true }).click();
  await page.getByRole("button", { name: "Bật camera", exact: true }).click();
  await page.waitForFunction(
    () => !!(window as unknown as { qrFixture: { release: unknown } }).qrFixture.release,
  );
  await page.getByRole("button", { name: "Đóng — dùng điểm danh tay", exact: true }).click();
  await page.evaluate(() => {
    (window as unknown as { qrFixture: { release: () => void } }).qrFixture.release();
  });
  await page.waitForFunction(() =>
    (window as unknown as { qrFixture: { streams: MediaStream[] } }).qrFixture.streams.every((s) =>
      s.getTracks().every((t) => t.readyState === "ended"),
    ),
  );
  assert(true, "late-getUserMedia-grant-stopped-after-close");
  await page.evaluate(() => {
    (window as unknown as { qrFixture: { delay: boolean } }).qrFixture.delay = false;
  });
  // Expire at the resolution boundary, before authorization starts.
  let expiredForCapture = false;
  await page.route(`**/${path}/qr-resolutions`, async (route) => {
    if (!expiredForCapture) {
      expiredForCapture = true;
      await db.sessions.updateMany(
        { realm: "owner", principalId: new ObjectId(fixture.employeeId), kind: "full" },
        { $set: { lastActivityAt: new Date(Date.now() - 16 * 60_000) } },
      );
    }
    await route.continue();
  });
  await page.getByRole("button", { name: "Quét QR", exact: true }).click();
  await page.getByRole("button", { name: "Bật camera", exact: true }).click();
  await page.getByRole("heading", { name: "Xác thực lại", exact: true }).waitFor();
  assert(
    await page.evaluate(() =>
      (window as unknown as { qrFixture: { streams: MediaStream[] } }).qrFixture.streams.every(
        (s) => s.getTracks().every((t) => t.readyState === "ended"),
      ),
    ),
    "reauth-stops-camera-tracks",
  );
  await page.getByLabel("Mật khẩu", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Tiếp tục", exact: true }).click();
  await page.getByRole("button", { name: "Quét QR", exact: true }).waitFor();
  assert(
    (await page.getByRole("button", { name: "Bật camera", exact: true }).count()) === 0,
    "reauth-does-not-reopen-camera",
  );
  await page.unroute(`**/${path}/qr-resolutions`);
  let raced = false;
  await page.route(`**/${path}/scans`, async (route) => {
    if (!raced) {
      raced = true;
      const r = route.request(),
        version = Number(r.headers()["if-match"]?.replaceAll('"', ""));
      const row = await api(
        `${path}/participants/${member._id}`,
        { present: false, generation: 2 },
        version,
        "owner",
        page,
        "PATCH",
      );
      assert(row.status === 200, "manual-change-between-resolution-and-commit");
    }
    await route.continue();
  });
  await page.getByRole("button", { name: "Quét QR", exact: true }).click();
  await page.getByRole("button", { name: "Bật camera", exact: true }).click();
  await page
    .getByText("Dữ liệu đã thay đổi. Tải lại và kiểm tra trước khi lưu.", { exact: true })
    .waitFor();
  await page.waitForFunction(() =>
    (window as unknown as { qrFixture: { streams: MediaStream[] } }).qrFixture.streams.every((s) =>
      s.getTracks().every((t) => t.readyState === "ended"),
    ),
  );
  assert(
    (await api(path)).payload.data.presentCount === 0,
    "stale-QR-does-not-overwrite-manual-change",
  );
  assert(
    await page.getByRole("button", { name: "Bật camera", exact: true }).isEnabled(),
    "stale-commit-stops-until-explicit-restart",
  );
  await page.unroute(`**/${path}/scans`);
  await page.getByRole("button", { name: "Đóng — dùng điểm danh tay", exact: true }).click();
  // A committed response is discarded; the UI must stop and reconcile the original intent.
  let aborted = false;
  await page.route(`**/${path}/scans`, async (route) => {
    if (aborted) {
      await route.continue();
      return;
    }
    aborted = true;
    const r = route.request();
    const response = await app(
      new Request(r.url(), {
        method: r.method(),
        headers: await r.allHeaders(),
        body: r.postData(),
      }),
      { ip: "browser-lost-response-p32" },
    );
    assert(response.status === 200, "lost-response-actually-committed");
    await response.arrayBuffer();
    await route.abort("failed");
  });
  await page.getByRole("button", { name: "Quét QR", exact: true }).click();
  await page.getByRole("button", { name: "Bật camera", exact: true }).click();
  await page.getByRole("button", { name: "Kiểm tra kết quả QR", exact: true }).waitFor();
  await page.waitForFunction(() =>
    (window as unknown as { qrFixture: { streams: MediaStream[] } }).qrFixture.streams.every((s) =>
      s.getTracks().every((t) => t.readyState === "ended"),
    ),
  );
  await capture("qr-outcome-unknown");
  await page.getByRole("button", { name: "Kiểm tra kết quả QR", exact: true }).click();
  await page
    .getByRole("button", { name: "Kiểm tra kết quả QR", exact: true })
    .waitFor({ state: "hidden" });
  assert(
    (await api(path)).payload.data.presentCount === 1,
    "lost-response-same-intent-reconciled-no-double-count",
  );
  await page.unroute(`**/${path}/scans`);
  // Hide explicitly stops tracks and never automatically restarts capture.
  await page.getByRole("button", { name: "Bật camera", exact: true }).click();
  await page.getByRole("button", { name: "Dừng camera", exact: true }).waitFor();
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, value: true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.waitForFunction(() =>
    (window as unknown as { qrFixture: { streams: MediaStream[] } }).qrFixture.streams.every((s) =>
      s.getTracks().every((t) => t.readyState === "ended"),
    ),
  );
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, value: false });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  assert(
    await page.getByRole("button", { name: "Bật camera", exact: true }).isEnabled(),
    "visibility-stop-no-auto-restart",
  );
  await page.getByRole("button", { name: "Đóng — dùng điểm danh tay", exact: true }).click();
  const policyHeaders = await page.evaluate(async () =>
    Object.fromEntries((await fetch("/")).headers),
  );
  assert(
    policyHeaders["permissions-policy"]?.includes("camera=(self)"),
    "same-origin-camera-policy",
  );
  assert(
    !policyHeaders["content-security-policy"]?.includes("unsafe-"),
    "csp-no-unsafe-inline-eval",
  );
  assert(
    requests.every((x) => !x.includes("upload") && !x.includes("frame")),
    "no-camera-frame-upload-route",
  );
  assert(!JSON.stringify(logs).includes(currentImage.payload), "qr-not-in-application-logs");
  assert(errors.length === 0, "no-browser-script-errors");
  await Bun.write(
    `${evidence}/browser-results.json`,
    JSON.stringify(
      {
        status: "PASS",
        checks: result,
        spacing: spacingEvidence,
        printGeometry,
        engine: "Firefox Playwright",
        bundleIndexSha256: new Bun.CryptoHasher("sha256")
          .update(await Bun.file("dist/index.html").arrayBuffer())
          .digest("hex"),
        limits: [
          "Local synthetic/private CA",
          "Canvas MediaStream and bundled QR worker, no physical camera",
          "Print CSS geometry only, no physical paper",
          "No Safari/production/multi-replica qualification",
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
