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

  it("RTP is exactly 93,584,773,924,094,013 / 97,656,250,000,000,000 = 95.8308%, inside the 94–96% policy band", () => {
    expect(r.rtp.n).toBe(93584773924094013n);
    expect(r.rtp.d).toBe(97656250000000000n);
    expect(r.rtpValue).toBeGreaterThanOrEqual(0.94);
    expect(r.rtpValue).toBeLessThanOrEqual(0.96);
  });

  it("matches the base RTP from the full 50^5 enumeration (scripts/slots_par.py)", () => {
    expect(r.baseValue).toBeCloseTo(28393167 / 39062500, 12);
  });

  it("buying the feature returns a little under the game itself, also inside the band", () => {
    expect(r.buy.n * 8789062500000n).toBe(8298253238143n * r.buy.d);
    expect(r.buyValue).toBeGreaterThanOrEqual(0.94);
    expect(r.buyValue).toBeLessThan(r.rtpValue);
  });

  it("free spins start about once in 117 spins", () => {
    expect(r.triggerOneIn).toBeCloseTo(116.82, 1);
  });

  it("the payout cap holds the largest possible round", () => {
    const { max } = SLOTS_CONFIG.stake_limits;
    const maxUnits = SLOTS_CONFIG.payout_model.par.base_max_line_bet_units;
    const lineBet = max / LINES.length;
    // base spin + 20 free spins with multipliers 1..20
    expect(lineBet * maxUnits * (1 + 210)).toBeLessThanOrEqual(SLOTS_CONFIG.payout_model.max_gross_payout);
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

  it("is deterministic, and gross = line bet × units (× the spin's multiplier in free spins)", () => {
    const o = playSlots(SEEDS, { stake: 1000, buy: false });
    expect(playSlots(SEEDS, { stake: 1000, buy: false })).toEqual(o);
    expect(o.baseGross).toBe(50 * o.base!.units);
    expect(o.gross).toBe(o.baseGross + 50 * o.freeSpins.reduce((s, f) => s + f.units * f.multiplier, 0));
  });

  it("the free-spin multiplier starts at 1 and grows by 1 after each winning free spin", () => {
    const o = playSlots(SEEDS, { stake: 1000, buy: true });
    let m = 1;
    for (const f of o.freeSpins) {
      expect(f.multiplier).toBe(m);
      if (f.units > 0) m++;
    }
  });

  it("a bought round has no base spin, ten free spins and costs 24 × stake", () => {
    const o = playSlots(SEEDS, { stake: 1000, buy: true });
    expect(o.base).toBeNull();
    expect(o.freeSpins).toHaveLength(10);
    expect(o.cost).toBe(1000 * BUY_PRICE_MULTIPLIER);
    expect(BUY_PRICE_MULTIPLIER).toBe(27);
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
    // σ ≈ 4.5 per round with growing free-spin multipliers → 4σ/√n ≈ 0.04
    expect(Math.abs(paid / (n * 1000) - exactRtp().rtpValue)).toBeLessThan(0.04);
    expect(Math.abs(hits / n - SLOTS_CONFIG.payout_model.par.base_hit_frequency)).toBeLessThan(0.005);
    expect(Math.abs(n / triggers - 116.8)).toBeLessThan(8);
  }, 60_000);

  it("observed return of 20k bought rounds is near the exact buy RTP", () => {
    let paid = 0;
    const n = 20_000;
    for (let i = 0; i < n; i++) paid += playSlots({ ...SEEDS, nonce: i }, { stake: 1000, buy: true }).gross;
    // σ of one buy ≈ 1 price → 4σ/√n ≈ 0.03
    expect(Math.abs(paid / (n * 27_000) - exactRtp().buyValue)).toBeLessThan(0.03);
  }, 60_000);
});
