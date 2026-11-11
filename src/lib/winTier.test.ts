import { describe, expect, it } from "vitest";
import { winTier } from "./winTier";

describe("win tiers", () => {
  it("labels by multiple of the stake", () => {
    expect(winTier(0, 100)).toBe("none");
    expect(winTier(100, 100)).toBe("none");
    expect(winTier(198, 100)).toBe("small");
    expect(winTier(500, 100)).toBe("medium");
    expect(winTier(2000, 100)).toBe("big");
    expect(winTier(10000, 100)).toBe("epic");
  });
});
