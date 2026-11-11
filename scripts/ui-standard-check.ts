import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// Deliberately small guard for this standard, not a general CSS linter.
const root = join(import.meta.dir, ".."),
  sourceRoot = join(root, "../documents");
const sourceName = readdirSync(sourceRoot).find(
  (name) => name.normalize("NFC") === "Quản lý Hội Thánh Tin Lành(1).html",
);
if (!sourceName) throw new Error("Missing approved HTML reference");
const original = readFileSync(join(sourceRoot, sourceName), "utf8");
const provenance = JSON.parse(readFileSync(join(root, "web/ui/source.json"), "utf8"));
const hash = createHash("sha256").update(original).digest("hex");
if (hash !== provenance.sha256)
  throw new Error("Approved HTML hash changed; review source revision before adopting it");
const start = original.indexOf(":root{\n  --bg"),
  end = original.indexOf("</style>", start),
  css = original.slice(start, end);
const normalize = (s: string) =>
  s
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\s/g, "")
    .replace(/;}/g, "}")
    .replace(/\[hidden=(?:"until-found"|until-found)i\]/g, '[hidden="until-found"i]')
    .replace(/(^|[^\d])0\.(\d+)/g, "$1.$2")
    .replace(/#[a-fA-F\d]{3,8}/g, (hex) => hex.toLowerCase());
const prelude = original.match(/<style>([\s\S]*?)<\/style>/)?.[1] ?? "";
if (normalize(prelude) !== normalize(readFileSync(join(root, "web/ui/styles/prelude.css"), "utf8")))
  throw new Error("Original HTML prelude drifted");
const extracted = ["tokens", "base", "patterns"]
  .map((name) => readFileSync(join(root, `web/ui/styles/${name}.css`), "utf8"))
  .join("\n");
if (normalize(css) !== normalize(extracted))
  throw new Error("Extracted source CSS drifted from the approved HTML");
const walk = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)],
  );
const features = walk(join(root, "web")).filter(
  (p) => !p.includes("/ui/") && /\.(tsx|css)$/.test(p),
);
for (const path of features) {
  const text = readFileSync(path, "utf8");
  if (path.endsWith(".tsx")) {
    if (/<(button|input|select|textarea|dialog|svg)\b/.test(text))
      throw new Error(`${path}: use the shared control primitives`);
    if (/style=|#[a-fA-F\d]{3,8}\b|rgba?\(|font-family|font-size/.test(text))
      throw new Error(`${path}: feature-level visual override`);
  } else {
    if (
      /#[a-fA-F\d]{3,8}\b|rgba?\(|(?:^|[;{\s])(?:color|background(?:-color)?|font(?:-family|-size|-weight)?|border(?:-color|-radius)?|box-shadow)\s*:/m.test(
        text,
      )
    )
      throw new Error(`${path}: presentation belongs in the shared kit`);
    if (/\.(btn|input|select|card|modal|drawer|side|top|pill|kv|tab)(?![\w-])/.test(text))
      throw new Error(`${path}: cannot override shared primitives`);
    for (const query of text.matchAll(/@media[^{}]+/g))
      if (!/^@media\s*\(max-width:\s*(900|560)px\)\s*$/.test(query[0]))
        throw new Error(`${path}: breakpoint outside source standard`);
  }
}
console.info(
  `UI-STD-r1 PASS: source SHA256 ${hash}; CSS tokens/base/patterns unchanged; ${features.length} feature files use the shared standard.`,
);
