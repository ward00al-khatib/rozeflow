import { describe, expect, it } from "vitest";
import {
  BUY_PRICE_MULTIPLIER,
  LINES,
  SLOTS_CONFIG,
  exactRtp,
  freeSpinsFor,
  lineWin,
  playSlots,
  validateSlotsStake,
  windowAt,
} from "./slots";

const SEEDS = { serverSeedHex: "9f".repeat(32), clientSeed: "player-seed", nonce: 0 };

describe("slots ruleset 2.0: exact RTP (spec 4.3)", () => {
  const r = exactRtp();

  it("RTP is exactly 149,359,240,023 / 156,250,000,000 = 95.5899%, inside the 94–96% policy band", () => {
    expect(r.rtp.n).toBe(149359240023n);
    expect(r.rtp.d).toBe(156250000000n);
    expect(r.rtpValue).toBeGreaterThanOrEqual(0.94);
    expect(r.rtpValue).toBeLessThanOrEqual(0.96);
  });

  it("matches the base RTP from the full 50^5 enumeration (scripts/slots_par.py)", () => {
    expect(r.baseValue).toBeCloseTo(5908899 / 7812500, 12);
  });

  it("buying the feature returns a little under the game itself", () => {
    expect(r.buyValue).toBeCloseTo(0.94542384, 8);
    expect(r.buyValue).toBeLessThan(r.rtpValue);
  });

  it("free spins start about once in 117 spins", () => {
    expect(r.triggerOneIn).toBeCloseTo(116.82, 1);
  });

  it("the payout cap holds the largest possible round", () => {
    const { max } = SLOTS_CONFIG.stake_limits;
    const maxUnits = SLOTS_CONFIG.payout_model.par.base_max_line_bet_units;
    const lineBet = max / LINES.length;
    expect(lineBet * maxUnits * (1 + 20 * 3)).toBeLessThanOrEqual(SLOTS_CONFIG.payout_model.max_gross_payout);
  });
});

describe("slots rounds", () => {
  it("line rule: left to right, wild substitutes, scatter never pays on a line", () => {
    expect(lineWin(["atom", "atom", "atom", "ring", "atom"])).toEqual({ symbol: "atom", count: 3, units: 50 });
    expect(lineWin(["ring", "wild", "ring", "wild", "ring"])).toEqual({ symbol: "ring", count: 5, units: 30 });
    expect(lineWin(["ring", "ring", "tri", "ring", "ring"])).toBeNull();
    expect(lineWin(["scatter", "scatter", "scatter", "ring", "ring"])).toBeNull();
  });

  it("window has five rows and wraps around the strip", () => {
    expect(windowAt([49, 49, 49, 49, 49])[1]).toEqual(windowAt([0, 0, 0, 0, 0])[0]);
    expect(windowAt([0, 0, 0, 0, 0])).toHaveLength(5);
  });

  it("free spins awards", () => {
    expect([0, 1, 2, 3, 4, 5].map(freeSpinsFor)).toEqual([0, 0, 0, 10, 15, 20]);
  });

  it("validates the stake", () => {
    expect(() => validateSlotsStake(1000)).not.toThrow();
    expect(() => validateSlotsStake(1010)).toThrow();
    expect(() => validateSlotsStake(980)).toThrow();
  });

  it("is deterministic, and gross = line bet × units (× 3 in free spins)", () => {
    const o = playSlots(SEEDS, { stake: 1000, buy: false });
    expect(playSlots(SEEDS, { stake: 1000, buy: false })).toEqual(o);
    expect(o.baseGross).toBe(50 * o.base!.units);
    expect(o.gross).toBe(o.baseGross + 150 * o.freeSpins.reduce((s, f) => s + f.units, 0));
  });

  it("a bought round has no base spin, ten free spins and costs 24 × stake", () => {
    const o = playSlots(SEEDS, { stake: 1000, buy: true });
    expect(o.base).toBeNull();
    expect(o.freeSpins).toHaveLength(10);
    expect(o.cost).toBe(1000 * BUY_PRICE_MULTIPLIER);
  });

  it("observed RTP and hit frequency over 200k spins are near the PAR values", () => {
    let paid = 0;
    let hits = 0;
    let triggers = 0;
    const n = 200_000;
    for (let i = 0; i < n; i++) {
      const o = playSlots({ ...SEEDS, nonce: i }, { stake: 1000, buy: false });
      paid += o.gross;
      if (o.base!.units > 0) hits++;
      if (o.freeSpins.length > 0) triggers++;
    }
    // σ ≈ 3.18 per round → 4σ/√n ≈ 0.028
    expect(Math.abs(paid / (n * 1000) - exactRtp().rtpValue)).toBeLessThan(0.028);
    expect(Math.abs(hits / n - SLOTS_CONFIG.payout_model.par.base_hit_frequency)).toBeLessThan(0.005);
    expect(Math.abs(n / triggers - 116.8)).toBeLessThan(8);
  }, 60_000);
});
