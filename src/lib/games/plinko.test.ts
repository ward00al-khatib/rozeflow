import { describe, expect, it } from "vitest";
import { PLINKO_CONFIG, PLINKO_SCALE, playPlinko, plinkoTable, validatePlinkoBet, type PlinkoRisk, type PlinkoRows } from "./plinko";

const SEEDS = { serverSeedHex: "9f".repeat(32), clientSeed: "player-seed", nonce: 0 };
const RISKS = PLINKO_CONFIG.rules.risks as PlinkoRisk[];
const ROWS = PLINKO_CONFIG.rules.rows as PlinkoRows[];

function binom(n: number, k: number): bigint {
  let r = 1n;
  for (let i = 0; i < k; i++) r = (r * BigInt(n - i)) / BigInt(i + 1);
  return r;
}

describe("plinko tables", () => {
  for (const risk of RISKS) {
    for (const rows of ROWS) {
      it(`${risk}/${rows}: symmetric, exact RTP in [98.99%, 99%]`, () => {
        const t = plinkoTable(risk, rows);
        expect(t).toEqual([...t].reverse());
        // exact: Σ C(n,k)·m_k / (2^n · scale)
        const num = t.reduce((s, m, k) => s + binom(rows, k) * BigInt(m), 0n);
        const den = (1n << BigInt(rows)) * BigInt(PLINKO_SCALE);
        expect(num * 10000n <= 9900n * den).toBe(true);
        expect(num * 10000n >= 9899n * den).toBe(true);
      });
    }
  }

  it("the largest payout fits the cap (no clipping, spec 7.3)", () => {
    const top = Math.max(...RISKS.flatMap((r) => ROWS.map((n) => Math.max(...plinkoTable(r, n)))));
    expect(Math.floor((PLINKO_CONFIG.stake_limits.max * top) / PLINKO_SCALE)).toBeLessThanOrEqual(
      PLINKO_CONFIG.payout_model.max_gross_payout,
    );
  });
});

describe("playPlinko", () => {
  it("validates choices", () => {
    expect(() => validatePlinkoBet({ stake: 1000, rows: 10 as PlinkoRows, risk: "low" })).toThrow();
    expect(() => validatePlinkoBet({ stake: 1000, rows: 8, risk: "wild" as PlinkoRisk })).toThrow();
    expect(() => validatePlinkoBet({ stake: 500, rows: 8, risk: "low" })).toThrow();
  });

  it("slot equals right bounces and is deterministic", () => {
    const bet = { stake: 1000, rows: 16 as const, risk: "high" as const };
    const o = playPlinko(SEEDS, bet);
    expect(o.path).toHaveLength(16);
    expect(o.slot).toBe(o.path.filter((x) => x === 1).length);
    expect(playPlinko(SEEDS, bet)).toEqual(o);
  });

  it("observed RTP over 200k drops is near 99% (low risk, 8 rows)", () => {
    const bet = { stake: 10000, rows: 8 as const, risk: "low" as const };
    let paid = 0;
    const n = 200_000;
    for (let i = 0; i < n; i++) paid += playPlinko({ ...SEEDS, nonce: i }, bet).gross;
    expect(Math.abs(paid / (n * bet.stake) - 0.99)).toBeLessThan(0.006);
  });
});
