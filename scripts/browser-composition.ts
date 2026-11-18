import { mkdir } from "node:fs/promises";
import type { Page } from "@playwright/test";

interface Geometry {
  stacks: number;
  headings: number;
  gaps: { kind: string; expected: number; actual: number }[];
  issues: string[];
}
const samples = new Map<string, { state: string; geometry: Geometry }[]>();
export async function assertComposition(
  page: Page,
  state: string,
  assert: (condition: unknown, label: string) => void,
  evidence: string,
) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
  });
  const geometry = await page.evaluate(() => {
    const result: Geometry = { stacks: 0, headings: 0, gaps: [], issues: [] };
    const visible = (e: Element) => {
      const s = getComputedStyle(e);
      return (
        e.getClientRects().length > 0 &&
        s.display !== "none" &&
        !["absolute", "fixed"].includes(s.position)
      );
    };
    const measure = (a: Element, b: Element, expected: number, kind: string) => {
      const actual = b.getBoundingClientRect().top - a.getBoundingClientRect().bottom;
      result.gaps.push({ kind, expected, actual });
      if (Math.abs(actual - expected) > 1)
        result.issues.push(
          `${kind} ${a.tagName}.${a.className} → ${b.tagName}.${b.className}: expected ${expected}px, observed ${actual}px`,
        );
    };
    for (const stack of document.querySelectorAll(".ui-stack")) {
      if (!visible(stack)) continue;
      result.stacks++;
      const gap = Number.parseFloat(getComputedStyle(stack).rowGap);
      if (![6, 12, 18].includes(gap)) result.issues.push(`stack: invalid spacing ${gap}`);
      const children = Array.from(stack.children).filter(visible);
      for (let i = 1; i < children.length; i++) {
        const before = children[i - 1],
          after = children[i];
        if (before && after) measure(before, after, gap, "stack");
      }
    }
    for (const section of document.querySelectorAll(".ui-content-section")) {
      if (!visible(section)) continue;
      const heading = section.querySelector(":scope > .card-h"),
        body = section.querySelector(":scope > .ui-stack");
      if (heading && body && visible(heading) && visible(body)) {
        result.headings++;
        measure(heading, body, 12, "heading-body");
      }
    }
    return result;
  });
  const entries = samples.get(evidence) ?? [];
  entries.push({ state, geometry });
  samples.set(evidence, entries);
  await mkdir(evidence, { recursive: true });
  await Bun.write(`${evidence}/composition-geometry.json`, JSON.stringify(entries, null, 2));
  assert(
    geometry.issues.length === 0,
    `${state}-composition-gaps${geometry.issues.length ? `: ${geometry.issues.join("; ")}` : ""}`,
  );
  return geometry;
}
