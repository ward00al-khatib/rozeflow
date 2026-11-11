import { describe, expect, it } from "vitest";
import { availableDelta, formatPoints } from "./points";

describe("formatPoints", () => {
  it("shows whole points without decimals", () => {
    expect(formatPoints(100000)).toBe("1,000");
    expect(formatPoints(0)).toBe("0");
  });
  it("keeps centi-points exact", () => {
    expect(formatPoints(1960)).toBe("19.60");
    expect(formatPoints(-105)).toBe("-1.05");
  });
  it("rejects non-integers", () => {
    expect(() => formatPoints(1.5)).toThrow();
  });
});

describe("availableDelta", () => {
  it("follows spec 5.2", () => {
    expect(availableDelta("STAKE_RESERVE", 1000)).toBe(-1000);
    expect(availableDelta("STAKE_CONSUME", 1000)).toBe(0);
    expect(availableDelta("PAYOUT", 1960)).toBe(1960);
  });
});
