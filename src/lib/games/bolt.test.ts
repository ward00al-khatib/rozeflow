import { describe, expect, it } from "vitest";
import {
  BOLT_CONFIG,
  BOLT_FS,
  BOLT_LINE_COUNT,
  BOLT_STRIPS,
  boltAfterFreeSpin,
  boltEnumerateSpins,
  boltExactRtp,
  boltLineWin,
  boltMaxRoundUnits,
  boltScalePay,
  boltSpinsFor,
  boltWindow,
  playBolt,
  validateBoltStake,
} from "./bolt";

const SEEDS = { serverSeedHex: "5a".repeat(32), clientSeed: "player-seed", nonce: 0 };

describe("little bolt: exact RTP", () => {
  const r = boltExactRtp();
  const par = BOLT_CONFIG.payout_model.par;

  it("the config's table_rtp is the exact RTP (96.27%)", () => {
    expect(`${r.rtp.n}/${r.rtp.d}`).toBe(`${BOLT_CONFIG.payout_model.table_rtp.num}/${BOLT_CONFIG.payout_model.table_rtp.den}`);
    expect(r.rtpValue).toBeCloseTo(0.962684, 6);
  });

  it("PAR values match the exact computation", () => {
    expect(`${r.base.n}/${r.base.d}`).toBe(par.base_rtp);
    expect(r.triggerOneIn).toBeCloseTo(par.free_spins_one_in, 2);
    expect(r.avgFreeSpins).toBeCloseTo(par.avg_free_spins, 2);
    expect(r.avgMultiplier).toBeCloseTo(par.avg_free_multiplier, 2);
  });

  it("a full enumeration of every stop agrees: same mean, hit frequency and best spin as the PAR sheet", () => {
    const e = boltEnumerateSpins();
    expect(e.meanUnits / BOLT_LINE_COUNT).toBeCloseTo(r.baseValue, 12);
    expect(e.hitFrequency).toBeCloseTo(par.base_hit_frequency, 6);
    expect(e.maxUnits).toBe(par.base_max_line_bet_units);
    expect(boltMaxRoundUnits(e.maxUnits)).toBe(par.max_round_line_bet_units);
  }, 60_000);

  it("each strip shows at most one core and never two robots side by side", () => {
    for (const strip of BOLT_STRIPS) {
      expect(strip.filter((s) => s === "core")).toHaveLength(1);
      strip.forEach((s, i) => {
        if (s === "bot") expect(strip[(i + 1) % strip.length]).not.toBe("bot");
      });
    }
  });

  it("the payout cap holds the largest possible round at 99%", () => {
    const lineBet = BOLT_CONFIG.stake_limits.max / BOLT_LINE_COUNT;
    expect(boltScalePay(lineBet * par.max_round_line_bet_units, 9900)).toBeLessThanOrEqual(BOLT_CONFIG.payout_model.max_gross_payout);
  });
});

describe("little bolt rounds", () => {
  it("line rule: runs from the left, robot stands in, core ends the line, the larger pay wins", () => {
    expect(boltLineWin(["rocket", "rocket", "rocket", "gear", "nut"])).toEqual({ symbol: "rocket", count: 3, units: 20 });
    expect(boltLineWin(["bot", "magnet", "bot", "magnet", "spring"])).toEqual({ symbol: "magnet", count: 4, units: 50 });
    expect(boltLineWin(["gear", "gear", "rocket", "gear", "gear"])).toBeNull();
    expect(boltLineWin(["gear", "gear", "core", "gear", "gear"])).toBeNull();
    expect(boltLineWin(["core", "bot", "bot", "bot", "bot"])).toBeNull();
    // three robots then a spring: robot line (40) beats spring ×5 (25)
    expect(boltLineWin(["bot", "bot", "bot", "spring", "spring"])).toEqual({ symbol: "bot", count: 3, units: 40 });
    // three robots then rockets: rocket ×5 (400) beats the robot line
    expect(boltLineWin(["bot", "bot", "bot", "rocket", "rocket"])).toEqual({ symbol: "rocket", count: 5, units: 400 });
    expect(boltLineWin(["bot", "bot", "bot", "core", "rocket"])).toEqual({ symbol: "bot", count: 3, units: 40 });
    expect(boltLineWin(["bot", "bot", "bot", "bot", "bot"])).toEqual({ symbol: "bot", count: 5, units: 1000 });
  });

  it("window has three rows and wraps around the strip", () => {
    expect(boltWindow([31, 31, 31, 31, 31])[1]).toEqual(boltWindow([0, 0, 0, 0, 0])[0]);
    expect(boltWindow([0, 0, 0, 0, 0])).toHaveLength(3);
  });

  it("validates the stake", () => {
    expect(() => validateBoltStake(1000)).not.toThrow();
    expect(() => validateBoltStake(1005)).toThrow();
    expect(() => validateBoltStake(990)).toThrow();
    expect(() => validateBoltStake(100010)).toThrow();
  });

  it("cores start 10 / 12 / 15 spins; robots charge the multiplier; cores retrigger within the limit", () => {
    expect([0, 1, 2, 3, 4, 5].map(boltSpinsFor)).toEqual([0, 0, 0, 10, 12, 15]);
    expect(boltAfterFreeSpin(1, 0, 0, 10)).toEqual({ multiplier: 1, added: 0 });
    expect(boltAfterFreeSpin(1, 2, 1, 10)).toEqual({ multiplier: 3, added: 0 });
    expect(boltAfterFreeSpin(4, 1, 3, 10)).toEqual({ multiplier: 5, added: 5 });
    expect(boltAfterFreeSpin(14, 3, 4, 25)).toEqual({ multiplier: 15, added: 5 });
    expect(boltAfterFreeSpin(15, 1, 3, 30)).toEqual({ multiplier: 15, added: 0 });
  });

  it("is deterministic, and gross = line bet × units × the spin's multiplier", () => {
    const o = playBolt(SEEDS, { stake: 1000 });
    expect(playBolt(SEEDS, { stake: 1000 })).toEqual(o);
    expect(o.baseGross).toBe(100 * o.base.units);
    expect(o.gross).toBe(o.baseGross + 100 * o.freeSpins.reduce((s, f) => s + f.units * f.multiplier, 0));
  });

  it("free spins follow the rules", () => {
    let seen = 0;
    for (let nonce = 0; nonce < 6000 && seen < 20; nonce++) {
      const o = playBolt({ ...SEEDS, nonce }, { stake: 1000 });
      if (o.freeSpins.length === 0) {
        expect(o.base.cores).toBeLessThan(3);
        continue;
      }
      seen++;
      let m = BOLT_FS.startMultiplier;
      let awarded = boltSpinsFor(o.base.cores);
      for (const f of o.freeSpins) {
        expect(f.multiplier).toBe(m);
        const next = boltAfterFreeSpin(m, f.wilds, f.cores, awarded);
        expect(f.added).toBe(next.added);
        awarded += next.added;
        m = next.multiplier;
      }
      expect(o.freeSpins).toHaveLength(awarded);
    }
    expect(seen).toBe(20);
  });

  it("observed RTP and trigger rate over 200k spins are near the exact values", () => {
    let paid = 0;
    let triggers = 0;
    const n = 200_000;
    for (let i = 0; i < n; i++) {
      const o = playBolt({ ...SEEDS, nonce: i }, { stake: 1000 });
      paid += o.gross;
      if (o.freeSpins.length > 0) triggers++;
    }
    const r = boltExactRtp();
    expect(Math.abs(paid / (n * 1000) - r.rtpValue)).toBeLessThan(0.05);
    expect(Math.abs(n / triggers - r.triggerOneIn)).toBeLessThan(12);
  }, 60_000);
});

describe("little bolt at an owner-set RTP", () => {
  it("scales wins by target / table and floors", () => {
    expect(boltScalePay(100000)).toBe(100000);
    expect(boltScalePay(0, 9000)).toBe(0);
    // 100000 × 0.90 / 0.962684… = 93488.6…
    expect(boltScalePay(100000, 9000)).toBe(Math.floor((100000 * 0.9) / boltExactRtp().rtpValue));
    const native = playBolt(SEEDS, { stake: 2000 });
    const low = playBolt(SEEDS, { stake: 2000 }, 9000);
    expect(low.base.stops).toEqual(native.base.stops);
    expect(low.gross).toBeLessThanOrEqual(native.gross);
  });
});
