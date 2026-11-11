/**
 * Slots — spec 4.3 (reel strips, paytable, RTP, PAR sheet), 6.7 (derivation). Ruleset 2.0.
 *
 * Five reels, five visible rows, twenty fixed lines; the stake is split equally across the lines.
 * Each reel stops at unbiased_integer(len(strip)); that index is the top visible symbol and the
 * next four (wrapping) fill the rows below. A line pays left to right from reel 1 for three or more
 * of the same symbol; WILD (reels 2–4 only) stands in for any symbol except the scatter.
 * Three or more scatters anywhere start free spins (10/15/20) on the same strips with every win ×3;
 * free spins do not retrigger. The feature can also be bought for a fixed price (24 × stake).
 *
 * Amounts are integers: the stake is a multiple of 20, so a line bet is a whole number of centi-points.
 */
import slotsConfig from "../../../config/games/slots.json";
import { RandomStream, gameDomain, unbiasedInteger } from "../fairness/rng";

export type PaySymbol = "atom" | "crystal" | "flask" | "planet" | "bolt" | "ring" | "tri" | "square" | "diamond";
export type SlotSymbol = PaySymbol | "wild" | "scatter";

export const SLOTS_CONFIG = slotsConfig;
const R = slotsConfig.rules;
const STRIPS = R.strips as SlotSymbol[][];
export const LINES = R.lines;
export const LINE_COUNT = LINES.length;
export const ROWS = R.rows;
export const REELS = R.reels;
export const PAYS = slotsConfig.payout_model.pays as Record<PaySymbol, [number, number, number]>;
export const PAY_SYMBOLS = [...R.symbols.high, ...R.symbols.low] as PaySymbol[];
export const FS_AWARDS = R.free_spins.scatters_to_spins as Record<string, number>;
export const FS_MULTIPLIER = R.free_spins.win_multiplier;
export const BUY_PRICE_MULTIPLIER = R.buy_feature.price_multiplier;
export const BUY_SPINS = R.buy_feature.spins;

export interface LineWin {
  line: number;
  symbol: PaySymbol;
  count: number; // 3..5 reels from the left
  units: number; // line bets, before the free-spin multiplier
}

export interface SpinResult {
  stops: number[];
  window: SlotSymbol[][]; // [row][reel]
  lineWins: LineWin[];
  units: number;
  scatters: number;
}

export interface SlotsBet {
  stake: number; // centi-points per spin (all 20 lines)
  buy: boolean; // buy the free spins for BUY_PRICE_MULTIPLIER × stake
}

export interface SlotsOutcome {
  base: SpinResult | null; // null when the feature was bought
  freeSpins: SpinResult[];
  multiplier: number; // free-spin win multiplier
  baseGross: number;
  freeGross: number;
  gross: number;
  cost: number;
}

export function windowAt(stops: number[]): SlotSymbol[][] {
  return Array.from({ length: ROWS }, (_, row) => stops.map((s, reel) => STRIPS[reel][(s + row) % STRIPS[reel].length]));
}

/** Pay of one line's five symbols, in line bets, or null. */
export function lineWin(symbols: SlotSymbol[]): { symbol: PaySymbol; count: number; units: number } | null {
  const first = symbols[0];
  if (first === "wild" || first === "scatter") return null; // reel 1 never holds a wild
  let count = 1;
  while (count < symbols.length && (symbols[count] === first || symbols[count] === "wild")) count++;
  if (count < 3) return null;
  return { symbol: first, count, units: PAYS[first][count - 3] };
}

export function evaluate(stops: number[]): SpinResult {
  const window = windowAt(stops);
  const lineWins: LineWin[] = [];
  LINES.forEach((rows, line) => {
    const w = lineWin(rows.map((row, reel) => window[row][reel]));
    if (w) lineWins.push({ line, ...w });
  });
  const scatters = window.flat().filter((s) => s === "scatter").length;
  return { stops, window, lineWins, units: lineWins.reduce((s, w) => s + w.units, 0), scatters };
}

export function freeSpinsFor(scatters: number): number {
  return FS_AWARDS[String(Math.min(scatters, 5))] ?? 0;
}

export function costOf(bet: SlotsBet): number {
  return bet.buy ? bet.stake * BUY_PRICE_MULTIPLIER : bet.stake;
}

export function validateSlotsStake(stake: number): void {
  const { min, max, multiple_of } = slotsConfig.stake_limits;
  if (!Number.isSafeInteger(stake) || stake < min || stake > max) {
    throw new Error(`قيمة الرهان يجب أن تكون بين ${min / 100} و${max / 100} نقطة.`);
  }
  if (stake % multiple_of !== 0) throw new Error(`قيمة الرهان يجب أن تكون من مضاعفات ${multiple_of / 100} نقطة.`);
}

function spin(stream: RandomStream): SpinResult {
  return evaluate(STRIPS.map((strip) => unbiasedInteger(stream, strip.length)));
}

export function resolveSlots(stream: RandomStream, bet: SlotsBet): SlotsOutcome {
  validateSlotsStake(bet.stake);
  const lineBet = bet.stake / LINE_COUNT;
  const base = bet.buy ? null : spin(stream);
  const count = bet.buy ? BUY_SPINS : freeSpinsFor(base!.scatters);
  const freeSpins: SpinResult[] = [];
  for (let i = 0; i < count; i++) freeSpins.push(spin(stream));
  const baseGross = base ? lineBet * base.units : 0;
  const freeGross = lineBet * FS_MULTIPLIER * freeSpins.reduce((s, f) => s + f.units, 0);
  const gross = baseGross + freeGross;
  if (gross > slotsConfig.payout_model.max_gross_payout) throw new Error("gross payout above the configured maximum");
  return { base, freeSpins, multiplier: FS_MULTIPLIER, baseGross, freeGross, gross, cost: costOf(bet) };
}

export function playSlots(seeds: { serverSeedHex: string; clientSeed: string; nonce: number }, bet: SlotsBet): SlotsOutcome {
  return resolveSlots(new RandomStream({ ...seeds, domain: gameDomain("slots") }), bet);
}

/* ---------- exact RTP (spec 4.3) ---------- */

/** A fraction with BigInt parts. */
type Q = { n: bigint; d: bigint };
const gcd = (a: bigint, b: bigint): bigint => (b === 0n ? (a < 0n ? -a : a) : gcd(b, a % b));
const q = (n: bigint, d: bigint = 1n): Q => {
  const g = gcd(n, d) || 1n;
  return { n: n / g, d: d / g };
};
const add = (a: Q, b: Q) => q(a.n * b.d + b.n * a.d, a.d * b.d);
const mul = (a: Q, b: Q) => q(a.n * b.n, a.d * b.d);
const sub = (a: Q, b: Q) => q(a.n * b.d - b.n * a.d, a.d * b.d);

/**
 * Exact RTP as fractions. A line's five symbols are five independent uniform draws (one per strip),
 * so its expected pay depends only on each strip's symbol counts; all 20 lines have the same
 * expectation. Each strip has one scatter, so at most one scatter shows per reel, with chance 5/len.
 */
export function exactRtp() {
  const P = STRIPS.map((strip) => {
    const c: Record<string, number> = {};
    for (const s of strip) c[s] = (c[s] ?? 0) + 1;
    return (s: string) => q(BigInt(c[s] ?? 0), BigInt(strip.length));
  });
  let line = q(0n);
  const contribution: Record<string, Q> = {};
  for (const s of PAY_SYMBOLS) {
    const p = P[0](s);
    const m = [1, 2, 3, 4].map((r) => add(P[r](s), P[r]("wild")));
    const one = q(1n);
    const p3 = mul(mul(mul(p, m[0]), m[1]), sub(one, m[2]));
    const p4 = mul(mul(mul(mul(p, m[0]), m[1]), m[2]), sub(one, m[3]));
    const p5 = mul(mul(mul(mul(p, m[0]), m[1]), m[2]), m[3]);
    const [a, b, c] = PAYS[s].map((x) => q(BigInt(x)));
    contribution[s] = add(add(mul(p3, a), mul(p4, b)), mul(p5, c));
    line = add(line, contribution[s]);
  }
  // Base RTP: 20 lines × E[line] line bets, over a stake of 20 line bets.
  const base = line;
  // Scatter count distribution.
  let dist: Q[] = [q(1n)];
  for (let r = 0; r < REELS; r++) {
    const strip = STRIPS[r];
    if (strip.filter((s) => s === "scatter").length !== 1) throw new Error("each strip must hold exactly one scatter");
    const p = q(BigInt(ROWS), BigInt(strip.length));
    const next: Q[] = Array.from({ length: dist.length + 1 }, () => q(0n));
    dist.forEach((x, k) => {
      next[k] = add(next[k], mul(x, sub(q(1n), p)));
      next[k + 1] = add(next[k + 1], mul(x, p));
    });
    dist = next;
  }
  let trigger = q(0n);
  let expectedSpins = q(0n);
  dist.forEach((x, k) => {
    const n = freeSpinsFor(k);
    if (n > 0) {
      trigger = add(trigger, x);
      expectedSpins = add(expectedSpins, mul(x, q(BigInt(n))));
    }
  });
  const free = mul(mul(expectedSpins, q(BigInt(FS_MULTIPLIER))), base);
  const rtp = add(base, free);
  const buy = q(base.n * BigInt(BUY_SPINS * FS_MULTIPLIER), base.d * BigInt(BUY_PRICE_MULTIPLIER));
  const f = (x: Q) => Number(x.n) / Number(x.d);
  return {
    rtp,
    rtpValue: f(rtp),
    baseValue: f(base),
    freeValue: f(free),
    buyValue: f(buy),
    triggerOneIn: 1 / f(trigger),
    contribution: Object.fromEntries(Object.entries(contribution).map(([k, v]) => [k, f(v)])) as Record<PaySymbol, number>,
  };
}
