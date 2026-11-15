import { mkdir } from "node:fs/promises";
import { firefox, type Page } from "@playwright/test";
import { createApp } from "../api/app";
import type { Config } from "../api/config";
import { Identity } from "../api/identity/service";
import { Database, initialize } from "../api/infrastructure/database";
import { RateLimit } from "../api/infrastructure/rate-limit";
import { localTls } from "./local-tls";
import { check, SyntheticClient, syntheticOwner } from "./p2-fixtures";
import { p46Workflow } from "./p46-workflow";

if (process.platform !== "linux" || !process.env.CHURCH_BROWSER_CONTAINER)
  throw new Error("Use isolated browser container");
const evidence = process.env.CHURCH_EVIDENCE_DIR ?? "output/p4.6/browser",
  tls = await localTls("/tmp/church-p46-tls"),
  conf: Config = {
    origin: "https://localhost:3491",
    port: 3491,
    cert: tls.cert,
    key: tls.key,
    mongoUrl: "mongodb://host.docker.internal:27119/?replicaSet=church-local&directConnection=true",
    redisUrl: "redis://host.docker.internal:6391",
    database: `church_cms_test_browser_p46_${crypto.randomUUID().replaceAll("-", "")}`,
    csrfKey: crypto.randomUUID() + crypto.randomUUID(),
  };
await mkdir(evidence, { recursive: true });
await mkdir("/tmp/church-p46-firefox", { recursive: true });
for (const cmd of [
  ["certutil", "-N", "--empty-password", "-d", "sql:/tmp/church-p46-firefox"],
  [
    "certutil",
    "-A",
    "-d",
    "sql:/tmp/church-p46-firefox",
    "-n",
    "Church P46 private CA",
    "-t",
    "C,,",
    "-i",
    tls.ca,
  ],
])
  check(Bun.spawnSync(cmd).exitCode === 0, "private Firefox trust");
const context = await firefox.launchPersistentContext("/tmp/church-p46-firefox", {
  headless: true,
  viewport: { width: 1440, height: 1000 },
});
context.setDefaultTimeout(15000);
context.setDefaultNavigationTimeout(15000);
const db = new Database(conf),
  rate = new RateLimit(conf.redisUrl, conf.csrfKey),
  checks: string[] = [],
  errors: string[] = [],
  secrets: string[] = [];
const assert = (ok: unknown, label: string) => {
  check(ok, label);
  checks.push(label);
};
let server: ReturnType<typeof Bun.serve> | undefined;
async function capture(page: Page, name: string) {
  for (const theme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: theme });
    for (const width of [1440, 901, 900, 560, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.evaluate(async () => {
        await document.fonts.ready;
        window.scrollTo(0, 0);
      });
      const layout = await page.evaluate(() => ({
        overflow: document.documentElement.scrollWidth > innerWidth + 1,
        dialogs: document.querySelectorAll("dialog[open]").length,
        privateText: document.body.innerText.includes("Marker riêng tư P46 synthetic"),
      }));
      assert(
        !layout.overflow && layout.dialogs <= 1 && !layout.privateText,
        `${name}-${theme}-${width}-layout-private-boundary`,
      );
      if (width === 1440 || width === 390)
        await page.screenshot({
          path: `${evidence}/${name}-${width}-${theme}.png`,
          fullPage: true,
        });
    }
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.emulateMedia({ colorScheme: "light" });
  await page.keyboard.press("Tab");
  assert(
    await page.evaluate(
      () => document.activeElement !== document.body && document.activeElement !== null,
    ),
    `${name}-keyboard-focus`,
  );
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
    port: conf.port,
    tls: { cert: Bun.file(tls.cert), key: Bun.file(tls.key) },
    fetch: (req) => app(req, { ip: crypto.randomUUID() }),
  });
  const client = (realm: "owner" | "church") =>
      new SyntheticClient(realm, conf.origin, (req) => app(req, { ip: crypto.randomUUID() })),
    owner = client("owner"),
    actor = await syntheticOwner(db, owner),
    flow = await p46Workflow(db, owner, actor.id, client, assert);
  secrets.push(actor.password, flow.secretaryAccount.password, flow.pastorAccount.password);
  for (const realm of ["owner", "church"] as const) {
    const page = await context.newPage();
    page.on("pageerror", (e) => errors.push(e.message));
    const prefix = realm === "owner" ? `/owner/churches/${flow.c.id}` : `/h/${flow.c.code}`,
      login = realm === "owner" ? "/owner/login" : `/h/${flow.c.code}/login`,
      account = realm === "owner" ? actor : flow.secretaryAccount;
    await page.goto(`${conf.origin}${login}`);
    await page.getByLabel("Email", { exact: true }).fill(account.email);
    await page.getByLabel("Mật khẩu", { exact: true }).fill(account.password);
    await page.getByRole("button", { name: "Đăng nhập", exact: true }).click();
    await page
      .getByRole("button", {
        name: realm === "owner" ? "Thêm Hội Thánh" : "Chăm sóc & Cầu thay",
        exact: true,
      })
      .waitFor();
    const screens = [
      {
        name: "w07",
        path: `/worship?programId=${flow.program.id}&programRevision=1`,
        heading: "Chương trình sinh hoạt ban",
      },
      {
        name: "w08",
        path: `/care?careSection=suggestions&careSuggestionId=${flow.visit.alertId}&caseId=${flow.visit.id}`,
        heading: "Đề nghị chăm sóc",
      },
      { name: "w01", path: "/overview", heading: flow.c.name },
      { name: "w13", path: "/roles", heading: "Phân quyền" },
    ];
    for (const screen of screens) {
      await page.goto(`${conf.origin}${prefix}${screen.path}`);
      await page.getByRole("heading", { name: screen.heading, exact: true }).first().waitFor();
      assert(
        new URL(page.url()).pathname === `${prefix}${screen.path.split("?")[0]}`,
        `${realm}-${screen.name}-route`,
      );
      await capture(page, `${realm}-${screen.name}`);
    }
    // Render the same immutable edition through the authenticated print caller.
    await page.goto(
      `${conf.origin}/api/v1/${realm === "owner" ? "owner/" : ""}churches/${flow.c.id}/programs/drafts/${flow.program.id}/print?version=1&revision=1`,
    );
    await page.getByRole("button", { name: "In chương trình", exact: true }).waitFor();
    assert(
      await page.getByText("Tiết mục sửa tay P4.6 synthetic", { exact: true }).isVisible(),
      `${realm}-program-edition-print`,
    );
    await page.screenshot({ path: `${evidence}/${realm}-program-print.png`, fullPage: true });
    await page.close();
  }
  assert(errors.length === 0, "no-browser-runtime-errors");
  await Bun.write(
    `${evidence}/browser-results.json`,
    JSON.stringify(
      {
        status: "PASS",
        checks,
        errors,
        engine: "Firefox Playwright/private CA",
        bundleIndexSha256: new Bun.CryptoHasher("sha256")
          .update(await Bun.file("dist/index.html").arrayBuffer())
          .digest("hex"),
        limits: [
          "Cross-package read/navigation/responsive/keyboard/print; write/pending/reauth proof supplied by domain regression runners separately",
          "Local/synthetic only; no physical/Safari/nativeWord/UAT/mainruntime/production/independentreview",
        ],
      },
      null,
      2,
    ),
  );
  console.info(JSON.stringify({ status: "PASS", checks: checks.length }));
} catch (error) {
  const safe = secrets.reduce((s, v) => s.replaceAll(v, "[REDACTED]"), String(error));
  await Bun.write(
    `${evidence}/browser-failure.json`,
    JSON.stringify({ status: "FAIL", message: safe, checks, errors }, null, 2),
  );
  throw new Error(safe);
} finally {
  await context.close();
  await server?.stop(true);
  await db.db.dropDatabase();
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
