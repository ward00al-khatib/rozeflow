import { describe, expect, it } from "vitest";
import { LEVELS, levelOf } from "./levels";

describe("levels", () => {
  it("starts at level 1 and climbs at each threshold", () => {
    expect(levelOf(0).level.n).toBe(1);
    expect(levelOf(99_999).level.n).toBe(1);
    expect(levelOf(100_000).level.n).toBe(2);
    expect(levelOf(100_000).progress).toBe(0);
    expect(levelOf(300_000).progress).toBeCloseTo(0.5);
    expect(levelOf(300_000).toNext).toBe(200_000);
  });

  it("tops out at the last level", () => {
    const top = levelOf(10 ** 12);
    expect(top.level.n).toBe(LEVELS.length);
    expect(top.next).toBeNull();
    expect(top.progress).toBe(1);
  });

  it("thresholds rise strictly", () => {
    for (let i = 1; i < LEVELS.length; i++) expect(LEVELS[i].from).toBeGreaterThan(LEVELS[i - 1].from);
  });
});
