import { describe, expect, it } from "vitest";
import {
  ROULETTE_CONFIG,
  coveredPockets,
  multiplierOf,
  playRoulette,
  settleBets,
  validateBets,
  type RouletteBet,
  type RouletteBetKind,
} from "./roulette";

const SEEDS = { serverSeedHex: "9f".repeat(32), clientSeed: "player-seed", nonce: 0 };

const ALL_BETS: Array<{ kind: RouletteBetKind; value?: number }> = [
  ...Array.from({ length: 37 }, (_, n) => ({ kind: "straight" as const, value: n })),
  { kind: "red" }, { kind: "black" }, { kind: "odd" }, { kind: "even" }, { kind: "low" }, { kind: "high" },
  ...[1, 2, 3].flatMap((v) => [{ kind: "dozen" as const, value: v }, { kind: "column" as const, value: v }]),
];

describe("roulette structure", () => {
  it("has 18 red numbers", () => {
    expect(ROULETTE_CONFIG.rules.red).toHaveLength(18);
  });

  it("every bet type has RTP exactly 36/37 (spec 4.3)", () => {
    for (const b of ALL_BETS) {
      expect(coveredPockets(b.kind, b.value).length * multiplierOf(b.kind)).toBe(36);
    }
  });

  it("outside bets never cover zero", () => {
    for (const b of ALL_BETS.filter((b) => b.kind !== "straight")) {
      expect(coveredPockets(b.kind, b.value)).not.toContain(0);
    }
  });

  it("max total stake on one number stays within the payout cap", () => {
    const { max } = ROULETTE_CONFIG.stake_limits;
    expect(settleBets(7, [{ kind: "straight", value: 7, amount: max }]).gross).toBe(ROULETTE_CONFIG.payout_model.max_gross_payout);
  });
});

describe("validateBets", () => {
  const ok: RouletteBet[] = [{ kind: "red", amount: 1000 }];
  it("accepts a normal round and rejects bad ones", () => {
    expect(() => validateBets(ok)).not.toThrow();
    expect(() => validateBets([])).toThrow();
    expect(() => validateBets([{ kind: "red", amount: 500 }])).toThrow(); // below round minimum
    expect(() => validateBets([{ kind: "straight", value: 37, amount: 1000 }])).toThrow();
    expect(() => validateBets([{ kind: "dozen", value: 4, amount: 1000 }])).toThrow();
    expect(() => validateBets([{ kind: "red", amount: 1000 }, { kind: "red", amount: 1000 }])).toThrow();
    expect(() => validateBets([{ kind: "red", amount: 50 }, { kind: "black", amount: 1000 }])).toThrow();
  });
});

describe("playRoulette", () => {
  it("settles several bets on one spin", () => {
    const bets: RouletteBet[] = [
      { kind: "straight", value: 17, amount: 100 },
      { kind: "red", amount: 500 },
      { kind: "dozen", value: 2, amount: 500 },
    ];
    const o = playRoulette(SEEDS, bets);
    expect(playRoulette(SEEDS, bets)).toEqual(o);
    const expected = bets.reduce(
      (s, b) => s + (coveredPockets(b.kind, b.value).includes(o.pocket) ? b.amount * multiplierOf(b.kind) : 0),
      0,
    );
    expect(o.gross).toBe(expected);
  });

  it("pockets are uniform and RTP is near 36/37 over 200k spins", () => {
    const counts = new Array(37).fill(0);
    let paid = 0;
    const n = 200_000;
    const bets: RouletteBet[] = [{ kind: "red", amount: 1000 }];
    for (let i = 0; i < n; i++) {
      const o = playRoulette({ ...SEEDS, nonce: i }, bets);
      counts[o.pocket]++;
      paid += o.gross;
    }
    const e = n / 37;
    const chi = counts.reduce((a, c) => a + (c - e) ** 2 / e, 0);
    expect(chi).toBeLessThan(68); // df 36, p = 0.001
    // even-money σ ≈ 1 → 3σ/√n ≈ 0.0067
    expect(Math.abs(paid / (n * 1000) - 36 / 37)).toBeLessThan(0.0067);
  });
});
