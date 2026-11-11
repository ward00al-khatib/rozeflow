import { describe, expect, it } from "vitest";
import { DICE_CONFIG, exactRtp, grossPayout, multiplierFor, playDice, validateBet, winCount } from "./dice";

const SEEDS = { serverSeedHex: "9f".repeat(32), clientSeed: "player-seed", nonce: 0 };

describe("dice config", () => {
  it("max stake × max multiplier never exceeds the payout cap, so no clipping (spec 7.3)", () => {
    const top = multiplierFor(DICE_CONFIG.rules.win_count_bounds.min);
    expect(grossPayout(DICE_CONFIG.stake_limits.max, top)).toBeLessThanOrEqual(
      DICE_CONFIG.payout_model.max_gross_payout,
    );
  });

  it("every allowed choice has an exact RTP in [98.99%, 99%] (spec 7.7)", () => {
    const { min, max } = DICE_CONFIG.rules.win_count_bounds;
    let lo = 1;
    for (let wc = min; wc <= max; wc++) {
      const { num, den } = exactRtp(wc);
      expect(num * 10000).toBeLessThanOrEqual(DICE_CONFIG.payout_model.target_rtp_bp * den);
      lo = Math.min(lo, num / den);
    }
    expect(lo).toBeGreaterThanOrEqual(0.9899);
  });

  it("matches the spec example: 49.50% → 2.0000x", () => {
    expect(multiplierFor(4950)).toBe(20000);
    expect(multiplierFor(100)).toBe(990000);
    expect(multiplierFor(9500)).toBe(10421);
  });
});

describe("validateBet", () => {
  it("accepts limits and rejects outside them", () => {
    expect(() => validateBet({ stake: 1000, target: 5000, direction: "under" })).not.toThrow();
    expect(() => validateBet({ stake: 999, target: 5000, direction: "under" })).toThrow();
    expect(() => validateBet({ stake: 100001, target: 5000, direction: "under" })).toThrow();
    expect(() => validateBet({ stake: 1000, target: 99, direction: "under" })).toThrow();
    expect(() => validateBet({ stake: 1000, target: 9501, direction: "under" })).toThrow();
    expect(() => validateBet({ stake: 1000, target: 499, direction: "over" })).toThrow();
    expect(() => validateBet({ stake: 1000.5, target: 5000, direction: "under" })).toThrow();
  });
  it("over and under with the same win count pay the same", () => {
    expect(winCount(3000, "under")).toBe(winCount(7000, "over"));
  });
});

describe("playDice", () => {
  it("is deterministic and consistent", () => {
    const bet = { stake: 1000, target: 5000, direction: "under" as const };
    const a = playDice(SEEDS, bet);
    expect(playDice(SEEDS, bet)).toEqual(a);
    expect(a.win).toBe(a.roll < 5000);
    expect(a.gross).toBe(a.win ? 1980 : 0);
  });

  it("observed RTP over 200k rounds is close to theory", () => {
    const bet = { stake: 10000, target: 4950, direction: "under" as const };
    let paid = 0;
    const n = 200_000;
    for (let i = 0; i < n; i++) paid += playDice({ ...SEEDS, nonce: i }, bet).gross;
    const rtp = paid / (n * bet.stake);
    // theory 0.99, σ = 0.99 per round → 3σ/√n ≈ 0.0067
    expect(Math.abs(rtp - 0.99)).toBeLessThan(0.0067);
  });
});
