import { expect, test } from "bun:test";
import {
  birthdayFilterValid,
  birthdayWindow,
  businessDay,
  monthPeriod,
  shiftDay,
} from "../api/members/dates";

test("P26 explicit year-month remains compatible with month:N and Sunday week", () => {
  expect(birthdayWindow("2026-12-31", "month:2027-01")).toEqual({
    year: 2027,
    from: "2027-01-01",
    to: "2027-01-31",
  });
  expect(birthdayWindow("2026-12-31", "month:1").year).toBe(2026);
  expect(birthdayWindow("2027-01-01", "week")).toEqual({
    year: 2027,
    from: "2026-12-27",
    to: "2027-01-02",
  });
  expect(monthPeriod("2026-12-31", 1)).toBe("2027-01");
});
test("P26 timezone boundary, 30 calendar days and invalid month", () => {
  expect(businessDay(new Date("2026-12-31T17:00:00Z"))).toBe("2027-01-01");
  expect(shiftDay("2027-01-01", -29)).toBe("2026-12-03");
  for (const v of ["month:0000-01", "month:2027-13", "month:00", "bad"])
    expect(birthdayFilterValid(v)).toBe(false);
  expect(birthdayFilterValid("month:2028-02")).toBe(true);
});

test("P26 early explicit years do not receive JavaScript 1900 offset", () => {
  expect(birthdayWindow("2026-12-31", "month:0099-02")).toEqual({
    year: 99,
    from: "0099-02-01",
    to: "0099-02-28",
  });
});
