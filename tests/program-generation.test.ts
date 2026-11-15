import { describe, expect, test } from "bun:test";
import { generateRows, mergeGenerated } from "../api/programs/generation";
import { commandInput, type ProgramRow } from "../api/programs/validation";
import { programCommand } from "../scripts/p42-fixtures";

describe("P42 deterministic template field merge", () => {
  test("seven slots, own speaker only, distinct unassigned and not applicable", () => {
    const a = generateRows([{ id: "own" }], "Giăng 15", "Synthetic", "foreign");
    expect(a).toHaveLength(7);
    expect(a[3]?.detail).toBe("Giăng 15 · Synthetic");
    expect(a[3]?.assignment).toEqual({ mode: "unassigned" });
    const b = generateRows([{ id: "own" }], null, null, "own", a);
    expect(b.map((r) => r.id)).toEqual(a.map((r) => r.id));
    expect(b[3]?.assignment).toEqual({ mode: "member", memberId: "own" });
    expect(
      generateRows([], null, null, null).every((r) => r.assignment.mode === "unassigned"),
    ).toBe(true);
  });
  test("manual fields, order, custom and deletion survive regeneration; untouched content refreshes", () => {
    const base = generateRows([{ id: "a" }], "Old", "Theme", "a"),
      current = structuredClone(base);
    (current[0] as ProgramRow).title = "Thủ công";
    (current[1] as ProgramRow).assignment = { mode: "not_applicable" };
    (current[3] as ProgramRow).detail = "Nội dung riêng";
    current.splice(4, 1);
    current.reverse();
    const custom: ProgramRow = {
      id: crypto.randomUUID(),
      templateKey: null,
      title: "Tùy chọn",
      detail: "Manual",
      assignment: { mode: "unassigned" },
    };
    current.push(custom);
    const next = generateRows([{ id: "b" }], "New", "Theme", "b", base),
      merged = mergeGenerated(current, base, next);
    expect(merged.map((r) => r.id)).toEqual(current.map((r) => r.id));
    expect(merged.find((r) => r.templateKey === "guide")?.title).toBe("Thủ công");
    expect(merged.find((r) => r.templateKey === "praise")?.assignment).toEqual({
      mode: "not_applicable",
    });
    expect(merged.find((r) => r.templateKey === "word")?.detail).toBe("Nội dung riêng");
    expect(merged.find((r) => r.templateKey === "discussion")).toBeUndefined();
    expect(merged.at(-1)).toEqual(custom);
    expect(merged.find((r) => r.templateKey === "closing")?.assignment).toEqual({
      mode: "member",
      memberId: "b",
    });
  });
  test("1–50 unique rows and template keys, strict assignment and command", () => {
    const row = (): ProgramRow => ({
      id: crypto.randomUUID(),
      templateKey: null,
      title: "Synthetic",
      detail: "",
      assignment: { mode: "unassigned" },
    });
    for (const n of [1, 50])
      expect(
        commandInput.safeParse(programCommand("save", { rows: Array.from({ length: n }, row) }))
          .success,
      ).toBe(true);
    for (const n of [0, 51])
      expect(
        commandInput.safeParse(programCommand("save", { rows: Array.from({ length: n }, row) }))
          .success,
      ).toBe(false);
    const r = row();
    expect(commandInput.safeParse(programCommand("save", { rows: [r, r] })).success).toBe(false);
    expect(commandInput.safeParse({ ...programCommand("create"), extra: 1 }).success).toBe(false);
  });
});
