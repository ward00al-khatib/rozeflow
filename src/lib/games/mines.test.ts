import { describe, expect, it } from "vitest";
import {
  MINES_CONFIG,
  MINES_SCALE,
  applyPick,
  maxPicks,
  minePositions,
  minesMultiplier,
  replayMines,
  settleMines,
  validateMinesBet,
} from "./mines";

const SEEDS = { serverSeedHex: "9f".repeat(32), clientSeed: "player-seed", nonce: 0 };

function binom(n: number, k: number): bigint {
  let r = 1n;
  for (let i = 0; i < k; i++) r = (r * BigInt(n - i)) / BigInt(i + 1);
  return r;
}

describe("mines multipliers", () => {
  it("every reachable stop has RTP in [98.99%, 99%] (RTP applied once, spec 4.3)", () => {
    for (let m = 1; m <= 24; m++) {
      for (let k = 1; k <= maxPicks(m); k++) {
        // RTP of "cash out after k" = P(survive k) × m(k) = C(25−m,k)/C(25,k) × m(k)
        const num = binom(25 - m, k) * BigInt(minesMultiplier(m, k));
        const den = binom(25, k) * BigInt(MINES_SCALE);
        expect(num * 10000n <= 9900n * den).toBe(true);
        expect(num * 10000n >= 9899n * den).toBe(true);
      }
    }
  });

  it("known values: 1 mine first pick 1.0312x, 24 mines first pick 24.75x", () => {
    expect(minesMultiplier(1, 1)).toBe(10312);
    expect(minesMultiplier(24, 1)).toBe(247500);
  });

  it("caps: no reachable multiplier passes 1,000x and max stake never clips", () => {
    for (let m = 1; m <= 24; m++) {
      const k = maxPicks(m);
      expect(k).toBeGreaterThanOrEqual(1);
      expect(minesMultiplier(m, k)).toBeLessThanOrEqual(MINES_CONFIG.payout_model.max_multiplier);
      expect((MINES_CONFIG.stake_limits.max * minesMultiplier(m, k)) / MINES_SCALE).toBeLessThanOrEqual(
        MINES_CONFIG.payout_model.max_gross_payout,
      );
    }
    expect(maxPicks(1)).toBe(24); // all safe tiles reachable with few mines
  });
});

describe("mines rounds", () => {
  const bet = { stake: 1000, mines: 3 };

  it("mine positions are fixed by the seeds", () => {
    const a = minePositions(SEEDS, 3);
    expect(a).toHaveLength(3);
    expect(minePositions(SEEDS, 3)).toEqual(a);
    expect(new Set(a).size).toBe(3);
  });

  it("validates", () => {
    expect(() => validateMinesBet({ stake: 1000, mines: 0 })).toThrow();
    expect(() => validateMinesBet({ stake: 1000, mines: 25 })).toThrow();
    expect(() => validateMinesBet({ stake: 900, mines: 3 })).toThrow();
  });

  it("busts on a mine, cashes on safe picks, refuses repeats and early cash-out", () => {
    const mines = minePositions(SEEDS, 3);
    const safe = [...Array(25).keys()].filter((t) => !mines.includes(t));
    expect(() => settleMines({ picks: [], status: "playing" }, mines, bet)).toThrow();
    let s = applyPick({ picks: [], status: "playing" }, safe[0], mines, bet);
    expect(s.status).toBe("playing");
    expect(() => applyPick(s, safe[0], mines, bet)).toThrow();
    s = applyPick(s, safe[1], mines, bet);
    const cashed = settleMines(s, mines, bet);
    expect(cashed.gross).toBe(Math.floor((1000 * minesMultiplier(3, 2)) / MINES_SCALE));
    const bust = applyPick(s, mines[0], mines, bet);
    expect(bust.status).toBe("busted");
    expect(settleMines(bust, mines, bet).gross).toBe(0);
    expect(replayMines(SEEDS, bet, [safe[0], safe[1]])).toEqual(cashed);
  });

  it("observed RTP for 'cash out after 3 picks, 5 mines' is near 99% over 60k rounds", () => {
    const b = { stake: 10000, mines: 5 };
    let paid = 0;
    const n = 60_000;
    for (let i = 0; i < n; i++) {
      // the player always picks tiles 0, 1, 2: fine, since mine positions are uniform
      paid += replayMines({ ...SEEDS, nonce: i }, b, [0, 1, 2]).gross;
    }
    // m(3) ≈ 2.0, P ≈ 0.496 → σ ≈ 1 → 3σ/√n ≈ 0.0123
    expect(Math.abs(paid / (n * b.stake) - 0.99)).toBeLessThan(0.0123);
  });
});
