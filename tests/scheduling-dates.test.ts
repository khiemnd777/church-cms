import { describe, expect, test } from "bun:test";
import { expand, type ScheduleInput, scheduleInput, times } from "../api/scheduling/validation";

const base: ScheduleInput = {
  label: "Lịch thử",
  kind: "worship",
  scope: "church",
  unitId: null,
  day: "2027-01-03",
  startTime: "07:30",
  endDay: "2027-01-03",
  endTime: "09:00",
  location: null,
  scripture: null,
  theme: null,
  speaker: null,
  leaderId: null,
  choirId: null,
  communion: false,
  repeat: { kind: "once" },
};
describe("C41 timezone and calendar rules", () => {
  test("fixed Vietnam UTC conversion and overnight", () => {
    expect(times(base).start.toISOString()).toBe("2027-01-03T00:30:00.000Z");
    const i = { ...base, startTime: "23:30", endDay: "2027-01-04", endTime: "00:30" };
    expect(times(i).end.getTime() - times(i).start.getTime()).toBe(3600000);
    expect(expand(i)[0]?.end.toISOString()).toBe("2027-01-03T17:30:00.000Z");
  });
  test("six calendar Sundays and fortnight anchored Sunday", () => {
    expect(
      expand({
        ...base,
        repeat: { kind: "weekly", interval: 1, weekdays: [0], until: "2027-02-07" },
      }).map((r) => r.day),
    ).toEqual(["2027-01-03", "2027-01-10", "2027-01-17", "2027-01-24", "2027-01-31", "2027-02-07"]);
    expect(
      expand({
        ...base,
        repeat: { kind: "weekly", interval: 2, weekdays: [0, 3], until: "2027-01-23" },
      }).map((r) => r.day),
    ).toEqual(["2027-01-03", "2027-01-06", "2027-01-17", "2027-01-20"]);
  });
  test("second and fourth Sunday, fifth absent skipped, leap February", () => {
    expect(
      expand({
        ...base,
        repeat: { kind: "monthly", weekday: 0, ordinals: [2, 4], until: "2027-02-28" },
      }).map((r) => r.day),
    ).toEqual(["2027-01-10", "2027-01-24", "2027-02-14", "2027-02-28"]);
    expect(
      expand({
        ...base,
        repeat: { kind: "monthly", weekday: 0, ordinals: [5], until: "2027-03-31" },
      }).map((r) => r.day),
    ).toEqual(["2027-01-31"]);
    expect(
      expand({
        ...base,
        day: "2028-02-01",
        endDay: "2028-02-01",
        repeat: { kind: "weekly", interval: 1, weekdays: [2], until: "2028-02-29" },
      }).at(-1)?.day,
    ).toBe("2028-02-29");
  });
  test("invalid calendar day, clock, unknown fields and duplicate rules are rejected", () => {
    for (const i of [
      { ...base, day: "2027-02-29" },
      { ...base, startTime: "24:00" },
      { ...base, hidden: true },
    ])
      expect(scheduleInput.safeParse(i).success).toBe(false);
    expect(() =>
      expand({
        ...base,
        repeat: { kind: "weekly", interval: 1, weekdays: [0, 0], until: "2027-01-10" },
      }),
    ).toThrow();
    expect(() =>
      expand({
        ...base,
        repeat: { kind: "monthly", weekday: 0, ordinals: [2, 2], until: "2027-02-28" },
      }),
    ).toThrow();
  });
  test("no truncation at 200, 365 days or empty recurrence; 24h duration boundary", () => {
    expect(() =>
      expand({
        ...base,
        repeat: {
          kind: "weekly",
          interval: 1,
          weekdays: [0, 1, 2, 3, 4, 5, 6],
          until: "2027-12-31",
        },
      }),
    ).toThrow();
    expect(() =>
      expand({
        ...base,
        repeat: { kind: "weekly", interval: 1, weekdays: [0], until: "2028-01-03" },
      }),
    ).toThrow();
    expect(() =>
      expand({
        ...base,
        repeat: { kind: "monthly", weekday: 0, ordinals: [5], until: "2027-01-04" },
      }),
    ).toThrow();
    expect(
      times({ ...base, endDay: "2027-01-04", endTime: "07:30" }).end.getTime() -
        times(base).start.getTime(),
    ).toBe(86400000);
    for (const i of [
      { ...base, endTime: "07:30" },
      { ...base, endDay: "2027-01-04", endTime: "07:31" },
      { ...base, scope: "unit" as const },
    ])
      expect(() => times(i)).toThrow();
  });
});
