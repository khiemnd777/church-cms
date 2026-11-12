import { expect, test } from "bun:test";
import { ageOn, anniversary, birthdayWindow, businessDay, validDay } from "../api/members/dates";

test("calendar days and Ho Chi Minh business day preserve unknown and leap-day semantics", () => {
  expect(validDay("2024-02-29")).toBe(true);
  for (const day of ["2025-02-29", "2024-04-31", "0000-01-01", "2024-1-01", "not a date"])
    expect(validDay(day)).toBe(false);
  expect(businessDay(new Date("2026-11-10T17:00:00Z"))).toBe("2026-11-11");
  expect(ageOn(null, "2026-11-11")).toBeNull();
  expect(ageOn("2000-02-29", "2025-02-28")).toBe(24);
  expect(ageOn("2000-02-29", "2025-03-01")).toBe(25);
  expect(ageOn("2000-02-29", "2024-02-29")).toBe(24);
  expect(anniversary("2000-02-29", 2025)).toBe("2025-03-01");
  expect(birthdayWindow("2026-01-01", "week")).toEqual({
    year: 2026,
    from: "2025-12-28",
    to: "2026-01-03",
  });
  expect(birthdayWindow("2024-02-01", "month:2").to).toBe("2024-02-29");
});

import { ObjectId } from "mongodb";
import { MemberQueries } from "../api/members/queries";

test("signed cursors bind actor, tenant and policy/filter context and expire", () => {
  let now = new Date("2026-11-11T00:00:00Z");
  const queries = new MemberQueries("synthetic-cursor-key", () => now),
    grant = {
      actorKind: "owner" as const,
      actorId: new ObjectId(),
      churchId: new ObjectId(),
      policyContext: "3",
      canWrite: true,
      fence: async () => {},
    };
  const context = queries.context(grant, "members", ["An"]),
    token = queries.encode(context, "an", new ObjectId().toHexString());
  expect(queries.decode(token, context).key).toBe("an");
  for (const changed of [
    { ...grant, actorId: new ObjectId() },
    { ...grant, churchId: new ObjectId() },
    { ...grant, policyContext: "4" },
  ])
    expect(() => queries.decode(token, queries.context(changed, "members", ["An"]))).toThrow(
      "CURSOR_CONTEXT_MISMATCH",
    );
  expect(() => queries.decode(token, queries.context(grant, "members", ["Bình"]))).toThrow(
    "CURSOR_CONTEXT_MISMATCH",
  );
  expect(() => queries.decode(`${token}x`, context)).toThrow("INVALID_CURSOR");
  now = new Date(now.getTime() + 16 * 60_000);
  expect(() => queries.decode(token, context)).toThrow("CURSOR_EXPIRED");
});
