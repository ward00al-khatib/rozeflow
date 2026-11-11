import { describe, expect, it } from "vitest";
import { SLOTS_CONFIG, linePay, parSheet, playSlots, validateSlotsStake, windowAt } from "./slots";

const SEEDS = { serverSeedHex: "9f".repeat(32), clientSeed: "player-seed", nonce: 0 };

describe("slots PAR sheet (full enumeration, spec 4.3)", () => {
  const par = parSheet();

  it("enumerates every stop combination", () => {
    expect(par.combinations).toBe(24 ** 3);
  });

  it("exact RTP is 91,000 / 96,000 = 94.7917%, inside the 94–96% policy band", () => {
    expect(par.rtpNumerator * 96000).toBe(91000 * par.rtpDenominator);
    expect(par.rtp).toBeGreaterThanOrEqual(0.94);
    expect(par.rtp).toBeLessThanOrEqual(0.96);
  });

  it("contributions add up to the RTP, and the cap is never clipped", () => {
    const sum = Object.values(par.contribution).reduce((a, b) => a + b, 0);
    expect(Math.abs(sum - par.rtp)).toBeLessThan(1e-12);
    expect((SLOTS_CONFIG.stake_limits.max / 5) * par.maxUnits).toBeLessThanOrEqual(SLOTS_CONFIG.payout_model.max_gross_payout);
  });

  it("reports hit frequency and volatility", () => {
    expect(par.hitFrequency).toBeGreaterThan(0.5);
    expect(par.hitFrequency).toBeLessThan(0.6);
    expect(par.volatility).toBeGreaterThan(2);
  });
});

describe("slots rounds", () => {
  it("line pays", () => {
    expect(linePay(["seven", "seven", "seven"])).toBe(400);
    expect(linePay(["cherry", "cherry", "gem"])).toBe(4);
    expect(linePay(["gem", "cherry", "cherry"])).toBe(0);
  });

  it("window wraps around the strip", () => {
    expect(windowAt([23, 23, 23])[1]).toEqual(windowAt([0, 0, 0])[0]);
  });

  it("validates the stake", () => {
    expect(() => validateSlotsStake(1000)).not.toThrow();
    expect(() => validateSlotsStake(1001)).toThrow();
    expect(() => validateSlotsStake(999)).toThrow();
  });

  it("is deterministic and pays line bets × units", () => {
    const o = playSlots(SEEDS, 1000);
    expect(playSlots(SEEDS, 1000)).toEqual(o);
    expect(o.gross).toBe(200 * o.lineWins.reduce((s, w) => s + w.pay, 0));
  });

  it("observed RTP over 200k spins is near the PAR value", () => {
    let paid = 0;
    const n = 200_000;
    for (let i = 0; i < n; i++) paid += playSlots({ ...SEEDS, nonce: i }, 1000).gross;
    // σ ≈ 2.27 per spin → 3σ/√n ≈ 0.0152
    expect(Math.abs(paid / (n * 1000) - parSheet().rtp)).toBeLessThan(0.0152);
  });
});
