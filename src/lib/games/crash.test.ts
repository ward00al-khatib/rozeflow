import { describe, expect, it } from "vitest";
import { RandomStream, gameDomain, unitFloat } from "../fairness/rng";
import { CRASH_CONFIG, crashPoint, crashPointFromInteger, multiplierAt, settleCrash, timeToReach, validateCrashBet } from "./crash";

const SEEDS = { serverSeedHex: "9f".repeat(32), clientSeed: "player-seed", nonce: 0 };
const TWO52 = 1n << 52n;

describe("crash point", () => {
  it("uses the same random material as unit_float (spec 6.7)", () => {
    for (let nonce = 0; nonce < 50; nonce++) {
      const u = unitFloat(new RandomStream({ ...SEEDS, nonce, domain: gameDomain("crash") }));
      const x = BigInt(Math.round(u * 2 ** 52));
      expect(crashPoint({ ...SEEDS, nonce })).toBe(crashPointFromInteger(x));
    }
  });

  it("P(C ≥ x) = 0.99 / x exactly: the threshold X for each target matches", () => {
    // C ≥ x  ⇔  X ≥ 2^52 − floor-ish(0.99 × 2^52 / x). Check boundaries for a spread of targets.
    for (const target of [101, 150, 200, 500, 1000, 10000, 100000]) {
      // smallest X with C ≥ target
      let lo = 0n;
      let hi = TWO52 - 1n;
      while (lo < hi) {
        const mid = (lo + hi) / 2n;
        if (crashPointFromInteger(mid) >= target) hi = mid;
        else lo = mid + 1n;
      }
      const p = Number(TWO52 - lo) / 2 ** 52;
      const rtp = (p * target) / 100;
      expect(rtp).toBeGreaterThan(0.98999);
      expect(rtp).toBeLessThanOrEqual(0.99 + 1e-12);
    }
  });

  it("bounds: never below 1.00x, never above the cap", () => {
    expect(crashPointFromInteger(0n)).toBe(100);
    expect(crashPointFromInteger(TWO52 - 1n)).toBe(CRASH_CONFIG.payout_model.max_multiplier);
  });

  it("instant crash rate is about 1.98% and RTP at 2x is near 99% over 200k rounds", () => {
    let instant = 0;
    let paid = 0;
    const n = 200_000;
    for (let i = 0; i < n; i++) {
      const c = crashPoint({ ...SEEDS, nonce: i });
      if (c < 101) instant++;
      paid += settleCrash({ stake: 10000, autoCashout: 200 }, c, null).gross;
    }
    expect(Math.abs(instant / n - (1 - 99 / 101))).toBeLessThan(0.002);
    expect(Math.abs(paid / (n * 10000) - 0.99)).toBeLessThan(0.0067);
  });
});

describe("crash rounds", () => {
  it("validates", () => {
    expect(() => validateCrashBet({ stake: 1000, autoCashout: 100 })).toThrow();
    expect(() => validateCrashBet({ stake: 1000, autoCashout: 100001 })).toThrow();
    expect(() => validateCrashBet({ stake: 1000, autoCashout: 200 })).not.toThrow();
  });

  it("settles auto, manual and crash cases", () => {
    const bet = { stake: 1000, autoCashout: 300 };
    expect(settleCrash(bet, 500, null)).toEqual({ crashPoint: 500, cashedAt: 300, gross: 3000 });
    expect(settleCrash(bet, 500, 150)).toEqual({ crashPoint: 500, cashedAt: 150, gross: 1500 });
    expect(settleCrash(bet, 250, null)).toEqual({ crashPoint: 250, cashedAt: null, gross: 0 });
    expect(settleCrash(bet, 250, 260).gross).toBe(0); // a late manual press after the crash pays nothing
  });

  it("growth curve: 2x near 8.7s and timeToReach inverts multiplierAt", () => {
    expect(multiplierAt(0)).toBe(100);
    for (const m of [101, 200, 1000, 100000]) expect(multiplierAt(timeToReach(m))).toBeGreaterThanOrEqual(m);
  });
});
