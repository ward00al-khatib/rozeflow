import { describe, expect, it } from "vitest";
import {
  REEF_CONFIG,
  REEF_FS,
  REEF_LINE_COUNT,
  REEF_STRIPS,
  afterFreeSpin,
  playReef,
  reefExactRtp,
  reefLineWin,
  reefMaxRoundUnits,
  reefScalePay,
  reefWindow,
  validateReefStake,
} from "./reef";

const SEEDS = { serverSeedHex: "5a".repeat(32), clientSeed: "player-seed", nonce: 0 };

describe("bubble reef: exact RTP", () => {
  const r = reefExactRtp();

  it("the config's table_rtp is the exact RTP (95.84%)", () => {
    expect(`${r.rtp.n}/${r.rtp.d}`).toBe(`${REEF_CONFIG.payout_model.table_rtp.num}/${REEF_CONFIG.payout_model.table_rtp.den}`);
    expect(r.rtpValue).toBeCloseTo(0.95843, 5);
  });

  it("PAR values match the enumeration", () => {
    const par = REEF_CONFIG.payout_model.par;
    expect(`${r.base.n}/${r.base.d}`).toBe(par.base_rtp);
    expect(r.hitFrequency).toBeCloseTo(par.base_hit_frequency, 6);
    expect(r.maxUnits).toBe(par.base_max_line_bet_units);
    expect(r.triggerOneIn).toBe(par.free_spins_one_in);
    expect(reefMaxRoundUnits(r.maxUnits)).toBe(par.max_round_line_bet_units);
  });

  it("each strip shows at most one chest", () => {
    for (const strip of REEF_STRIPS) {
      const at = strip.flatMap((s, i) => (s === "chest" ? [i] : []));
      for (const i of at) for (const j of at) if (i !== j) expect(Math.min((i - j + strip.length) % strip.length, (j - i + strip.length) % strip.length)).toBeGreaterThanOrEqual(3);
    }
  });

  it("the payout cap holds the largest possible round at 99%", () => {
    const lineBet = REEF_CONFIG.stake_limits.max / REEF_LINE_COUNT;
    expect(reefScalePay(lineBet * reefMaxRoundUnits(r.maxUnits), 9900)).toBeLessThanOrEqual(REEF_CONFIG.payout_model.max_gross_payout);
  });
});

describe("bubble reef rounds", () => {
  it("line rule: three of a kind, pearl stands in, chest breaks the line", () => {
    expect(reefLineWin(["octo", "octo", "octo"])).toEqual({ symbol: "octo", units: 25 });
    expect(reefLineWin(["pearl", "crab", "pearl"])).toEqual({ symbol: "crab", units: 18 });
    expect(reefLineWin(["pearl", "pearl", "pearl"])).toEqual({ symbol: "pearl", units: 200 });
    expect(reefLineWin(["star", "shell", "star"])).toBeNull();
    expect(reefLineWin(["chest", "pearl", "pearl"])).toBeNull();
  });

  it("window has three rows and wraps around the strip", () => {
    expect(reefWindow([29, 29, 29])[1]).toEqual(reefWindow([0, 0, 0])[0]);
    expect(reefWindow([0, 0, 0])).toHaveLength(3);
  });

  it("validates the stake", () => {
    expect(() => validateReefStake(1000)).not.toThrow();
    expect(() => validateReefStake(1005)).toThrow();
    expect(() => validateReefStake(990)).toThrow();
  });

  it("chests grow the multiplier up to the maximum; three chests add spins within the limit", () => {
    expect(afterFreeSpin(1, 0, 8)).toEqual({ multiplier: 1, added: 0 });
    expect(afterFreeSpin(1, 2, 8)).toEqual({ multiplier: 3, added: 0 });
    expect(afterFreeSpin(4, 3, 8)).toEqual({ multiplier: 7, added: 5 });
    expect(afterFreeSpin(19, 3, 23)).toEqual({ multiplier: 20, added: 5 });
    expect(afterFreeSpin(20, 3, 28)).toEqual({ multiplier: 20, added: 0 });
  });

  it("is deterministic, and gross = line bet × units × the spin's multiplier", () => {
    const o = playReef(SEEDS, { stake: 1000 });
    expect(playReef(SEEDS, { stake: 1000 })).toEqual(o);
    expect(o.baseGross).toBe(200 * o.base.units);
    expect(o.gross).toBe(o.baseGross + 200 * o.freeSpins.reduce((s, f) => s + f.units * f.multiplier, 0));
  });

  it("free spins follow the rules: 8 to start, multiplier from the chests, retriggers counted", () => {
    let seen = 0;
    let retriggers = 0;
    for (let nonce = 0; nonce < 4000 && seen < 20; nonce++) {
      const o = playReef({ ...SEEDS, nonce }, { stake: 1000 });
      if (o.freeSpins.length === 0) {
        expect(o.base.chests).toBeLessThan(3);
        continue;
      }
      seen++;
      expect(o.base.chests).toBe(3);
      let m = REEF_FS.startMultiplier;
      let awarded = REEF_FS.spins;
      for (const f of o.freeSpins) {
        expect(f.multiplier).toBe(m);
        const next = afterFreeSpin(m, f.chests, awarded);
        expect(f.added).toBe(next.added);
        if (f.added) retriggers++;
        awarded += next.added;
        m = next.multiplier;
      }
      expect(o.freeSpins).toHaveLength(awarded);
    }
    expect(seen).toBe(20);
    expect(retriggers).toBeGreaterThanOrEqual(0);
  });

  it("observed RTP, hit frequency and trigger rate over 200k spins are near the exact values", () => {
    let paid = 0;
    let hits = 0;
    let triggers = 0;
    const n = 200_000;
    for (let i = 0; i < n; i++) {
      const o = playReef({ ...SEEDS, nonce: i }, { stake: 1000 });
      paid += o.gross;
      if (o.base.units > 0) hits++;
      if (o.freeSpins.length > 0) triggers++;
    }
    const r = reefExactRtp();
    // σ of one round ≈ 4 stakes → 4σ/√n ≈ 0.036
    expect(Math.abs(paid / (n * 1000) - r.rtpValue)).toBeLessThan(0.04);
    expect(Math.abs(hits / n - r.hitFrequency)).toBeLessThan(0.005);
    expect(Math.abs(n / triggers - 125)).toBeLessThan(10);
  }, 60_000);
});

describe("bubble reef at an owner-set RTP", () => {
  it("scales wins by target / table and floors", () => {
    expect(reefScalePay(100000)).toBe(100000);
    expect(reefScalePay(0, 9000)).toBe(0);
    // 100000 × 0.90 / 0.958430… = 93903.4…
    expect(reefScalePay(100000, 9000)).toBe(93903);
    const native = playReef(SEEDS, { stake: 2000 });
    const low = playReef(SEEDS, { stake: 2000 }, 9000);
    expect(low.base.stops).toEqual(native.base.stops);
    expect(low.gross).toBeLessThanOrEqual(native.gross);
  });
});
