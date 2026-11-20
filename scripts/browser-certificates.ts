import { mkdir, readdir, readFile } from "node:fs/promises";
import { firefox } from "@playwright/test";
import ExcelJS from "exceljs";
import { ObjectId } from "mongodb";
import { createApp } from "../api/app";
import type { Config } from "../api/config";
import { OwnerOperations } from "../api/identity/owner-operations";
import { Identity } from "../api/identity/service";
import { Database, initialize } from "../api/infrastructure/database";
import { RateLimit } from "../api/infrastructure/rate-limit";
import type { Member } from "../api/members/models";
import { assertComposition } from "./browser-composition";
import { localTls } from "./local-tls";
import { seedP2 } from "./p2-fixtures";
import { certificateFixture, riteFixture } from "./p35-fixtures";

const evidence = process.env.CHURCH_EVIDENCE_DIR ?? "output/p3.5";
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
  database: `church_cms_test_browser_p35_${crypto.randomUUID().replaceAll("-", "")}`,
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
        const section = document.querySelector(".certificates-section");
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
      if (name === "report-preview" || name === "report-template") {
        const visible = await subject.locator(".church-report-layout").evaluate((table) => {
          const frame = table.parentElement;
          if (!frame) return false;
          const bounds = frame.getBoundingClientRect();
          return (
            frame.scrollWidth <= frame.clientWidth + 2 &&
            Array.from(table.querySelectorAll("td")).every((cell) => {
              const box = cell.getBoundingClientRect();
              return box.left >= bounds.left - 1 && box.right <= bounds.right + 1;
            })
          );
        });
        assert(visible, `${name}-${theme}-${width}-value-columns-visible`);
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
    fetch: (req) =>
      new URL(req.url).pathname === "/__p35_source"
        ? new Response(sourceHtml, { headers: { "content-type": "text/html; charset=utf-8" } })
        : app(req, { ip: "browser-p35" }),
  });
  await mkdir(evidence, { recursive: true });
  const fixture = await new OwnerOperations(db).create({
      email: `rite-${crypto.randomUUID()}@example.test`,
      displayName: "Owner synthetic P3.5",
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
      await api("owner/churches", { name: "Hội Thánh chứng nhận synthetic", province: "Đà Nẵng" })
    ).payload.data.church,
    base = `owner/churches/${church.id}`,
    prefix = `${base}/certificates`;
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
  assert(first, "member-fixture");
  await db.db.collection("members").updateOne({ _id: first._id }, { $set: { birthDate: null } });
  const rites: Record<string, string> = {};
  for (const kind of ["baptism", "dedication", "marriage"] as const) {
    const body = riteFixture(kind, first._id.toHexString());
    const preview = await api(`${base}/rites/records/preview`, body);
    assert(preview.status === 200, `rite-preview-${kind}`);
    const made = await api(`${base}/rites/records`, {
      ...body,
      preview: preview.payload.data.context,
    });
    assert(made.status === 201, `rite-source-${kind}`);
    rites[kind] = made.payload.data.riteId;
  }
  const member = await db.db.collection<Member>("members").findOne({
    churchId: new ObjectId(church.id),
    type: "believer",
    participation: { $in: ["active", "long_absent"] },
  });
  assert(member, "P61-eligible-member");
  const carePath = `${base}/care/cases`,
    visitCommand = {
      action: "create",
      target: { kind: "member", id: member._id.toHexString() },
      fields: {
        reasonCode: "other",
        description: "Chỉ dùng nội bộ synthetic",
        priority: "normal",
        plannedOn: null,
        assigneeId: null,
      },
      reason: null,
      preview: null,
      confirmed: true,
    },
    visitPreview = await api(`${carePath}/preview`, visitCommand);
  assert(visitPreview.status === 200, "P61-visit-source-preview");
  const visit = await api(carePath, {
    ...visitCommand,
    preview: visitPreview.payload.data.context,
  });
  assert(visit.status === 201, "P61-visit-source-created");
  await page.goto(`${conf.origin}/owner/churches/${church.id}/forms`);
  await page.getByRole("button", { name: "Giấy chứng nhận Báp-têm", exact: true }).waitFor();
  await page.waitForFunction(
    () => document.querySelectorAll(".certificates-catalog button:enabled").length === 8,
  );
  assert(
    (await page.locator(".certificates-catalog button").count()) === 8,
    "W11-eight-catalog-tiles",
  );
  assert(
    (await page.locator(".certificates-catalog button:disabled").count()) === 0,
    "W11-W18-enabled-with-report-rights",
  );
  await capture("catalog");
  const source = await context.newPage();
  await source.goto(`${conf.origin}/__p35_source`);
  await source.locator('.nav-a[data-go="forms"]').click();
  const parity: unknown[] = [];
  for (const theme of ["light", "dark"] as const) {
    for (const width of [1440, 390]) {
      const values = [];
      for (const target of [page, source]) {
        await target.emulateMedia({ colorScheme: theme });
        await target.setViewportSize({ width, height: 1000 });
        await target.evaluate(() => document.fonts.ready);
        values.push(
          await target
            .locator(".card.feature")
            .first()
            .evaluate((el) => {
              const c = getComputedStyle(el),
                b = getComputedStyle(el.querySelector("b") ?? el);
              return {
                background: c.backgroundColor,
                border: c.borderRadius,
                padding: c.padding,
                font: b.fontFamily,
                size: b.fontSize,
                color: b.color,
              };
            }),
        );
      }
      parity.push({ theme, width, values });
      assert(
        JSON.stringify(values[0]) === JSON.stringify(values[1]),
        `W11-source-style-${theme}-${width}`,
      );
    }
  }
  await source.close();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.emulateMedia({ colorScheme: "light" });
  const editions: Record<string, string> = {};
  const names = {
    baptism: "Giấy chứng nhận Báp-têm",
    dedication: "Giấy chứng nhận Dâng con",
    marriage: "Chứng thư Thành hôn",
    application: "Đơn xin chịu Báp-têm",
    transfer: "Thư giới thiệu chuyển sinh hoạt",
    membership: "Giấy xác nhận tín hữu",
    visit: "Phiếu thăm viếng",
  };
  for (const kind of [
    "baptism",
    "dedication",
    "marriage",
    "application",
    "transfer",
    "membership",
    "visit",
  ] as const) {
    await page.getByRole("button", { name: names[kind], exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.waitFor();
    if (kind === "application") {
      await page.getByLabel("Tìm Người làm đơn", { exact: true }).fill(first.code);
      await page.getByRole("button", { name: new RegExp(first.fullName) }).click();
      await page
        .getByLabel("Ngày xin chịu Báp-têm", { exact: true })
        .fill(certificateFixture(kind).requestedOn ?? "");
    } else if (kind === "transfer" || kind === "membership") {
      await dialog.getByLabel("Tìm Tín hữu", { exact: true }).fill(member.code);
      await dialog
        .getByRole("button", { name: `${member.fullName} · ${member.code}`, exact: true })
        .click();
      if (kind === "transfer")
        await dialog
          .getByLabel("Hội Thánh tiếp nhận", { exact: true })
          .fill("Hội Thánh tiếp nhận synthetic");
      await capture(`${kind}-draft`);
    } else if (kind === "visit") {
      await dialog
        .getByLabel("Hồ sơ thăm viếng đang mở", { exact: true })
        .selectOption(visit.payload.data.caseId);
      await capture("visit-draft");
    } else {
      await page.getByLabel("Lễ đã ghi nhận", { exact: true }).selectOption(rites[kind] ?? "");
      await page.waitForFunction(
        () =>
          (document.querySelector('input[type="date"][disabled]') as HTMLInputElement)?.value
            .length > 0,
      );
    }
    if (kind === "baptism" || kind === "dedication" || kind === "application")
      await page.getByLabel("Ngày sinh", { exact: true }).fill("1990-01-02");
    if (kind !== "transfer" && kind !== "membership" && kind !== "visit")
      await page
        .getByLabel("Lý do bổ sung dữ kiện", { exact: true })
        .fill("Nguồn synthetic được đối chiếu");
    await page.getByRole("button", { name: "Lưu nháp", exact: true }).click();
    await page.getByRole("button", { name: "Chuẩn bị preview", exact: true }).waitFor();
    await page.getByRole("button", { name: "Chuẩn bị preview", exact: true }).click();
    await page.getByLabel("Tôi xác nhận nội dung và dữ kiện trước khi chốt").waitFor();
    assert(
      await page.getByRole("button", { name: "Chốt bản", exact: true }).isDisabled(),
      `${kind}-confirmation-required`,
    );
    await page.getByLabel("Tôi xác nhận nội dung và dữ kiện trước khi chốt").check();
    if (kind === "baptism") {
      assert(
        await page.getByRole("button", { name: "Chốt bản", exact: true }).isDisabled(),
        "faith-confirmation-required",
      );
      await page.getByLabel("Tôi xác nhận riêng nội dung đức tin ghi trong GCN Báp-têm").check();
    }
    await capture(`${kind}-preview`);
    await page.getByLabel("Trang chứng nhận cuộn", { exact: true }).focus();
    await page.keyboard.press("End");
    const reach = await page.getByLabel("Trang chứng nhận cuộn", { exact: true }).evaluate((el) => {
      el.scrollTop = el.scrollHeight;
      el.scrollLeft = el.scrollWidth;
      const p = el.querySelector("article");
      if (!p) return false;
      return (
        p.getBoundingClientRect().right <= el.getBoundingClientRect().right + 1 &&
        p.getBoundingClientRect().bottom <= el.getBoundingClientRect().bottom + 1
      );
    });
    assert(reach, `${kind}-A4-preview-reachable`);
    let lost = false,
      committed = false,
      forwardedOutcome = "not forwarded";
    let finishForward!: () => void;
    const forwarded = new Promise<void>((resolve) => {
      finishForward = resolve;
    });
    const issueRoute = `**/api/v1/${prefix}/drafts/*/issue`;
    if (kind === "baptism")
      await page.route(issueRoute, async (route) => {
        if (lost) return route.continue();
        lost = true;
        const request = route.request(),
          headers = new Headers(await request.allHeaders());
        for (const name of ["host", "content-length", "connection"]) headers.delete(name);
        try {
          const response = await fetch(request.url(), {
            method: "POST",
            headers,
            body: request.postData(),
            tls: { ca: await Bun.file(tls.ca).text() },
          });
          committed = response.status === 200;
          const reply = await response.json();
          forwardedOutcome = `${response.status} ${reply.error?.code ?? ""}`;
        } catch (e) {
          forwardedOutcome = e instanceof Error ? e.name : "forwarding failed";
        } finally {
          await route.abort("failed");
          finishForward();
        }
      });
    await page.getByRole("button", { name: "Chốt bản", exact: true }).click();
    if (kind === "baptism") {
      await page.getByRole("button", { name: "Kiểm tra / thử lại bản", exact: true }).waitFor();
      await forwarded;
      assert(lost && committed, `lost-issue-response-was-actually-committed: ${forwardedOutcome}`);
      await page.getByRole("button", { name: "Kiểm tra / thử lại bản", exact: true }).click();
      await page.unroute(issueRoute);
    }
    await page.getByRole("button", { name: "Word", exact: true }).waitFor();
    editions[kind] = new URL(page.url()).searchParams.get("editionId") ?? "";
    assert(!!editions[kind], `${kind}-issued-through-W17`);
    assert(
      (await db.db
        .collection("certificate_editions")
        .countDocuments({ _id: new ObjectId(editions[kind]) })) === 1,
      `${kind}-one-immutable-edition`,
    );
    for (const format of ["Word", "PDF"] as const) {
      const event = page.waitForEvent("download");
      await page.getByRole("button", { name: format, exact: true }).click();
      const download = await event;
      await download.saveAs(`${evidence}/downloads/${kind}.${format === "Word" ? "docx" : "pdf"}`);
      assert(!(await download.failure()), `${kind}-${format}-download`);
    }
    const opened = context.waitForEvent("page");
    await page.getByRole("button", { name: "In", exact: true }).click();
    const printed = await opened;
    await printed.getByRole("button", { name: "In", exact: true }).waitFor();
    await printed.emulateMedia({ media: "print" });
    assert(
      (await printed.locator(".ui-certificate-page").count()) > 0,
      `${kind}-authenticated-print-pages`,
    );
    await printed.screenshot({ path: `${evidence}/${kind}-print.png`, fullPage: true });
    await printed.close();
    await page.getByRole("button", { name: "Lịch sử", exact: true }).click();
    await page.getByText("Chốt bản", { exact: false }).first().waitFor();
    await page.getByRole("button", { name: "Đóng", exact: true }).last().click();
    await page.waitForFunction(
      (name) => document.activeElement?.textContent?.trim() === name,
      names[kind],
    );
    assert(true, `${kind}-dialog-focus-restored`);
  }
  await page.goto(
    `${conf.origin}/owner/churches/${church.id}/rites?tab=bap&riteId=${rites.baptism}`,
  );
  await page.getByRole("button", { name: "Giấy chứng nhận", exact: true }).last().click();
  await page.getByRole("dialog").waitFor();
  assert(
    new URL(page.url()).searchParams.get("riteId") === rites.baptism,
    "W06-certificate-context",
  );
  await page.getByRole("button", { name: "Đóng", exact: true }).last().click();
  await page.goto(
    `${conf.origin}/owner/churches/${church.id}/members?memberId=${first._id.toHexString()}`,
  );
  await page.getByRole("region", { name: "Chứng nhận của thuộc viên" }).waitFor();
  await page.getByRole("button", { name: "Mở chứng nhận", exact: true }).first().click();
  await page.getByRole("button", { name: "Word", exact: true }).waitFor();
  assert(new URL(page.url()).pathname.endsWith("/forms"), "W14-opens-edition");
  const activeEdition = new URL(page.url()).searchParams.get("editionId");
  await db.sessions.updateMany(
    { realm: "owner", principalId: new ObjectId(fixture.employeeId), kind: "full" },
    { $set: { lastActivityAt: new Date(Date.now() - 16 * 60_000) } },
  );
  await page.reload();
  await page.getByRole("heading", { name: "Xác thực lại", exact: true }).waitFor();
  await page.getByLabel("Mật khẩu", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Tiếp tục", exact: true }).click();
  await page.getByRole("button", { name: "Word", exact: true }).waitFor();
  assert(
    new URL(page.url()).searchParams.get("editionId") === activeEdition,
    "reauth-retains-edition-context",
  );
  await page.getByRole("button", { name: "Thu hồi", exact: true }).click();
  await page.getByLabel("Lý do", { exact: true }).fill("Thu hồi synthetic sau đối chiếu");
  await page.getByRole("button", { name: "Xác nhận", exact: true }).click();
  await page.getByText("Đã thu hồi · v1", { exact: true }).waitFor();
  await page.goto(`${conf.origin}/owner/churches/${church.id}/forms?editionId=${activeEdition}`);
  await page.getByRole("button", { name: "Word", exact: true }).waitFor();
  assert(
    await page.getByRole("button", { name: "Word", exact: true }).isDisabled(),
    "revoked-edition-no-download-control",
  );
  await page.getByRole("button", { name: "Đóng", exact: true }).last().click();
  const email = `secretary-${crypto.randomUUID()}@example.test`,
    userPassword = `User 🌿 ${crypto.randomUUID()}`;
  const made = await api(`${base}/accounts`, {
    email,
    displayName: "Thư ký synthetic",
    role: "secretary",
    scope: { kind: "church" },
  });
  assert(made.status === 201, "secretary-created");
  secrets.push(userPassword, made.payload.data.temporaryCredential.password);
  const userPage = await context.newPage();
  await userPage.goto(`${conf.origin}/${church.code}/login`);
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
    .getByRole("button", { name: /^Biểu mẫu/ })
    .waitFor();
  await userPage.goto(`${conf.origin}/${church.code}/forms?editionId=${editions.marriage}`);
  await userPage.getByRole("button", { name: "Word", exact: true }).waitFor();
  await capture("secretary-edition", userPage);
  const downloadEvent = userPage.waitForEvent("download");
  await userPage.getByRole("button", { name: "PDF", exact: true }).click();
  assert(!(await (await downloadEvent).failure()), "church-realm-PDF-download");
  await userPage.goto(`${conf.origin}/${church.code}/forms`);
  await userPage
    .getByRole("button", { name: "Báo cáo thống kê gửi Tổng Liên Hội", exact: true })
    .click();
  const secretaryW18 = userPage.getByRole("dialog", { name: "Báo cáo Tổng Liên Hội" });
  await secretaryW18.getByText("Chưa có mẫu riêng cho Hội Thánh.").waitFor();
  assert(
    await secretaryW18.getByRole("button", { name: "Tổng hợp", exact: true }).isDisabled(),
    "P62-empty-template-blocks-preview",
  );
  const book = new ExcelJS.Workbook(),
    sheet = book.addWorksheet("Bố cục riêng P6.2");
  sheet.addRow(["I. Nhóm do Hội Thánh chọn"]).font = { bold: true };
  sheet.addRow(["Gia đình đang sinh hoạt", "{{believer_families}}"]);
  sheet.addRow(["Bình quân bốn Chúa nhật", "{{sunday_average}}"]);
  sheet.addRow(["Thân hữu đang theo dõi", "{{visitors}}"]);
  const template = Buffer.from(await book.xlsx.writeBuffer());
  await secretaryW18.getByLabel("Tải mẫu .xlsx", { exact: true }).setInputFiles({
    name: "bao-cao-rieng.xlsx",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: template,
  });
  await secretaryW18.getByRole("button", { name: "Kiểm tra và lưu mẫu" }).click();
  await secretaryW18.getByText("Đã kiểm tra", { exact: true }).waitFor();
  await secretaryW18.getByRole("button", { name: "Xem thử mẫu" }).click();
  await secretaryW18.getByRole("table", { name: "Xem thử mẫu" }).waitFor();
  assert(
    (await secretaryW18.getByRole("button", { name: "Kích hoạt", exact: true }).count()) === 0,
    "P62-secretary-uploads-without-activation",
  );
  await capture("report-template", userPage);
  await userPage.keyboard.press("Escape");
  await secretaryW18.waitFor({ state: "hidden" });
  await userPage.getByRole("button", { name: "Đăng xuất", exact: true }).click();
  await userPage.getByRole("heading", { name: "Đăng nhập", exact: true }).waitFor();
  await userPage.close();

  const pastorEmail = `pastor-${crypto.randomUUID()}@example.test`,
    pastorPassword = `User 🌿 ${crypto.randomUUID()}`;
  const pastor = await api(`${base}/accounts`, {
    email: pastorEmail,
    displayName: "Mục sư synthetic",
    role: "pastor",
    scope: { kind: "church" },
  });
  assert(pastor.status === 201, "P62-pastor-created");
  secrets.push(pastorPassword, pastor.payload.data.temporaryCredential.password);
  const pastorPage = await context.newPage();
  await pastorPage.goto(`${conf.origin}/${church.code}/login`);
  await pastorPage.getByLabel("Email", { exact: true }).fill(pastorEmail);
  await pastorPage
    .getByLabel("Mật khẩu", { exact: true })
    .fill(pastor.payload.data.temporaryCredential.password);
  await pastorPage.getByRole("button", { name: "Đăng nhập", exact: true }).click();
  await pastorPage.getByLabel("Mật khẩu mới", { exact: true }).fill(pastorPassword);
  await pastorPage.getByLabel("Nhập lại mật khẩu", { exact: true }).fill(pastorPassword);
  await pastorPage.getByRole("button", { name: "Lưu mật khẩu", exact: true }).click();
  await pastorPage.getByRole("heading", { name: "Đăng nhập", exact: true }).waitFor();
  await pastorPage.getByLabel("Mật khẩu", { exact: true }).fill(pastorPassword);
  await pastorPage.getByRole("button", { name: "Đăng nhập", exact: true }).click();
  await pastorPage
    .getByRole("navigation")
    .getByRole("button", { name: /^Biểu mẫu/ })
    .waitFor();

  await pastorPage.goto(`${conf.origin}/${church.code}/overview`);
  await pastorPage.getByRole("button", { name: "Báo cáo Tổng Liên Hội", exact: true }).click();
  const pastorW18 = pastorPage.getByRole("dialog", { name: "Báo cáo Tổng Liên Hội" });
  await pastorW18.getByRole("button", { name: "Kích hoạt", exact: true }).click();
  await pastorW18.getByText("Đang dùng", { exact: true }).waitFor();
  await pastorW18.getByRole("button", { name: "Tổng hợp", exact: true }).click();
  await pastorW18.getByRole("table", { name: "Chỉ tiêu báo cáo", exact: true }).waitFor();
  const reportTable = pastorW18.getByRole("table", { name: "Chỉ tiêu báo cáo", exact: true });
  assert(
    (await reportTable.getByText("I. Nhóm do Hội Thánh chọn", { exact: true }).count()) === 1,
    "P62-report-keeps-tenant-layout",
  );
  assert(
    (await reportTable.getByText("—", { exact: true }).count()) === 1,
    "P62-report-missing-source-visible",
  );
  assert(
    await pastorW18.getByRole("button", { name: "Chốt báo cáo", exact: true }).isDisabled(),
    "P62-report-confirmation-required",
  );
  await capture("report-preview", pastorPage);
  await reportTable.screenshot({ path: `${evidence}/report-values.png` });
  await pastorW18
    .getByLabel("Tôi xác nhận số liệu và các cảnh báo trước khi chốt", { exact: true })
    .check();
  await pastorW18.getByRole("button", { name: "Chốt báo cáo", exact: true }).click();
  for (const [label, format] of [
    ["Excel", "xlsx"],
    ["PDF", "pdf"],
  ] as const) {
    const event = pastorPage.waitForEvent("download");
    await pastorW18.getByRole("button", { name: label, exact: true }).click();
    const download = await event;
    await download.saveAs(`${evidence}/downloads/church-report.${format}`);
    assert(!(await download.failure()), `P62-report-${format}-download`);
  }
  await pastorW18.getByRole("button", { name: "Tạo bản thay thế", exact: true }).click();
  assert(
    await pastorW18
      .getByLabel("Lý do thay thế", { exact: true })
      .evaluate((el) => el === document.activeElement),
    "P62-replacement-focus",
  );
  await pastorW18.getByLabel("Lý do thay thế", { exact: true }).fill("Đối chiếu số liệu synthetic");
  await pastorW18.getByRole("button", { name: "Tổng hợp", exact: true }).click();
  await pastorW18
    .getByLabel("Tôi xác nhận số liệu và các cảnh báo trước khi chốt", { exact: true })
    .check();
  await pastorW18.getByRole("button", { name: "Chốt báo cáo", exact: true }).click();
  await pastorW18.getByText("Bản 2", { exact: true }).waitFor();
  await pastorW18.getByText(/Bản 1 · Đã thay thế/).waitFor();
  assert(
    (await pastorW18.getByText(/Bản 1 · Đã thay thế/).count()) === 1,
    "P62-report-replacement-preserves-history",
  );
  await pastorPage.close();
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
        limits: [
          "Local/synthetic/private CA",
          "Camera/paper/native Word/Safari/UAT/production NOT_RUN",
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
