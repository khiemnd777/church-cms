import { describe, expect, test } from "bun:test";
import { ObjectId } from "mongodb";
import { commandInput } from "../api/visitation/validation";
import { careCreate, careRecord } from "../scripts/p43-fixtures";

describe("P43 strict public command", () => {
  test("member/family targets, nullable assignment and schedule, no target update or extra private flags", () => {
    const id = new ObjectId().toHexString();
    for (const kind of ["member", "family"] as const)
      expect(commandInput.safeParse(careCreate({ kind, id })).success).toBe(true);
    expect(
      commandInput.safeParse({ ...careCreate({ kind: "member", id }), private: true }).success,
    ).toBe(false);
    expect(
      commandInput.safeParse({ ...careCreate({ kind: "member", id }), action: "update" }).success,
    ).toBe(false);
  });
  test("calendar dates, NFC, reason/description limits, participants1–10 unique", () => {
    const ids = Array.from({ length: 11 }, () => new ObjectId().toHexString());
    for (const n of [1, 10])
      expect(commandInput.safeParse(careRecord(ids.slice(0, n))).success).toBe(true);
    for (const data of [
      careRecord([]),
      careRecord(ids),
      careRecord([ids[0] as string, ids[0] as string]),
      careRecord(ids.slice(0, 1), { visitedOn: "2026-02-30" }),
      careRecord(ids.slice(0, 1), { note: "x".repeat(2001) }),
    ])
      expect(commandInput.safeParse(data).success).toBe(false);
  });
});
