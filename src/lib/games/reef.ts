/**
 * Bubble Reef («شعاب الفقاعات») — a 3×3 slot. Ruleset 1.0 (spec appendix ص).
 *
 * Three reels, three visible rows, five fixed lines (three rows and two diagonals); the stake is split
 * equally across the lines. Each reel stops at unbiased_integer(len(strip)); that index is the top
 * visible symbol and the next two (wrapping) fill the rows below. A line pays for three of the same
 * symbol; the pearl (WILD) stands in for any symbol except the chest, and three pearls pay the pearl line.
 *
 * Three chests (one on each reel) start 8 free spins on the same strips. A free spin pays at the
 * current multiplier (from ×1); then every chest it shows adds +1 to the multiplier (up to ×20), and
 * three chests inside the free spins add 5 more spins, while the feature stays within 28 spins.
 *
 * Amounts are integers: the stake is a multiple of 10, so a line bet is a whole number of centi-points.
 */
import reefConfig from "../../../config/games/reef.json";
import { RandomStream, gameDomain, unbiasedInteger } from "../fairness/rng";

export type ReefPaySymbol = "puffer" | "octo" | "crab" | "jelly" | "star" | "shell";
export type ReefSymbol = ReefPaySymbol | "pearl" | "chest";

export const REEF_CONFIG = reefConfig;
const R = reefConfig.rules;
const FS = R.free_spins;
export const REEF_STRIPS = R.strips as ReefSymbol[][];
export const REEF_LINES = R.lines;
export const REEF_LINE_COUNT = REEF_LINES.length;
export const REEF_ROWS = R.rows;
export const REEF_REELS = R.reels;
export const REEF_WILD = R.symbols.wild as "pearl";
export const REEF_SCATTER = R.symbols.scatter as "chest";
export const REEF_PAYS = reefConfig.payout_model.pays as Record<ReefPaySymbol | "pearl", number>;
export const REEF_PAY_SYMBOLS = [...R.symbols.high, ...R.symbols.low] as ReefPaySymbol[];
export const REEF_FS = {
  trigger: FS.trigger_scatters,
  spins: FS.spins,
  startMultiplier: FS.start_multiplier,
  step: FS.multiplier_step_per_scatter,
  maxMultiplier: FS.max_multiplier,
  retrigger: FS.retrigger_scatters,
  retriggerSpins: FS.retrigger_spins,
  maxTotalSpins: FS.max_total_spins,
};

export interface ReefLineWin {
  line: number;
  symbol: ReefPaySymbol | "pearl";
  units: number; // line bets, before the free-spin multiplier
}

export interface ReefSpin {
  stops: number[];
  window: ReefSymbol[][]; // [row][reel]
  lineWins: ReefLineWin[];
  units: number;
  chests: number;
  multiplier: number; // multiplier this spin paid at (1 in the base game)
  added: number; // free spins this spin added (retrigger), 0 otherwise
}

export interface ReefBet {
  stake: number; // centi-points per spin (all five lines)
}

export interface ReefOutcome {
  base: ReefSpin;
  freeSpins: ReefSpin[];
  baseGross: number;
  freeGross: number;
  gross: number;
}

export function reefWindow(stops: number[]): ReefSymbol[][] {
  return Array.from({ length: REEF_ROWS }, (_, row) => stops.map((s, reel) => REEF_STRIPS[reel][(s + row) % REEF_STRIPS[reel].length]));
}

/** Pay of one line's three symbols, in line bets, or null. */
export function reefLineWin(symbols: ReefSymbol[]): { symbol: ReefPaySymbol | "pearl"; units: number } | null {
  if (symbols.includes(REEF_SCATTER)) return null;
  const rest = symbols.filter((s) => s !== REEF_WILD) as ReefPaySymbol[];
  if (rest.length === 0) return { symbol: REEF_WILD, units: REEF_PAYS[REEF_WILD] };
  if (rest.some((s) => s !== rest[0])) return null;
  return { symbol: rest[0], units: REEF_PAYS[rest[0]] };
}

export function reefEvaluate(stops: number[]): ReefSpin {
  const window = reefWindow(stops);
  const lineWins: ReefLineWin[] = [];
  REEF_LINES.forEach((rows, line) => {
    const w = reefLineWin(rows.map((row, reel) => window[row][reel]));
    if (w) lineWins.push({ line, ...w });
  });
  const chests = window.flat().filter((s) => s === REEF_SCATTER).length;
  return { stops, window, lineWins, units: lineWins.reduce((s, w) => s + w.units, 0), chests, multiplier: 1, added: 0 };
}

const TABLE_RTP_NUM = BigInt(reefConfig.payout_model.table_rtp.num);
const TABLE_RTP_DEN = BigInt(reefConfig.payout_model.table_rtp.den);

/**
 * A win at the owner-set RTP: the paytable's exact RTP is table_rtp (a fraction); a win is multiplied
 * by target_rtp / table_rtp and floored to a centi-point (same rule as play_reef in SQL).
 * Without `rtpBp` the paytable's own RTP applies and the amount is unchanged.
 */
export function reefScalePay(amount: number, rtpBp?: number): number {
  if (rtpBp === undefined || amount === 0) return amount;
  return Number((BigInt(amount) * BigInt(rtpBp) * TABLE_RTP_DEN) / (10000n * TABLE_RTP_NUM));
}

export function validateReefStake(stake: number): void {
  const { min, max, multiple_of } = reefConfig.stake_limits;
  if (!Number.isSafeInteger(stake) || stake < min || stake > max) {
    throw new Error(`قيمة الرهان يجب أن تكون بين ${min / 100} و${max / 100} نقطة.`);
  }
  if (stake % multiple_of !== 0) throw new Error(`قيمة الرهان يجب أن تكون من مضاعفات ${multiple_of / 100} نقطة.`);
}

function spin(stream: RandomStream): ReefSpin {
  return reefEvaluate(REEF_STRIPS.map((strip) => unbiasedInteger(stream, strip.length)));
}

/** The next multiplier and the spins added after a free spin that showed `chests` chests. */
export function afterFreeSpin(multiplier: number, chests: number, awarded: number): { multiplier: number; added: number } {
  const added = chests >= REEF_FS.retrigger && awarded + REEF_FS.retriggerSpins <= REEF_FS.maxTotalSpins ? REEF_FS.retriggerSpins : 0;
  return { multiplier: Math.min(multiplier + REEF_FS.step * chests, REEF_FS.maxMultiplier), added };
}

export function resolveReef(stream: RandomStream, bet: ReefBet, rtpBp?: number): ReefOutcome {
  validateReefStake(bet.stake);
  const lineBet = bet.stake / REEF_LINE_COUNT;
  const base = spin(stream);
  const freeSpins: ReefSpin[] = [];
  if (base.chests >= REEF_FS.trigger) {
    let left = REEF_FS.spins;
    let awarded = REEF_FS.spins;
    let multiplier = REEF_FS.startMultiplier;
    while (left > 0) {
      const s = spin(stream);
      const next = afterFreeSpin(multiplier, s.chests, awarded);
      freeSpins.push({ ...s, multiplier, added: next.added });
      awarded += next.added;
      left += next.added - 1;
      multiplier = next.multiplier;
    }
  }
  const baseGross = reefScalePay(lineBet * base.units, rtpBp);
  const freeGross = freeSpins.reduce((s, f) => s + reefScalePay(lineBet * f.units * f.multiplier, rtpBp), 0);
  const gross = baseGross + freeGross;
  if (gross > reefConfig.payout_model.max_gross_payout) throw new Error("gross payout above the configured maximum");
  return { base, freeSpins, baseGross, freeGross, gross };
}

export function playReef(seeds: { serverSeedHex: string; clientSeed: string; nonce: number }, bet: ReefBet, rtpBp?: number): ReefOutcome {
  return resolveReef(new RandomStream({ ...seeds, domain: gameDomain("reef") }), bet, rtpBp);
}

/* ---------- exact RTP ---------- */

type Q = { n: bigint; d: bigint };
const gcd = (a: bigint, b: bigint): bigint => (b === 0n ? (a < 0n ? -a : a) : gcd(b, a % b));
const q = (n: bigint, d: bigint = 1n): Q => {
  const g = gcd(n, d) || 1n;
  return { n: n / g, d: d / g };
};
const add = (a: Q, b: Q) => q(a.n * b.d + b.n * a.d, a.d * b.d);
const mul = (a: Q, b: Q) => q(a.n * b.n, a.d * b.d);

/**
 * Exact RTP as fractions, by enumerating every stop combination (30³ = 27,000) of one spin.
 *
 * Free spins: spin i pays units_i × m_i, and m_i depends only on the spins before it, as does whether
 * spin i is played at all; so E[free win] = E[units] × E[Σ m_i over the spins played]. That sum is an
 * exact recursion over (spins left, spins awarded, multiplier), using the chest-count distribution of
 * one spin from the same enumeration.
 */
export function reefExactRtp() {
  const lens = REEF_STRIPS.map((s) => s.length);
  const total = BigInt(lens.reduce((a, b) => a * b, 1));
  let units = 0n;
  let hits = 0n;
  let maxUnits = 0;
  const chestCount = [0n, 0n, 0n, 0n];
  for (let a = 0; a < lens[0]; a++)
    for (let b = 0; b < lens[1]; b++)
      for (let c = 0; c < lens[2]; c++) {
        const s = reefEvaluate([a, b, c]);
        units += BigInt(s.units);
        if (s.units > 0) hits++;
        if (s.units > maxUnits) maxUnits = s.units;
        chestCount[Math.min(s.chests, 3)]++;
      }
  const pChest = chestCount.map((n) => q(n, total));
  // Base RTP: E[units] line bets over a stake of 5 line bets.
  const base = q(units, total * BigInt(REEF_LINE_COUNT));
  const memo = new Map<string, Q>();
  const expectMult = (left: number, awarded: number, m: number): Q => {
    if (left === 0) return q(0n);
    const key = `${left}:${awarded}:${m}`;
    const hit = memo.get(key);
    if (hit) return hit;
    let e = q(BigInt(m));
    pChest.forEach((p, k) => {
      if (p.n === 0n) return;
      const next = afterFreeSpin(m, k, awarded);
      e = add(e, mul(p, expectMult(left - 1 + next.added, awarded + next.added, next.multiplier)));
    });
    memo.set(key, e);
    return e;
  };
  const multSum = expectMult(REEF_FS.spins, REEF_FS.spins, REEF_FS.startMultiplier);
  const trigger = pChest[REEF_FS.trigger] ?? q(0n);
  const free = mul(mul(trigger, base), multSum);
  const rtp = add(base, free);
  // Expected number of free spins per feature: the same recursion with every multiplier = 1 and no growth.
  const spinMemo = new Map<string, Q>();
  const expectSpins = (left: number, awarded: number): Q => {
    if (left === 0) return q(0n);
    const key = `${left}:${awarded}`;
    const hit = spinMemo.get(key);
    if (hit) return hit;
    let e = q(1n);
    pChest.forEach((p, k) => {
      if (p.n === 0n) return;
      const added = afterFreeSpin(1, k, awarded).added;
      e = add(e, mul(p, expectSpins(left - 1 + added, awarded + added)));
    });
    spinMemo.set(key, e);
    return e;
  };
  const f = (x: Q) => Number(x.n) / Number(x.d);
  return {
    rtp,
    base,
    free,
    rtpValue: f(rtp),
    baseValue: f(base),
    freeValue: f(free),
    hitFrequency: Number(hits) / Number(total),
    maxUnits,
    triggerOneIn: 1 / f(trigger),
    avgFreeSpins: f(expectSpins(REEF_FS.spins, REEF_FS.spins)),
    avgMultiplier: f(multSum) / f(expectSpins(REEF_FS.spins, REEF_FS.spins)),
  };
}

/** RTP at an owner-set RTP, as a fraction of 1 (the table's own value without `rtpBp`). */
export function reefScaledRtp(rtpBp?: number): number {
  return rtpBp === undefined ? reefExactRtp().rtpValue : rtpBp / 10000;
}

/**
 * Largest possible gross of one round in line bets: the best spin at every free spin, with the
 * multiplier growing as fast as the rules allow. A loose upper bound used for the payout cap.
 */
export function reefMaxRoundUnits(maxUnits: number): number {
  let sum = maxUnits; // base spin
  let m = REEF_FS.startMultiplier;
  for (let i = 0; i < REEF_FS.maxTotalSpins; i++) {
    sum += maxUnits * m;
    m = Math.min(m + REEF_FS.step * REEF_REELS, REEF_FS.maxMultiplier);
  }
  return sum;
}
