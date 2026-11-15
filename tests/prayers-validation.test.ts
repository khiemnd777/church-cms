import { describe, expect, test } from "bun:test";
import { commandInput } from "../api/prayers/validation";
import { prayerCreate } from "../scripts/p44-fixtures";

describe("P4.4 strict prayer commands", () => {
  test("immutable visibility, authority fields and minimal sender types", () => {
    const b = prayerCreate();
    expect(commandInput.safeParse(b).success).toBe(true);
    for (const extra of [
      { private: true },
      { prayerAudience: "all" },
      { actorId: "123" },
      { memberId: "123" },
    ])
      expect(commandInput.safeParse({ ...b, ...extra }).success).toBe(false);
    if (b.action !== "create") throw Error();
    expect(commandInput.safeParse({ ...b, visibility: "public" }).success).toBe(false);
    expect(
      commandInput.safeParse({
        ...b,
        fields: { ...b.fields, requester: { kind: "member", id: "ABCDEF0123456789ABCDEF01" } },
      }).success,
    ).toBe(true);
    for (const x of [
      { kind: "none", name: "hidden" },
      { kind: "text", name: " " },
      { kind: "member", id: "bad" },
    ])
      expect(commandInput.safeParse({ ...b, fields: { ...b.fields, requester: x } }).success).toBe(
        false,
      );
    expect(
      commandInput.safeParse({
        action: "update",
        visibility: "pastoral",
        fields: b.fields,
        reason: "x",
        preview: null,
        confirmed: false,
      }).success,
    ).toBe(false);
  });
  test("bounded NFC content, valid nullable dates and no delete/reopen", () => {
    const b = prayerCreate();
    if (b.action !== "create") throw Error();
    expect(
      commandInput.safeParse({ ...b, fields: { ...b.fields, receivedOn: null } }).success,
    ).toBe(true);
    expect(
      commandInput.safeParse({
        ...b,
        fields: { ...b.fields, content: "x".repeat(2000) },
      }).success,
    ).toBe(true);
    for (const fields of [
      { content: " " },
      { content: "x".repeat(2001) },
      { receivedOn: "2026-02-30" },
      { category: "private" },
      { content: 0 },
    ])
      expect(commandInput.safeParse({ ...b, fields: { ...b.fields, ...fields } }).success).toBe(
        false,
      );
    for (const action of ["delete", "reopen"])
      expect(
        commandInput.safeParse({ action, reason: "x", preview: null, confirmed: true }).success,
      ).toBe(false);
    const nfc = commandInput.parse({ ...b, fields: { ...b.fields, content: "  Chu\u0301a  " } });
    if (nfc.action !== "create") throw Error();
    expect(nfc.fields.content).toBe("Chúa");
  });
});
