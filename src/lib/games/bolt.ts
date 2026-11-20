/**
 * Little Bolt («بُرغي الصغير») — a 5×3 slot with ten lines. Ruleset 1.0 (spec appendix ق).
 *
 * Five reels, three visible rows, ten fixed lines; the stake is split equally across the lines. Each
 * reel stops at unbiased_integer(len(strip)); that index is the top visible symbol and the next two
 * (wrapping) fill the rows below. A line pays 3, 4 or 5 of the same symbol in a row from the leftmost
 * reel. Bolt the robot (WILD) stands in for any symbol except the power core; a run of robots from the
 * left also pays the robot line, and a line pays the larger of the two. A core on a line ends it.
 *
 * Three or more cores anywhere start 10 / 12 / 15 free spins (3 / 4 / 5 cores) on the same strips.
 * A free spin pays at the current multiplier (from ×1); then every robot it shows charges the
 * multiplier by +1 (up to ×15), and three or more cores add 5 spins while the feature stays within 30.
 *
 * Amounts are integers: the stake is a multiple of 10, so a line bet is a whole number of centi-points.
 */
import boltConfig from "../../../config/games/bolt.json";
import { RandomStream, gameDomain, unbiasedInteger } from "../fairness/rng";

export type BoltPaySymbol = "rocket" | "magnet" | "bulb" | "gear" | "nut" | "spring";
export type BoltSymbol = BoltPaySymbol | "bot" | "core";

export const BOLT_CONFIG = boltConfig;
const R = boltConfig.rules;
const FS = R.free_spins;
export const BOLT_STRIPS = R.strips as BoltSymbol[][];
export const BOLT_LINES = R.lines;
export const BOLT_LINE_COUNT = BOLT_LINES.length;
export const BOLT_ROWS = R.rows;
export const BOLT_REELS = R.reels;
export const BOLT_WILD = R.symbols.wild as "bot";
export const BOLT_SCATTER = R.symbols.scatter as "core";
export const BOLT_PAYS = boltConfig.payout_model.pays as Record<BoltPaySymbol | "bot", [number, number, number]>;
export const BOLT_PAY_SYMBOLS = [...R.symbols.high, ...R.symbols.low] as BoltPaySymbol[];
export const BOLT_FS = {
  trigger: FS.trigger_scatters,
  spinsBy: FS.spins_by_scatters as Record<string, number>,
  startMultiplier: FS.start_multiplier,
  step: FS.multiplier_step_per_wild,
  maxMultiplier: FS.max_multiplier,
  retrigger: FS.retrigger_scatters,
  retriggerSpins: FS.retrigger_spins,
  maxTotalSpins: FS.max_total_spins,
};

/** Free spins for a base spin that shows `cores` cores (0 if it does not trigger). */
export function boltSpinsFor(cores: number): number {
  if (cores < BOLT_FS.trigger) return 0;
  const keys = Object.keys(BOLT_FS.spinsBy).map(Number);
  return BOLT_FS.spinsBy[String(Math.min(cores, Math.max(...keys)))];
}

export interface BoltLineWin {
  line: number;
  symbol: BoltPaySymbol | "bot";
  count: number; // 3, 4 or 5 reels from the left
  units: number; // line bets, before the free-spin multiplier
}

export interface BoltSpin {
  stops: number[];
  window: BoltSymbol[][]; // [row][reel]
  lineWins: BoltLineWin[];
  units: number;
  wilds: number;
  cores: number;
  multiplier: number; // multiplier this spin paid at (1 in the base game)
  added: number; // free spins this spin added (retrigger), 0 otherwise
}

export interface BoltBet {
  stake: number; // centi-points per spin (all ten lines)
}

export interface BoltOutcome {
  base: BoltSpin;
  freeSpins: BoltSpin[];
  baseGross: number;
  freeGross: number;
  gross: number;
}

export function boltWindow(stops: number[]): BoltSymbol[][] {
  return Array.from({ length: BOLT_ROWS }, (_, row) => stops.map((s, reel) => BOLT_STRIPS[reel][(s + row) % BOLT_STRIPS[reel].length]));
}

const payOf = (symbol: BoltPaySymbol | "bot", count: number) => (count >= 3 ? BOLT_PAYS[symbol][count - 3] : 0);

/** Pay of one line's five symbols (left to right), in line bets, or null. */
export function boltLineWin(symbols: BoltSymbol[]): { symbol: BoltPaySymbol | "bot"; count: number; units: number } | null {
  let wr = 0;
  while (wr < symbols.length && symbols[wr] === BOLT_WILD) wr++;
  const wildPay = payOf(BOLT_WILD, wr);
  const first = symbols[wr];
  let best: { symbol: BoltPaySymbol | "bot"; count: number; units: number } | null = wildPay > 0 ? { symbol: BOLT_WILD, count: wr, units: wildPay } : null;
  if (first !== undefined && first !== BOLT_SCATTER) {
    let n = wr;
    while (n < symbols.length && (symbols[n] === first || symbols[n] === BOLT_WILD)) n++;
    const pay = payOf(first as BoltPaySymbol, n);
    if (pay > 0 && (!best || pay > best.units)) best = { symbol: first as BoltPaySymbol, count: n, units: pay };
  }
  return best;
}

export function boltEvaluate(stops: number[]): BoltSpin {
  const window = boltWindow(stops);
  const lineWins: BoltLineWin[] = [];
  BOLT_LINES.forEach((rows, line) => {
    const w = boltLineWin(rows.map((row, reel) => window[row][reel]));
    if (w) lineWins.push({ line, ...w });
  });
  const flat = window.flat();
  return {
    stops,
    window,
    lineWins,
    units: lineWins.reduce((s, w) => s + w.units, 0),
    wilds: flat.filter((s) => s === BOLT_WILD).length,
    cores: flat.filter((s) => s === BOLT_SCATTER).length,
    multiplier: 1,
    added: 0,
  };
}

const TABLE_RTP_NUM = BigInt(boltConfig.payout_model.table_rtp.num);
const TABLE_RTP_DEN = BigInt(boltConfig.payout_model.table_rtp.den);

/**
 * A win at the owner-set RTP: the paytable's exact RTP is table_rtp (a fraction); a win is multiplied
 * by target_rtp / table_rtp and floored to a centi-point (same rule as play_bolt in SQL).
 * Without `rtpBp` the paytable's own RTP applies and the amount is unchanged.
 */
export function boltScalePay(amount: number, rtpBp?: number): number {
  if (rtpBp === undefined || amount === 0) return amount;
  return Number((BigInt(amount) * BigInt(rtpBp) * TABLE_RTP_DEN) / (10000n * TABLE_RTP_NUM));
}

export function validateBoltStake(stake: number): void {
  const { min, max, multiple_of } = boltConfig.stake_limits;
  if (!Number.isSafeInteger(stake) || stake < min || stake > max) {
    throw new Error(`قيمة الرهان يجب أن تكون بين ${min / 100} و${max / 100} نقطة.`);
  }
  if (stake % multiple_of !== 0) throw new Error(`قيمة الرهان يجب أن تكون من مضاعفات ${multiple_of / 100} نقطة.`);
}

function spin(stream: RandomStream): BoltSpin {
  return boltEvaluate(BOLT_STRIPS.map((strip) => unbiasedInteger(stream, strip.length)));
}

/** The next multiplier and the spins added after a free spin that showed `wilds` robots and `cores` cores. */
export function boltAfterFreeSpin(multiplier: number, wilds: number, cores: number, awarded: number): { multiplier: number; added: number } {
  const added = cores >= BOLT_FS.retrigger && awarded + BOLT_FS.retriggerSpins <= BOLT_FS.maxTotalSpins ? BOLT_FS.retriggerSpins : 0;
  return { multiplier: Math.min(multiplier + BOLT_FS.step * wilds, BOLT_FS.maxMultiplier), added };
}

export function resolveBolt(stream: RandomStream, bet: BoltBet, rtpBp?: number): BoltOutcome {
  validateBoltStake(bet.stake);
  const lineBet = bet.stake / BOLT_LINE_COUNT;
  const base = spin(stream);
  const freeSpins: BoltSpin[] = [];
  const start = boltSpinsFor(base.cores);
  if (start > 0) {
    let left = start;
    let awarded = start;
    let multiplier = BOLT_FS.startMultiplier;
    while (left > 0) {
      const s = spin(stream);
      const next = boltAfterFreeSpin(multiplier, s.wilds, s.cores, awarded);
      freeSpins.push({ ...s, multiplier, added: next.added });
      awarded += next.added;
      left += next.added - 1;
      multiplier = next.multiplier;
    }
  }
  const baseGross = boltScalePay(lineBet * base.units, rtpBp);
  const freeGross = freeSpins.reduce((s, f) => s + boltScalePay(lineBet * f.units * f.multiplier, rtpBp), 0);
  const gross = baseGross + freeGross;
  if (gross > boltConfig.payout_model.max_gross_payout) throw new Error("gross payout above the configured maximum");
  return { base, freeSpins, baseGross, freeGross, gross };
}

export function playBolt(seeds: { serverSeedHex: string; clientSeed: string; nonce: number }, bet: BoltBet, rtpBp?: number): BoltOutcome {
  return resolveBolt(new RandomStream({ ...seeds, domain: gameDomain("bolt") }), bet, rtpBp);
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
 * Exact RTP as fractions.
 *
 * Lines: every line crosses each reel once, and a uniform stop makes the symbol a line sees on a reel
 * follow that strip's symbol counts, so E[line units] is an enumeration over the symbol types of the
 * five reels (weighted by their counts), and E[units] = lines × E[line units].
 *
 * Free spins: spin i pays units_i × m_i, and m_i depends only on the spins before it, as does whether
 * spin i is played at all; so E[free win] = E[units] × E[Σ m_i over the spins played]. That sum is an
 * exact recursion over (spins left, spins awarded, multiplier), using the joint distribution of
 * (robots, cores) in one window: per reel by its 32 stops, then convolved across the reels.
 */
export function boltExactRtp() {
  const lens = BOLT_STRIPS.map((s) => s.length);
  const total = lens.reduce((a, b) => a * BigInt(b), 1n);
  // symbol counts per reel
  const counts = BOLT_STRIPS.map((strip) => {
    const m = new Map<BoltSymbol, bigint>();
    for (const s of strip) m.set(s, (m.get(s) ?? 0n) + 1n);
    return [...m];
  });
  let lineUnits = 0n; // Σ weight × units over symbol tuples; weight = product of counts
  const walk = (reel: number, syms: BoltSymbol[], w: bigint) => {
    if (reel === BOLT_REELS) {
      const win = boltLineWin(syms);
      if (win) lineUnits += w * BigInt(win.units);
      return;
    }
    for (const [s, n] of counts[reel]) walk(reel + 1, [...syms, s], w * n);
  };
  walk(0, [], 1n);
  const eUnits = q(lineUnits * BigInt(BOLT_LINE_COUNT), total);
  const base = mul(eUnits, q(1n, BigInt(BOLT_LINE_COUNT)));

  // joint (robots, cores) in one window, as counts over all stop combinations
  let joint = new Map<string, bigint>([["0,0", 1n]]);
  BOLT_STRIPS.forEach((strip) => {
    const per = new Map<string, bigint>();
    for (let p = 0; p < strip.length; p++) {
      let w = 0;
      let c = 0;
      for (let row = 0; row < BOLT_ROWS; row++) {
        const s = strip[(p + row) % strip.length];
        if (s === BOLT_WILD) w++;
        if (s === BOLT_SCATTER) c++;
      }
      per.set(`${w},${c}`, (per.get(`${w},${c}`) ?? 0n) + 1n);
    }
    const next = new Map<string, bigint>();
    for (const [a, na] of joint)
      for (const [b, nb] of per) {
        const [w1, c1] = a.split(",").map(Number);
        const [w2, c2] = b.split(",").map(Number);
        const key = `${w1 + w2},${c1 + c2}`;
        next.set(key, (next.get(key) ?? 0n) + na * nb);
      }
    joint = next;
  });
  const dist = [...joint].map(([key, n]) => {
    const [w, c] = key.split(",").map(Number);
    return { w, c, p: q(n, total) };
  });

  const memo = new Map<string, Q>();
  const expectMult = (left: number, awarded: number, m: number): Q => {
    if (left === 0) return q(0n);
    const key = `${left}:${awarded}:${m}`;
    const hit = memo.get(key);
    if (hit) return hit;
    let e = q(BigInt(m));
    for (const { w, c, p } of dist) {
      const next = boltAfterFreeSpin(m, w, c, awarded);
      e = add(e, mul(p, expectMult(left - 1 + next.added, awarded + next.added, next.multiplier)));
    }
    memo.set(key, e);
    return e;
  };
  const spinMemo = new Map<string, Q>();
  const expectSpins = (left: number, awarded: number): Q => {
    if (left === 0) return q(0n);
    const key = `${left}:${awarded}`;
    const hit = spinMemo.get(key);
    if (hit) return hit;
    let e = q(1n);
    for (const { c, p } of dist) {
      const added = boltAfterFreeSpin(1, 0, c, awarded).added;
      e = add(e, mul(p, expectSpins(left - 1 + added, awarded + added)));
    }
    spinMemo.set(key, e);
    return e;
  };

  let multSum = q(0n); // Σ over trigger counts of P(k cores) × E[Σ m]
  let spinSum = q(0n);
  let trigger = q(0n);
  for (const { c, p } of dist) {
    const n = boltSpinsFor(c);
    if (n === 0) continue;
    trigger = add(trigger, p);
    multSum = add(multSum, mul(p, expectMult(n, n, BOLT_FS.startMultiplier)));
    spinSum = add(spinSum, mul(p, expectSpins(n, n)));
  }
  const free = mul(base, multSum);
  const rtp = add(base, free);
  const f = (x: Q) => Number(x.n) / Number(x.d);
  return {
    rtp,
    base,
    free,
    rtpValue: f(rtp),
    baseValue: f(base),
    freeValue: f(free),
    triggerOneIn: 1 / f(trigger),
    avgFreeSpins: f(spinSum) / f(trigger),
    avgMultiplier: f(multSum) / f(spinSum),
    avgWilds: dist.reduce((s, x) => s + x.w * f(x.p), 0),
  };
}

/** RTP at an owner-set RTP, as a fraction of 1 (the table's own value without `rtpBp`). */
export function boltScaledRtp(rtpBp?: number): number {
  return rtpBp === undefined ? boltExactRtp().rtpValue : rtpBp / 10000;
}

/**
 * An upper bound on the gross of one round in line bets: the best spin (`maxUnits`, from the full
 * enumeration) on the base spin and on every free spin, each free spin at the highest multiplier.
 * Used for the payout cap.
 */
export function boltMaxRoundUnits(maxUnits: number): number {
  return maxUnits + maxUnits * BOLT_FS.maxMultiplier * BOLT_FS.maxTotalSpins;
}

/**
 * Every stop combination of one spin (32^5 ≈ 33.5 million), on symbol indexes for speed: the hit
 * frequency and the best spin. Slow (seconds); the tests and the PAR sheet use it.
 */
export function boltEnumerateSpins(): { hitFrequency: number; maxUnits: number; meanUnits: number } {
  const ids: BoltSymbol[] = [BOLT_WILD, BOLT_SCATTER, ...BOLT_PAY_SYMBOLS];
  const strips = BOLT_STRIPS.map((s) => Int8Array.from(s, (x) => ids.indexOf(x)));
  const pays = ids.map((k) => (k === BOLT_SCATTER ? [0, 0, 0] : BOLT_PAYS[k as BoltPaySymbol | "bot"]));
  const lens = strips.map((s) => s.length);
  const a = new Int8Array(BOLT_REELS);
  const stops = new Int32Array(BOLT_REELS);
  const lineUnits = () => {
    let wr = 0;
    while (wr < BOLT_REELS && a[wr] === 0) wr++;
    let best = wr >= 3 ? pays[0][wr - 3] : 0;
    if (wr < BOLT_REELS && a[wr] !== 1) {
      const f = a[wr];
      let n = wr;
      while (n < BOLT_REELS && (a[n] === f || a[n] === 0)) n++;
      if (n >= 3 && pays[f][n - 3] > best) best = pays[f][n - 3];
    }
    return best;
  };
  let hits = 0;
  let maxUnits = 0;
  let sum = 0;
  let count = 0;
  const walk = (reel: number) => {
    if (reel === BOLT_REELS) {
      let u = 0;
      for (const rows of BOLT_LINES) {
        for (let r = 0; r < BOLT_REELS; r++) a[r] = strips[r][(stops[r] + rows[r]) % lens[r]];
        u += lineUnits();
      }
      if (u > 0) hits++;
      if (u > maxUnits) maxUnits = u;
      sum += u;
      count++;
      return;
    }
    for (let s = 0; s < lens[reel]; s++) {
      stops[reel] = s;
      walk(reel + 1);
    }
  };
  walk(0);
  return { hitFrequency: hits / count, maxUnits, meanUnits: sum / count };
}
