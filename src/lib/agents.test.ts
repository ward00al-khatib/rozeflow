import { describe, expect, it } from "vitest";
import { agentError, newKey, parsePlayerNo, pointsToCenti } from "./agents";

describe("agents helpers", () => {
  it("accepts whole points only, within limits", () => {
    expect(pointsToCenti("100")).toBe(10000);
    expect(pointsToCenti(" 1 ")).toBe(100);
    expect(pointsToCenti("1000000")).toBe(100000000);
    expect(pointsToCenti("0")).toBeNull();
    expect(pointsToCenti("1000001")).toBeNull();
    expect(pointsToCenti("1.5")).toBeNull();
    expect(pointsToCenti("-5")).toBeNull();
    expect(pointsToCenti("")).toBeNull();
  });

  it("reads player numbers with or without #", () => {
    expect(parsePlayerNo("1004")).toBe(1004);
    expect(parsePlayerNo("#1004")).toBe(1004);
    expect(parsePlayerNo("10a4")).toBeNull();
  });

  it("makes keys the server accepts (8 to 80 characters)", () => {
    const k = newKey();
    expect(k.length).toBeGreaterThanOrEqual(8);
    expect(k.length).toBeLessThanOrEqual(80);
    expect(newKey()).not.toBe(k);
  });

  it("explains server errors in Arabic", () => {
    expect(agentError("ALLOWANCE_LOW")).toBe("الحصة المتبقية لا تكفي.");
    expect(agentError("SOMETHING_ELSE")).toBe("لم تتم العملية. حاول مرة أخرى.");
  });
});
