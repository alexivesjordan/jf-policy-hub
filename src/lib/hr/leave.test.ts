import { describe, expect, it } from "vitest";
import {
  bankHolidaysInsideYear,
  bookedWorkingDays,
  bradfordReview,
  carryOver,
  leaveYearContaining,
  openingBalance,
  proratedAllowance,
} from "./leave";

const holidays = ["2027-04-02", "2027-04-05", "2027-05-03", "2027-05-31"];

describe("leave year", () => {
  it("keeps 30 April 2027 in the year that started 1 May 2026", () => {
    expect(leaveYearContaining("2027-04-30")).toEqual({ start: "2026-05-01", end: "2027-04-30" });
  });

  it("starts the next year on 1 May 2027", () => {
    expect(leaveYearContaining("2027-05-01")).toEqual({ start: "2027-05-01", end: "2028-04-30" });
  });
});

describe("booked days", () => {
  it("counts a half day once when the request is a single day", () => {
    expect(bookedWorkingDays("2027-05-04", "2027-05-04", holidays, { startHalf: true })).toBe(0.5);
    expect(bookedWorkingDays("2027-05-04", "2027-05-06", holidays, { startHalf: true, endHalf: true })).toBe(2);
  });

  it("does not count a bank holiday as a booked day under either rule", () => {
    expect(bookedWorkingDays("2027-05-03", "2027-05-04", holidays)).toBe(1);
  });

  it("deducts bank holidays at the year start only when they sit inside the allowance", () => {
    const year = leaveYearContaining("2027-05-01");
    expect(bankHolidaysInsideYear(year, holidays, "on_top")).toBe(0);
    expect(bankHolidaysInsideYear(year, holidays, "inside")).toBe(2);
    expect(openingBalance({ entitlement: 20, carriedOver: 0, year, holidays, rule: "inside" })).toBe(18);
    expect(openingBalance({ entitlement: 20, carriedOver: 1, year, holidays, rule: "on_top" })).toBe(21);
  });
});

describe("pro-rating and carry-over", () => {
  it("pro-rates a starter and a leaver to the nearest half day", () => {
    const year = { start: "2026-05-01", end: "2027-04-30" };
    expect(proratedAllowance(20, year, "2026-11-01", null)).toBeGreaterThan(0);
    expect(proratedAllowance(20, year, "2026-11-01", null)).toBeLessThan(20);
    expect(proratedAllowance(20, year, "2027-05-01", null)).toBe(0);
    expect(proratedAllowance(20, year, "2026-05-01", "2026-10-31")).toBeLessThan(20);
  });

  it("caps carry-over", () => {
    expect(carryOver(8, 5)).toBe(5);
    expect(carryOver(2, 5)).toBe(2);
    expect(carryOver(-1, 5)).toBe(0);
  });
});

describe("absence review", () => {
  it("flags a heavy pattern and leaves a light one alone", () => {
    expect(bradfordReview(4, 13)).toBe(true);
    expect(bradfordReview(1, 2)).toBe(false);
  });
});
