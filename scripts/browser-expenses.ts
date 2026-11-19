import { createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { expect, firefox, type Page } from "@playwright/test";
import { ObjectId } from "mongodb";
import sharp from "sharp";
import { createApp } from "../api/app";
import type { Config } from "../api/config";
import { expenseImageLimit } from "../api/finance/expense-image";
import type { ExpenseAttachment } from "../api/finance/expenses-model";
import { Identity } from "../api/identity/service";
import { Database, initialize } from "../api/infrastructure/database";
import { RateLimit } from "../api/infrastructure/rate-limit";
import { assertComposition } from "./browser-composition";
import { localTls } from "./local-tls";
import { SyntheticClient, syntheticOwner, syntheticUser } from "./p2-fixtures";
import { financeChurch, financeRoot } from "./p51-fixtures";

if (process.platform !== "linux" || !process.env.CHURCH_BROWSER_CONTAINER)
  throw Error("Use isolated browser container");
const evidence = process.env.CHURCH_EVIDENCE_DIR ?? "output/p5.3/browser";
await mkdir(evidence, { recursive: true });
const tls = await localTls("/tmp/church-finance-tls"),
  conf: Config = {
    ...tls,
    cert: tls.cert,
    key: tls.key,
    origin: "https://localhost:3498",
    port: 3498,
    mongoUrl: "mongodb://host.docker.internal:27119/?replicaSet=church-local&directConnection=true",
    redisUrl: "redis://host.docker.internal:6391",
    database: `church_cms_test_browser_p53_${crypto.randomUUID().replaceAll("-", "")}`,
    csrfKey: crypto.randomUUID() + crypto.randomUUID(),
  };
const db = new Database(conf),
  rate = new RateLimit(conf.redisUrl, conf.csrfKey);
await mkdir("/tmp/church-finance-firefox", { recursive: true });
for (const args of [
  ["certutil", "-N", "--empty-password", "-d", "sql:/tmp/church-finance-firefox"],
  [
    "certutil",
    "-A",
    "-d",
    "sql:/tmp/church-finance-firefox",
    "-n",
    "Church private verification CA",
    "-t",
    "C,,",
    "-i",
    tls.ca,
  ],
])
  if (Bun.spawnSync(args).exitCode !== 0) throw Error("Private CA import failed");
const context = await firefox.launchPersistentContext("/tmp/church-finance-firefox", {
  headless: true,
  viewport: { width: 1440, height: 1000 },
});
context.setDefaultTimeout(15000);
context.setDefaultNavigationTimeout(15000);
const page = await context.newPage(),
  errors: string[] = [],
  checks: string[] = [];
context.on("page", (p) => p.on("pageerror", (e) => errors.push(e.message)));
page.on("pageerror", (e) => errors.push(e.message));
const assert = (condition: unknown, label: string) => {
  if (!condition) throw Error(label);
  checks.push(label);
  console.info(label);
};
let server: ReturnType<typeof Bun.serve> | undefined,
  loseNext = false,
  lost = false,
  reauthNext = false;
const logs: object[] = [],
  secrets: string[] = [];
const client = (realm: "owner" | "church" = "church") => {
  const ip = crypto.randomUUID();
  return new SyntheticClient(realm, conf.origin, (req) => app(req, { ip }));
};
let app: ReturnType<typeof createApp>;
async function login(
  p: Page,
  c: { code: string },
  account: { email: string; password: string },
  openExpense = true,
) {
  // Actor switches use isolated browser cookies; logout behavior belongs to the existing identity suite.
  await p.goto("about:blank");
  await context.clearCookies();
  await p.goto(`${conf.origin}/h/${c.code}/login`);
  await p.getByLabel("Email", { exact: true }).fill(account.email);
  await p.getByLabel("Mật khẩu", { exact: true }).fill(account.password);
  await p.getByRole("button", { name: "Đăng nhập", exact: true }).click();
  try {
    if (openExpense)
      await p.getByRole("button", { name: "Thông tin truy cập", exact: true }).waitFor();
    else await p.getByRole("heading", { name: "Cổng tín hữu", exact: true }).waitFor();
  } catch (error) {
    await Bun.write(
      `${evidence}/login-diagnostic.json`,
      JSON.stringify({ url: p.url(), text: await p.locator("body").innerText() }, null, 2),
    );
    await p.screenshot({
      path: `${evidence}/login-failure.png`,
      fullPage: true,
      mask: [p.locator('input[type="password"]')],
    });
    throw error;
  }
  const identity = await p.evaluate(
    async () => (await (await fetch("/api/v1/auth/me")).json()).data,
  );
  assert(identity.email === account.email, "browser-actor-identity-matches-fixture");
  if (openExpense) {
    await p.getByRole("button", { name: "Đề xuất chi & Duyệt", exact: true }).click();
    await p.getByRole("heading", { name: "Đề xuất chi & Duyệt", exact: true }).waitFor();
  }
}
async function capture(p: Page, name: string) {
  for (const theme of ["light", "dark"] as const) {
    await p.emulateMedia({ colorScheme: theme });
    for (const width of [1440, 901, 900, 560, 390]) {
      await p.setViewportSize({ width, height: 1000 });
      await assertComposition(p, `${name}-${theme}-${width}`, assert, evidence);
      await p.evaluate(async () => {
        await document.fonts.ready;
        scrollTo(0, 0);
      });
      const state = await p.evaluate(() => {
        const visible = (e: HTMLElement) => e.getClientRects().length > 0;
        const controls = Array.from(
          document.querySelectorAll<HTMLElement>(
            ".finance-layout button,.finance-layout input,.finance-layout select,dialog[open] input,dialog[open] textarea,dialog[open] button",
          ),
        ).filter(visible);
        return {
          page: document.documentElement.scrollWidth <= innerWidth + 1,
          contained: controls.every((e) => {
            const r = e.getBoundingClientRect();
            return e.closest(".tbl-wrap") || (r.left >= -1 && r.right <= innerWidth + 1);
          }),
          heights:
            innerWidth > 560 ||
            controls
              .filter((e) => !e.matches('[type="checkbox"]'))
              .every((e) => e.getBoundingClientRect().height >= 43),
          inputHeight: controls
            .filter((e) => e.matches('input:not([type="checkbox"]),select'))
            .every((e) => e.getBoundingClientRect().height < 55),
        };
      });
      assert(state.page && state.contained, `${name}-${theme}-${width}-contained`);
      assert(state.heights, `${name}-${theme}-${width}-touch`);
      assert(state.inputHeight, `${name}-${theme}-${width}-input-geometry`);
      if (width === 1440 || width === 390)
        await p.screenshot({ path: `${evidence}/${name}-${theme}-${width}.png`, fullPage: true });
    }
  }
  await p.setViewportSize({ width: 1440, height: 1000 });
  await p.emulateMedia({ colorScheme: "light" });
}
try {
  await db.client.connect();
  await initialize(db.db);
  await rate.connect();
  const identity = new Identity(db, rate, conf);
  await identity.initialize();
  app = createApp(identity, conf, { log: (r) => logs.push(r) });
  server = Bun.serve({
    maxRequestBodySize: expenseImageLimit,
    hostname: "127.0.0.1",
    port: conf.port,
    tls: { cert: Bun.file(tls.cert), key: Bun.file(tls.key) },
    fetch: async (req) => {
      const path = new URL(req.url).pathname;
      if (reauthNext && req.method === "POST" && path.endsWith("/decision")) {
        reauthNext = false;
        return Response.json(
          { error: { code: "REAUTH_REQUIRED", message: "Xác thực lại để tiếp tục." } },
          { status: 401 },
        );
      }
      const response = await app(req, { ip: "browser-expenses" });
      if (
        loseNext &&
        req.method === "POST" &&
        path.endsWith("/finance/expense-proposals") &&
        response.status === 201
      ) {
        loseNext = false;
        lost = true;
        const payload = await response.clone().json();
        return Response.json(
          {
            error: {
              code: "OUTCOME_UNKNOWN",
              message: "Chưa nhận được xác nhận gửi.",
              operationId: payload.data.operationId,
            },
            meta: {},
          },
          { status: 503 },
        );
      }
      return response;
    },
  });
  const owner = client("owner"),
    o = await syntheticOwner(db, owner),
    c = await financeChurch(owner, "Hội Thánh P53 synthetic"),
    ps = client(),
    ss = client(),
    ss2 = client(),
    ts = client(),
    ls = client(),
    ms = client();
  const pastor = await syntheticUser(owner, ps, c, "pastor"),
    secretary = await syntheticUser(owner, ss, c, "secretary"),
    secretary2 = await syntheticUser(owner, ss2, c, "secretary"),
    treasurer = await syntheticUser(owner, ts, c, "treasurer"),
    lead = await syntheticUser(owner, ls, c, "ministry_lead", [c.unitId]);
  const member = await syntheticUser(owner, ms, c, "member");
  secrets.push(
    o.password,
    pastor.password,
    secretary.password,
    secretary2.password,
    treasurer.password,
    lead.password,
    member.password,
  );
  const finance = financeRoot(c),
    base = `${finance}/expense-proposals`;
  assert(
    (
      await ps.call(`${finance}/settings`, {
        proposerRoles: ["secretary", "treasurer", "ministry_lead"],
        approverRole: "pastor",
      })
    ).status === 201,
    "fixture-explicit-config",
  );
  const f = await ps.call(`${finance}/funds`, { name: "Quỹ sinh hoạt synthetic" });
  assert(f.status === 201, "fixture-public-fund");
  async function publicProposal(who: SyntheticClient, purpose: string, amount = "123") {
    const b = { submissionId: crypto.randomUUID(), fundId: f.payload.data.fundId, amount, purpose },
      preview = await who.call(`${base}/preview`, b);
    assert(preview.status === 200, "fixture-public-proposal-preview");
    const r = await who.call(base, {
      proposal: b,
      previewToken: preview.payload.data.previewToken,
    });
    assert(r.status === 201, "fixture-public-proposal-submit");
    return (await who.call(`${base}/${r.payload.data.proposalId}`)).payload.data as {
      id: string;
      code: string;
      state: string;
    };
  }
  await login(page, c, secretary);
  await page.getByText("Chưa có đề xuất trong phạm vi đã chọn.").waitFor();
  assert(
    (await page.getByRole("button", { name: "Dâng hiến & Quỹ", exact: true }).count()) === 0,
    "secretary-expense-not-income-navigation",
  );
  assert(
    JSON.stringify(await page.locator(".grid.g4 .lbl").allTextContents()) ===
      JSON.stringify(["Chờ duyệt", "Đã duyệt, chờ chi", "Đã chi", "Từ chối"]),
    "W10-KPI-order-matches-approved-ASCII",
  );
  await capture(page, "w10-proposer-empty");
  await page.getByRole("button", { name: "Tạo đề xuất chi", exact: true }).click();
  let d = page.getByRole("dialog", { name: "Tạo đề xuất chi", exact: true });
  await d.getByRole("button", { name: "Chọn quỹ chi", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Chọn quỹ đề xuất", exact: true })
    .getByRole("button", { name: "Quỹ sinh hoạt synthetic", exact: true })
    .click();
  await d.getByLabel("Số tiền VND", { exact: true }).fill("9007199254740993");
  await d.getByLabel("Nội dung chi", { exact: true }).fill("Mua vật tư synthetic UI");
  await d.getByLabel("Nội dung chi", { exact: true }).focus();
  await page.keyboard.press("Shift+Tab");
  assert(
    await page.evaluate(() => !!document.activeElement?.closest("dialog[open]")),
    "W16-keyboard-focus-contained",
  );
  const receipt = await sharp(
    Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="500" height="300"><rect width="500" height="300" fill="#fcf8ef"/><g fill="#24343d" font-family="sans-serif"><text x="28" y="56" font-size="26">CHUNG TU SYNTHETIC</text><text x="28" y="117" font-size="18">Vat tu sinh hoat</text><text x="28" y="168" font-size="18">Tong: 123.000 VND</text><text x="28" y="233" font-size="15">Du lieu kiem thu P7.2</text></g><path d="M28 77H472M28 188H472" stroke="#a89370"/></svg>',
    ),
  )
    .png()
    .toBuffer();
  const picker = d.getByLabel("Tệp chứng từ", { exact: true });
  const selectReceipt = (name: string, buffer: Buffer) =>
    picker.setInputFiles({ name, mimeType: "image/png", buffer });
  const [fileChooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    d.getByRole("button", { name: "Chọn ảnh", exact: true }).click(),
  ]);
  await fileChooser.setFiles({
    name: "anh-hong.png",
    mimeType: "image/png",
    buffer: Buffer.from("invalid"),
  });
  await d
    .getByText("Ảnh phải là JPEG hoặc PNG hợp lệ. Vui lòng chọn lại.", { exact: true })
    .waitFor();
  assert(true, "P72-invalid-image-feedback");
  await selectReceipt("anh-tam.png", receipt);
  await d.getByText("anh-tam.png", { exact: true }).waitFor();
  await d.getByRole("button", { name: "Bỏ ảnh", exact: true }).click();
  await expect(d.getByText("anh-tam.png", { exact: true })).toHaveCount(0);
  await selectReceipt("hoa-don-synthetic.png", receipt);
  await d.getByText("hoa-don-synthetic.png", { exact: true }).waitFor();
  await d.getByRole("button", { name: "Xem ảnh", exact: true }).click();
  await expect(d.getByRole("img", { name: "Ảnh chứng từ đề xuất chi" })).toBeVisible();
  assert(true, "P72-stage-remove-reselect-and-view");
  await capture(page, "w16-editor");
  await d.getByRole("button", { name: "Xem trước", exact: true }).click();
  d = page.getByRole("dialog", { name: "Xác nhận gửi đề xuất", exact: true });
  await expect(d.getByText("9.007.199.254.740.993 ₫", { exact: true })).toBeVisible();
  await d.getByText("Chứng từ: hoa-don-synthetic.png", { exact: true }).waitFor();
  await capture(page, "submit-preview");
  loseNext = true;
  await d.getByRole("button", { name: "Xác nhận gửi", exact: true }).click();
  await expect(d.getByText("Chưa nhận được xác nhận gửi.")).toBeVisible();
  assert(lost, "lost-response-after-real-commit");
  await d.getByRole("button", { name: "Đóng", exact: true }).click();
  await page.getByRole("button", { name: "Đối soát danh sách", exact: true }).click();
  await page.getByLabel("Trạng thái", { exact: true }).selectOption("all");
  await capture(page, "unknown-outcome");
  await page.getByRole("button", { name: "Kiểm tra kết quả / thử lại", exact: true }).click();
  d = page.getByRole("dialog", { name: "Chi tiết đề xuất chi", exact: true });
  await d.getByText("Nội dung: Mua vật tư synthetic UI", { exact: true }).waitFor();
  const first = (await ss.call(base)).payload.data.items.find(
    (r: { purpose: string }) => r.purpose === "Mua vật tư synthetic UI",
  );
  assert(!!first, "UI-submit-real-readback");
  assert(
    (await ss.call(base)).payload.data.items.filter(
      (r: { purpose: string }) => r.purpose === "Mua vật tư synthetic UI",
    ).length === 1,
    "same-intent-operation-lookup-no-duplicate",
  );
  assert(
    (await d.getByRole("button", { name: "Duyệt", exact: true }).count()) === 0,
    "proposer-cannot-approve",
  );
  await d.getByRole("button", { name: "Xem ảnh", exact: true }).click();
  await expect(d.getByRole("img", { name: "Ảnh chứng từ đề xuất chi" })).toBeVisible();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    d.getByRole("button", { name: "Tải ảnh", exact: true }).click(),
  ]);
  const attachment = await db.db
    .collection<ExpenseAttachment>("finance_expense_attachments")
    .findOne({ proposalId: new ObjectId(first.id) });
  const path = await download.path();
  assert(!!path && !!attachment, "P72-one-durable-attachment-after-lost-response");
  const hash = createHash("sha256")
    .update(new Uint8Array(await Bun.file(path).arrayBuffer()))
    .digest("hex");
  assert(
    download.suggestedFilename() === "chung-tu.png" && hash === attachment?.hash,
    "P72-download-matches-checksum",
  );
  await capture(page, "pending-detail");
  await d.getByRole("button", { name: "Lịch sử đề xuất", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Lịch sử đề xuất", exact: true })
    .getByText(/Gửi đề xuất/)
    .waitFor();
  await capture(page, "proposal-history");
  await page
    .getByRole("dialog", { name: "Lịch sử đề xuất", exact: true })
    .getByRole("button", { name: "Đóng", exact: true })
    .click();
  await d.getByRole("button", { name: "Đóng", exact: true }).click();
  await login(page, c, secretary2);
  await page.getByText("Chưa có đề xuất trong phạm vi đã chọn.").waitFor();
  assert(
    (await ss2.call(base)).payload.data.summary.pending.total === "0",
    "same-role-other-account-zero-own-KPI",
  );
  assert(
    (await ss2.call(`${base}/${first.id}`)).status === 404,
    "same-role-other-account-detail-denied",
  );
  const deniedImage = await page.evaluate(
    async (path) => (await fetch(path, { cache: "no-store" })).status,
    `/api/v1/${base}/${first.id}/attachment`,
  );
  assert(deniedImage === 404, "P72-direct-image-denied-to-other-proposer");
  await capture(page, "same-role-own-scope");
  await login(page, c, pastor);
  await page.getByRole("button", { name: `Xem ${first.code}`, exact: true }).click();
  d = page.getByRole("dialog", { name: "Chi tiết đề xuất chi", exact: true });
  await d.getByRole("button", { name: "Duyệt", exact: true }).click();
  d = page.getByRole("dialog", { name: "Duyệt đề xuất", exact: true });
  await d.getByLabel("Ghi chú duyệt", { exact: true }).fill("Đồng ý synthetic");
  await d.getByRole("button", { name: "Xem trước", exact: true }).click();
  d = page.getByRole("dialog", { name: "Xác nhận quyết định", exact: true });
  await d.getByText("Quyết định: Duyệt", { exact: true }).waitFor();
  await capture(page, "decision-preview");
  reauthNext = true;
  await d.getByRole("button", { name: "Xác nhận quyết định", exact: true }).click();
  await page.getByRole("heading", { name: "Xác thực lại", exact: true }).waitFor();
  assert(
    (await ps.call(`${base}/${first.id}`)).payload.data.state === "pending",
    "reauth-before-commit-keeps-pending",
  );
  await page.getByLabel("Mật khẩu", { exact: true }).fill(pastor.password);
  await page.getByRole("button", { name: "Tiếp tục", exact: true }).click();
  await page.getByRole("button", { name: "Kiểm tra kết quả / thử lại", exact: true }).waitFor();
  assert(
    (await ps.call(`${base}/${first.id}`)).payload.data.state === "pending",
    "reauth-no-auto-decision-replay",
  );
  await page.getByRole("button", { name: "Kiểm tra kết quả / thử lại", exact: true }).click();
  d = page.getByRole("dialog", { name: "Chi tiết đề xuất chi", exact: true });
  await expect(d.getByText("Đã duyệt, chờ chi", { exact: true })).toBeVisible();
  await expect(
    d.getByText("Đã duyệt, đang chờ Thủ quỹ lập phiếu chi. Chưa giữ tiền."),
  ).toBeVisible();
  assert(
    (await db.db.collection("finance_ledger").countDocuments()) === 0,
    "approval-no-ledger-or-payment",
  );
  await capture(page, "approved-detail");
  await d.getByRole("button", { name: "Đóng", exact: true }).click();
  const rejected = await publicProposal(ss2, "Đề xuất cần từ chối");
  await page.getByRole("button", { name: "Tải lại", exact: true }).click();
  await page.getByRole("button", { name: `Xem ${rejected.code}`, exact: true }).click();
  d = page.getByRole("dialog", { name: "Chi tiết đề xuất chi", exact: true });
  await d.getByRole("button", { name: "Từ chối", exact: true }).click();
  d = page.getByRole("dialog", { name: "Từ chối đề xuất", exact: true });
  await d.getByLabel("Lý do từ chối", { exact: true }).fill("Cần điều chỉnh nội dung synthetic");
  await d.getByRole("button", { name: "Xem trước", exact: true }).click();
  d = page.getByRole("dialog", { name: "Xác nhận quyết định", exact: true });
  await d.getByRole("button", { name: "Xác nhận quyết định", exact: true }).click();
  d = page.getByRole("dialog", { name: "Chi tiết đề xuất chi", exact: true });
  await expect(d.getByText("Cần điều chỉnh nội dung synthetic", { exact: true })).toBeVisible();
  assert(
    (await ps.call(`${base}/${rejected.id}`)).payload.data.state === "rejected",
    "reject-reason-persisted",
  );
  await capture(page, "rejected-detail");
  await d.getByRole("button", { name: "Đóng", exact: true }).click();
  const own = await publicProposal(ps, "Đề xuất do người duyệt gửi", "321");
  await page.getByRole("button", { name: "Tải lại", exact: true }).click();
  await page.getByRole("button", { name: `Xem ${own.code}`, exact: true }).click();
  d = page.getByRole("dialog", { name: "Chi tiết đề xuất chi", exact: true });
  await d.getByText("Nội dung: Đề xuất do người duyệt gửi", { exact: true }).waitFor();
  assert(
    (await d.getByRole("button", { name: "Duyệt", exact: true }).count()) === 0,
    "approver-self-decision-hidden",
  );
  await d.getByRole("button", { name: "Đóng", exact: true }).click();
  await login(page, c, treasurer);
  await page.getByRole("button", { name: `Xem ${own.code}`, exact: true }).click();
  d = page.getByRole("dialog", { name: "Chi tiết đề xuất chi", exact: true });
  await d.getByText("Nội dung: Đề xuất do người duyệt gửi", { exact: true }).waitFor();
  assert(
    (await d.getByRole("button", { name: "Duyệt", exact: true }).count()) === 0,
    "treasurer-read-all-does-not-grant-approval",
  );
  await d.getByRole("button", { name: "Đóng", exact: true }).click();
  await capture(page, "treasurer-read-all");
  const settings = (await ps.call(`${finance}/settings`)).payload.data.settings;
  assert(
    (
      await ps.call(
        `${finance}/settings`,
        { proposerRoles: ["secretary", "treasurer", "ministry_lead"], approverRole: "secretary" },
        { method: "PATCH", version: settings.version },
      )
    ).status === 200,
    "switch-approver-public-config",
  );
  await login(page, c, secretary);
  await page.getByLabel("Phạm vi", { exact: true }).waitFor();
  await page.getByRole("button", { name: `Xem ${own.code}`, exact: true }).click();
  d = page.getByRole("dialog", { name: "Chi tiết đề xuất chi", exact: true });
  await expect(d.getByRole("button", { name: "Duyệt", exact: true })).toBeVisible();
  assert(
    (await ss.call(`${finance}/ledger`)).status === 403,
    "configured-secretary-approver-not-income-reader",
  );
  await capture(page, "configured-secretary-approver");
  await d.getByRole("button", { name: "Đóng", exact: true }).click();
  await page.getByLabel("Phạm vi", { exact: true }).selectOption("all");
  await expect(page.getByRole("button", { name: `Xem ${own.code}`, exact: true })).toBeVisible();
  const currentSettings = (await ps.call(`${finance}/settings`)).payload.data.settings;
  assert(
    (
      await ps.call(
        `${finance}/settings`,
        { proposerRoles: ["secretary", "treasurer", "ministry_lead"], approverRole: "pastor" },
        { method: "PATCH", version: currentSettings.version },
      )
    ).status === 200,
    "revoke-approver-keep-proposer-public-config",
  );
  await page.getByRole("button", { name: "Tải lại", exact: true }).click();
  await expect(page.getByLabel("Phạm vi", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: `Xem ${own.code}`, exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: `Xem ${first.code}`, exact: true })).toBeVisible();
  assert(true, "scope-narrows-without-retained-other-proposals");
  await capture(page, "permission-narrowed-own-scope");
  await login(page, c, lead);
  assert(
    (await page.getByRole("button", { name: "Dâng hiến & Quỹ", exact: true }).count()) === 0,
    "lead-no-income-menu",
  );
  assert((await ls.call(`${finance}/giving-codes`)).status === 403, "lead-no-giving-data");
  await capture(page, "lead-own-scope");
  await login(page, c, member, false);
  assert(
    (await page.getByRole("button", { name: "Đề xuất chi & Duyệt", exact: true }).count()) === 0,
    "member-no-expense-menu",
  );
  await page.goto(`${conf.origin}/h/${c.code}/expense`);
  await expect(page.getByRole("heading", { name: "Cổng tín hữu", exact: true })).toBeVisible();
  assert(
    new URL(page.url()).pathname.endsWith("/portal"),
    "member-expense-deeplink-returns-to-portal",
  );
  assert((await ms.call(base)).status === 403, "member-expense-api-denied");
  assert(
    (await ms.call(`${base}/${first.id}/attachment`)).status === 403,
    "P72-member-attachment-api-denied",
  );
  assert(
    (await page.getByRole("table").count()) === 0,
    "member-deeplink-denied-without-proposal-data",
  );
  await capture(page, "member-denied-deeplink");
  await login(page, c, pastor);
  await page.getByRole("button", { name: "Cấu hình", exact: true }).click();
  const config = page.getByRole("region", { name: "Cấu hình tài chính" });
  await config.getByLabel("Thư ký Ban Chấp sự", { exact: true }).uncheck();
  await config.getByLabel("Duyệt theo hạn mức", { exact: true }).selectOption("on");
  await config.getByLabel("Ngưỡng VND", { exact: true }).fill("5000000");
  await config.getByLabel("Dưới ngưỡng", { exact: true }).selectOption("secretary");
  await config.getByLabel("Từ ngưỡng", { exact: true }).selectOption("pastor");
  await capture(page, "p73-w12-threshold-edit");
  await config.getByRole("button", { name: "Xem trước", exact: true }).click();
  const reviewConfig = page.getByRole("dialog", {
    name: "Xem trước cấu hình duyệt chi",
    exact: true,
  });
  await expect(reviewConfig.getByText("Duyệt theo hạn mức: Bật", { exact: true })).toBeVisible();
  assert(
    (await ps.call(`${finance}/settings`)).payload.data.settings.approvalThreshold === null,
    "P73-W12-preview-does-not-save",
  );
  await capture(page, "p73-w12-threshold-preview");
  await reviewConfig.getByRole("button", { name: "Lưu", exact: true }).click();
  await expect(page.getByText("Đã lưu.", { exact: true }).first()).toBeVisible();
  const savedRule = (await ps.call(`${finance}/settings`)).payload.data.settings.approvalThreshold;
  assert(
    savedRule.amount === "5000000" &&
      savedRule.belowRole === "secretary" &&
      savedRule.atOrAboveRole === "pastor",
    "P73-W12-saved-two-bands",
  );
  const lower = await publicProposal(ls, "P73 dưới ngưỡng synthetic", "4999999");
  const equal = await publicProposal(ls, "P73 bằng ngưỡng synthetic", "5000000");
  await login(page, c, secretary);
  await expect(page.getByLabel("Phạm vi", { exact: true })).toHaveValue("review");
  await expect(page.getByRole("button", { name: `Xem ${lower.code}`, exact: true })).toBeVisible();
  assert(
    (await page.getByRole("button", { name: `Xem ${equal.code}`, exact: true }).count()) === 0 &&
      (await page.getByRole("button", { name: "Tạo đề xuất chi", exact: true }).count()) === 0,
    "P73-W10-review-only-role-stays-in-band",
  );
  await capture(page, "p73-w10-review-queue");
  await page.getByRole("button", { name: `Xem ${lower.code}`, exact: true }).click();
  d = page.getByRole("dialog", { name: "Chi tiết đề xuất chi", exact: true });
  await expect(
    d.getByText("Cấp duyệt theo hạn mức: Thư ký Ban Chấp sự", { exact: true }),
  ).toBeVisible();
  await capture(page, "p73-w10-assigned-detail");
  await d.getByRole("button", { name: "Duyệt", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Duyệt đề xuất", exact: true })
    .getByRole("button", { name: "Xem trước", exact: true })
    .click();
  await page.getByRole("button", { name: "Xác nhận quyết định", exact: true }).click();
  await expect(d.getByText("Đã duyệt, chờ chi", { exact: true })).toBeVisible();
  assert(
    (await ps.call(`${base}/${lower.id}`)).payload.data.decision.actorRole === "secretary",
    "P73-W10-decision-uses-assigned-role",
  );
  await d.getByRole("button", { name: "Đóng", exact: true }).click();
  await expect(page.getByRole("button", { name: `Xem ${lower.code}`, exact: true })).toHaveCount(0);
  assert(errors.length === 0, "no-page-errors");
  assert(!secrets.some((s) => JSON.stringify(logs).includes(s)), "logs-no-passwords");
  await Bun.write(
    `${evidence}/browser-results.json`,
    JSON.stringify(
      {
        status: "PASS",
        checks,
        errors,
        limits: [
          "Firefox/private CA/local synthetic only",
          "No P5.4 payment/real data/physical/Safari/UAT/mainruntime/production proof",
          "UI-POSTP8-01 alignment remains deferred after P8",
        ],
      },
      null,
      2,
    ),
  );
} catch (e) {
  await page.screenshot({ path: `${evidence}/failure.png`, fullPage: true });
  await Bun.write(
    `${evidence}/browser-failure.json`,
    JSON.stringify({ checks, error: e instanceof Error ? e.message : String(e) }, null, 2),
  );
  throw e;
} finally {
  await context.close();
  if (server) await server.stop(true);
  await db.db.dropDatabase();
  const removed = !(await db.db.admin().listDatabases()).databases.some(
    (d) => d.name === conf.database,
  );
  await Bun.write(
    `${evidence}/browser-cleanup.json`,
    JSON.stringify({ removed, database: conf.database }),
  );
  await db.client.close();
  if (rate.client.isOpen) rate.client.destroy();
}
