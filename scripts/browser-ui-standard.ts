import { createHash } from "node:crypto";
import { mkdir, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { firefox, type Page } from "@playwright/test";
import { localTls } from "./local-tls";

const evidence = process.env.CHURCH_EVIDENCE_DIR ?? "output/p1.3";
if (process.platform !== "linux" || !process.env.CHURCH_BROWSER_CONTAINER)
  throw new Error("Use the isolated browser container");
const origin = "https://localhost:3449",
  tls = await localTls("/tmp/church-ui-tls");
await mkdir("output", { recursive: true });
await mkdir("/tmp/church-ui-firefox", { recursive: true });
for (const command of [
  ["certutil", "-N", "--empty-password", "-d", "sql:/tmp/church-ui-firefox"],
  [
    "certutil",
    "-A",
    "-d",
    "sql:/tmp/church-ui-firefox",
    "-n",
    "UI verification CA",
    "-t",
    "C,,",
    "-i",
    tls.ca,
  ],
]) {
  if (Bun.spawnSync(command).exitCode !== 0) throw new Error("Isolated certificate import failed");
}
const referenceName = (await readdir("reference")).find(
  (name) => name.normalize("NFC") === "Quản lý Hội Thánh Tin Lành(1).html",
);
if (!referenceName) throw new Error("Missing reference HTML");
const reference = await readFile(join("reference", referenceName), "utf8");
const sourceHash = createHash("sha256").update(reference).digest("hex");
if (sourceHash !== "4bdc4ebdb3bcc7ccb98e675162ef9f14568c46bf9b1ad2d38c9a979cda2dc8b6")
  throw new Error("Reference hash mismatch");
const originalStyles = Array.from(
  reference.matchAll(/<style>([\s\S]*?)<\/style>/g),
  (m) => m[1],
).join("\n");
const compiledCssName = (await readdir("ui-reference-dist/assets")).find((name) =>
  name.endsWith(".css"),
);
if (!compiledCssName) throw new Error("Missing reference build");
const compiledCss = await readFile(join("ui-reference-dist/assets", compiledCssName), "utf8");
const fonts = Array.from(compiledCss.matchAll(/@font-face\{[^}]+\}/g), (m) => m[0]).join("\n");
// Independent markup of the original common patterns; no React CSS/adapters on this page.
// O01/O02 do not exist literally in the source. This compares shared patterns only.
const fixture = `<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${fonts}\n${originalStyles}</style></head><body><div class="content">
<section class="card" data-compare="card"><div class="card-h"><h3>Thông tin Hội Thánh</h3><div><button class="btn" type="button">Sửa</button></div></div><div class="form" data-compare="form"><label>Tên Hội Thánh<input class="input" data-compare="input" value="Hội Thánh Bình An"></label><label>Tỉnh/Thành<select class="select" data-compare="select"><option>Đà Nẵng</option></select></label></div></section>
<div class="toolbar"><button type="button" class="btn pri" data-compare="primary"><svg class="i" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>Thêm Hội Thánh</button><button type="button" class="btn" data-compare="secondary">Hủy</button><span class="pill p-good">Hoạt động</span></div>
<section class="card"><div class="kv"><span>Mã Hội Thánh</span><b>HT-0001</b><span>Tỉnh/Thành</span><b>Đà Nẵng</b></div></section>
<div class="tbl-wrap"><table><thead><tr><th data-compare="th">Tên Hội Thánh</th><th>Tỉnh/Thành</th></tr></thead><tbody><tr><td data-compare="td">Hội Thánh Bình An</td><td>Đà Nẵng</td></tr></tbody></table></div></div></body></html>`;
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 3449,
  tls: { cert: Bun.file(tls.cert), key: Bun.file(tls.key) },
  fetch(req) {
    const path = new URL(req.url).pathname;
    if (path === "/source")
      return new Response(fixture, { headers: { "content-type": "text/html; charset=utf-8" } });
    if (path === "/" || path === "/ui-reference.html")
      return new Response(Bun.file("ui-reference-dist/ui-reference.html"));
    if (/^\/assets\/[a-zA-Z0-9_.-]+$/.test(path))
      return new Response(Bun.file(`ui-reference-dist${path}`));
    return new Response(null, { status: 404 });
  },
});
const context = await firefox.launchPersistentContext("/tmp/church-ui-firefox", {
  headless: true,
  viewport: { width: 1440, height: 1000 },
});
const actual = await context.newPage(),
  source = await context.newPage(),
  errors: string[] = [],
  results: { check: string; status: string }[] = [],
  differences: unknown[] = [];
actual.on("pageerror", (e) => errors.push(e.message));
const assert = (condition: unknown, check: string) => {
  if (!condition) throw new Error(check);
  results.push({ check, status: "PASS" });
  console.info(check);
};
const ready = async (page: Page) => {
  await page.locator(".content").first().waitFor();
  await page.evaluate(() => document.fonts.ready);
};
const style = async (page: Page, selector: string, properties: string[]) =>
  page
    .locator(selector)
    .first()
    .evaluate((el, keys) => {
      const s = getComputedStyle(el);
      return Object.fromEntries(keys.map((k) => [k, s.getPropertyValue(k)]));
    }, properties);
const visualProperties = [
  "background-color",
  "color",
  "border-top-color",
  "border-top-width",
  "border-radius",
  "padding-top",
  "padding-right",
  "padding-bottom",
  "padding-left",
  "font-family",
  "font-size",
  "font-weight",
  "line-height",
];
try {
  for (const theme of ["light", "dark"] as const) {
    await actual.emulateMedia({ colorScheme: theme });
    await source.emulateMedia({ colorScheme: theme });
    for (const width of [1440, 1024, 901, 900, 768, 561, 560, 390]) {
      await actual.setViewportSize({ width, height: 1000 });
      await source.setViewportSize({ width, height: 1000 });
      await actual.goto(`${origin}/?fixture=1`);
      await source.goto(`${origin}/source`);
      await ready(actual);
      await ready(source);
      for (const name of ["card", "primary", "secondary", "input", "select", "th", "td"]) {
        const selector = `[data-compare="${name}"]`,
          expected = await style(source, selector, visualProperties),
          observed = await style(actual, selector, visualProperties);
        const mismatches = visualProperties.filter((key) => {
          // Approved mobile usability adaptation; all other visual properties remain compared.
          if (
            width <= 560 &&
            ["input", "select"].includes(name) &&
            ["font-size", "line-height"].includes(key)
          )
            return false;
          return expected[key] !== observed[key];
        });
        if (mismatches.length)
          differences.push({ theme, width, name, mismatches, expected, observed });
        assert(mismatches.length === 0, `${theme}-${width}-${name}-source-style`);
      }
      for (const [name, sourceSelector, actualSelector] of [
        ["kv-label", ".kv span", ".ui-kv dt"],
        ["kv-value", ".kv b", ".ui-kv dd"],
      ] as const) {
        const properties = ["color", "font-family", "font-size", "font-weight", "line-height"];
        assert(
          JSON.stringify(await style(source, sourceSelector, properties)) ===
            JSON.stringify(await style(actual, actualSelector, properties)),
          `${theme}-${width}-${name}-source-style`,
        );
      }
      const expectedForm = await style(source, ".form", ["grid-template-columns", "gap"]),
        observedForm = await style(actual, ".form", ["grid-template-columns", "gap"]);
      assert(
        JSON.stringify(expectedForm) === JSON.stringify(observedForm),
        `${theme}-${width}-form-grid-source`,
      );
      const box = await actual.locator('[data-compare="primary"]').boundingBox(),
        sourceBox = await source.locator('[data-compare="primary"]').boundingBox();
      assert(
        !!box &&
          !!sourceBox &&
          Math.abs(box.width - sourceBox.width) < 0.5 &&
          (width <= 560 ? box.height >= 44 : Math.abs(box.height - sourceBox.height) < 0.5),
        `${theme}-${width}-button-geometry`,
      );
      assert(
        await actual.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        `${theme}-${width}-bounded-table-no-page-overflow`,
      );
      if ([1440, 390].includes(width)) {
        await actual.screenshot({
          path: `${evidence}/regression/ui-std-patterns-${width}-${theme}.png`,
        });
        await source.screenshot({
          path: `${evidence}/regression/ui-std-source-patterns-${width}-${theme}.png`,
        });
      }
    }
  }
  await actual.locator(".tbl-wrap").focus();
  await actual.keyboard.press("ArrowRight");
  await actual.waitForFunction(() => (document.querySelector(".tbl-wrap")?.scrollLeft ?? 0) > 0);
  assert(true, "bounded-table-keyboard-horizontal-scroll");
  await actual.setViewportSize({ width: 1440, height: 1000 });
  await actual.emulateMedia({ colorScheme: "light" });
  await actual.goto(origin);
  await ready(actual);
  assert(
    Math.round((await actual.locator(".side").boundingBox())?.width ?? 0) === 256,
    "desktop-sidebar-source256",
  );
  assert(
    (await actual.locator(".side .ui-nav-label").isVisible()) &&
      (await actual.locator(".side .ui-nav-label").innerText()) === "Bộ UI chung",
    "gallery-shared-navigation-label-visible",
  );
  for (const width of [1440, 390]) {
    await actual.setViewportSize({ width, height: 1000 });
    const gap = await actual.getByLabel("Giao diện", { exact: true }).evaluate((control) => {
      const field = control.closest(".ui-field");
      return {
        standalone: !!field && !field.closest(".form"),
        gap:
          control.getBoundingClientRect().top -
          (field?.firstElementChild?.getBoundingClientRect().bottom ?? Infinity),
      };
    });
    assert(
      gap.standalone && Math.abs(gap.gap - 5) < 0.5,
      `${width}-standalone-Field-label-control-source-gap5`,
    );
  }
  await actual.setViewportSize({ width: 1440, height: 1000 });
  const light = await style(actual, "body", ["background-color", "color"]);
  await actual.emulateMedia({ colorScheme: "dark" });
  const dark = await style(actual, "body", ["background-color", "color"]);
  assert(light["background-color"] !== dark["background-color"], "live-OS-theme-change");
  await actual.getByLabel("Giao diện", { exact: true }).selectOption("light");
  assert(
    JSON.stringify(light) ===
      JSON.stringify(await style(actual, "body", ["background-color", "color"])),
    "explicit-light-overrides-dark-OS",
  );
  await actual.emulateMedia({ colorScheme: "light" });
  await actual.getByLabel("Giao diện", { exact: true }).selectOption("dark");
  assert(
    JSON.stringify(dark) ===
      JSON.stringify(await style(actual, "body", ["background-color", "color"])),
    "explicit-dark-overrides-light-OS",
  );
  await actual.getByLabel("Giao diện", { exact: true }).selectOption("system");
  await actual.getByRole("tab", { name: "Thông tin", exact: true }).focus();
  await actual.keyboard.press("ArrowRight");
  assert(
    (await actual
      .getByRole("tab", { name: "Lịch sử", exact: true })
      .getAttribute("aria-selected")) === "true",
    "tabs-arrow-selection",
  );
  await actual.keyboard.press("ArrowRight");
  assert(
    (await actual
      .getByRole("tab", { name: "Thông tin", exact: true })
      .getAttribute("aria-selected")) === "true",
    "tabs-skip-disabled-wrap",
  );
  await actual.screenshot({
    path: `${evidence}/regression/ui-std-gallery-desktop-light.png`,
    fullPage: true,
  });
  for (const theme of ["light", "dark"] as const) {
    await actual.emulateMedia({ colorScheme: theme });
    for (const width of [901, 900, 561, 560, 390]) {
      await actual.setViewportSize({ width, height: 844 });
      await actual.evaluate(() => window.scrollTo(0, 0));
      assert(
        (await actual.getByRole("button", { name: "Mở điều hướng", exact: true }).isVisible()) ===
          width <= 900,
        `${theme}-${width}-navigation-breakpoint`,
      );
      assert(
        await actual.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        `${theme}-${width}-gallery-root-bounded`,
      );
      await actual.getByRole("button", { name: "Mở biểu mẫu", exact: true }).click();
      const dialog = actual.getByRole("dialog", { name: "Biểu mẫu tham chiếu", exact: true }),
        rect = await dialog.boundingBox();
      assert(
        !!rect &&
          Math.abs(rect.width - Math.min(720, width - 32)) < 0.5 &&
          rect.x >= 0 &&
          rect.x + rect.width <= width,
        `${theme}-${width}-modal-source-width`,
      );
      const columns = await dialog
        .locator(".form")
        .evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(" ").length);
      assert(columns === (width <= 560 ? 1 : 2), `${theme}-${width}-modal-form-breakpoint`);
      await dialog.getByRole("button", { name: "Đóng", exact: true }).focus();
      await actual.keyboard.press("Shift+Tab");
      assert(
        await dialog
          .getByRole("button", { name: "Lưu", exact: true })
          .evaluate((el) => el === document.activeElement),
        `${theme}-${width}-modal-Tab-trap`,
      );
      await actual.getByLabel("Khóa thao tác khi chờ đối soát").check();
      await actual.keyboard.press("Escape");
      assert(
        (await dialog.isVisible()) &&
          (await dialog.getByRole("button", { name: "Đóng", exact: true }).isDisabled()),
        `${theme}-${width}-locked-modal-keeps-intent`,
      );
      await dialog.getByRole("button", { name: "Kiểm tra kết quả minh họa", exact: true }).click();
      await actual.keyboard.press("Escape");
      assert(
        await actual
          .getByRole("button", { name: "Mở biểu mẫu", exact: true })
          .evaluate((el) => el === document.activeElement),
        `${theme}-${width}-modal-return-focus`,
      );
    }
  }
  await actual.getByRole("button", { name: "Đăng xuất", exact: true }).focus();
  const tip = actual.getByRole("tooltip", { name: "Đăng xuất", exact: true });
  await tip.waitFor();
  const tipBox = await tip.boundingBox();
  assert(
    !!tipBox && tipBox.x >= 16 && tipBox.x + tipBox.width <= 374,
    "tooltip-clamped-to-mobile-viewport",
  );
  assert(
    await actual.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    "focused-tooltip-no-page-overflow",
  );
  await actual.keyboard.press("Escape");
  assert(!(await tip.isVisible()), "tooltip-Escape-dismisses");
  assert(
    await actual
      .locator(".opt")
      .first()
      .evaluate((el) => el.getBoundingClientRect().height >= 44),
    "choice-touch-target44",
  );
  await actual.getByRole("button", { name: "Mở drawer", exact: true }).click();
  const drawer = actual.getByRole("dialog", { name: "Chi tiết tham chiếu", exact: true }),
    dr = await drawer.boundingBox();
  assert(!!dr && dr.x === 0 && Math.round(dr.width) === 390, "detail-drawer-fits-mobile");
  await actual.keyboard.press("Escape");
  await actual.getByRole("button", { name: "Mở điều hướng", exact: true }).click();
  assert(
    (await actual.locator(".side .ui-nav-label").isVisible()) &&
      (await actual.locator(".side .ui-nav-label").innerText()) === "Bộ UI chung",
    "gallery-mobile-shared-navigation-label-visible",
  );
  assert(
    Math.round((await actual.locator(".side").boundingBox())?.width ?? 0) === 272,
    "mobile-navigation-source272",
  );
  await actual.keyboard.press("Shift+Tab");
  await actual.keyboard.press("Tab");
  assert(
    await actual
      .locator(".side .nav-a")
      .first()
      .evaluate((el) => el === document.activeElement),
    "mobile-navigation-focus-cycle",
  );
  await actual.keyboard.press("Escape");
  assert(
    await actual
      .getByRole("button", { name: "Mở điều hướng", exact: true })
      .evaluate((el) => el === document.activeElement),
    "mobile-navigation-return-focus",
  );
  await actual.evaluate(() => window.scrollTo(0, 0));
  await actual.screenshot({ path: `${evidence}/regression/ui-std-gallery-mobile-dark.png` });
  assert(errors.length === 0, "no-browser-script-errors");
  await Bun.write(
    `${evidence}/regression/ui-std-visual-results.json`,
    JSON.stringify(
      {
        status: "PASS",
        revision: "UI-STD-r1",
        sourceHash,
        bundleIndexSha256: createHash("sha256")
          .update(await readFile("ui-reference-dist/ui-reference.html"))
          .digest("hex"),
        checks: results,
        limits: [
          "Common pattern comparison; source has no literal owner O01/O02",
          "Approved <=560px touch/font adaptations excluded only for specified properties",
          "Firefox viewport emulation, not physical mobile/Safari",
          "No human acceptance or production proof",
        ],
      },
      null,
      2,
    ),
  );
  console.info(JSON.stringify({ status: "PASS", checks: results.length }));
} catch (error) {
  await Bun.write(
    `${evidence}/regression/ui-std-visual-failure.json`,
    JSON.stringify(
      {
        message: String(error),
        differences,
        layout: await actual.evaluate(() => ({
          width: innerWidth,
          root: document.documentElement.scrollWidth,
          boxes: Array.from(document.querySelectorAll<HTMLElement>("body *"))
            .map((el) => ({
              tag: el.tagName,
              cls: typeof el.className === "string" ? el.className : "svg",
              right: el.getBoundingClientRect().right,
              width: el.getBoundingClientRect().width,
              scroll: el.scrollWidth,
              overflow: getComputedStyle(el).overflowX,
            }))
            .filter((box) => box.right > innerWidth || box.scroll > box.width + 1),
        })),
        completed: results,
      },
      null,
      2,
    ),
  );
  await actual.screenshot({ path: `${evidence}/regression/ui-std-visual-failure.png` });
  throw error;
} finally {
  await context.close();
  await server.stop(true);
}
