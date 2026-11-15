import { describe, expect, test } from "bun:test";
import { alertInput, evaluateInput, signalInput } from "../api/care/validation";
import { careDecision, signalCreate } from "../scripts/p45-fixtures";

describe("P4.5 strict commands", () => {
  test("source shape, unknown dates and immutable target/kind", () => {
    const b = signalCreate("abcdef0123456789abcdef01");
    expect(signalInput.safeParse(b).success).toBe(true);
    if (b.action !== "create") throw Error();
    for (const extra of [{ actorId: "x" }, { visibility: "pastoral" }, { episodeActive: true }])
      expect(signalInput.safeParse({ ...b, ...extra }).success).toBe(false);
    for (const fields of [
      { occurredOn: null },
      { occurredOn: "2026-02-30" },
      { summary: "x".repeat(501) },
    ])
      expect(signalInput.safeParse({ ...b, fields: { ...b.fields, ...fields } }).success).toBe(
        false,
      );
    expect(
      signalInput.safeParse({ ...b, fields: { ...b.fields, summary: "x".repeat(500) } }).success,
    ).toBe(true);
    expect(
      signalInput.safeParse({
        action: "correct",
        fields: b.fields,
        target: b.target,
        ...{ reason: "x", preview: null, confirmed: false },
      }).success,
    ).toBe(false);
  });
  test("bounded evaluate and strict decision, no direct completion/reopen", () => {
    expect(evaluateInput.safeParse({ cursor: null, limit: 100 }).success).toBe(true);
    for (const input of [
      { cursor: null, limit: 101 },
      { cursor: null, limit: 0 },
      { cursor: null, limit: 1, churchId: "x" },
    ])
      expect(evaluateInput.safeParse(input).success).toBe(false);
    expect(alertInput.safeParse(careDecision()).success).toBe(true);
    for (const action of ["complete", "reopen", "expire", "delete"])
      expect(alertInput.safeParse({ ...careDecision(), action }).success).toBe(false);
  });
});
