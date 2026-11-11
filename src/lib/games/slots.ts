/**
 * Slots — spec 4.3 (reel strips, paytable, RTP by full enumeration, PAR sheet), 6.7 (derivation).
 *
 * Three reels, three visible rows, five fixed lines; the stake is split equally across the lines.
 * Each reel stops at unbiased_integer(len(strip)); that index is the top visible symbol and the
 * next two (wrapping) fill the rows below. A line pays for three of a kind, or for two cherries from
 * the left. No wilds or free spins in V1 (spec 4.3).
 */
import slotsConfig from "../../../config/games/slots.json";
import { RandomStream, gameDomain, unbiasedInteger } from "../fairness/rng";

export type SlotSymbol = "seven" | "bar" | "bell" | "star" | "gem" | "cherry";

export const SLOTS_CONFIG = slotsConfig;
const STRIPS = slotsConfig.rules.strips as SlotSymbol[][];
const LINES = slotsConfig.rules.lines;
const PAYS = slotsConfig.payout_model.three_of_a_kind as Record<SlotSymbol, number>;
export const LINE_COUNT = LINES.length;

export interface SlotsOutcome {
  stops: number[];
  window: SlotSymbol[][]; // [row][reel]
  lineWins: Array<{ line: number; symbols: SlotSymbol[]; pay: number }>; // pay in line bets
  gross: number;
}

/** Pay of one line, in line bets. */
export function linePay(symbols: SlotSymbol[]): number {
  const [a, b, c] = symbols;
  if (a === b && b === c) return PAYS[a];
  if (a === "cherry" && b === "cherry") return slotsConfig.payout_model.two_cherries_left;
  return 0;
}

export function windowAt(stops: number[]): SlotSymbol[][] {
  return [0, 1, 2].map((row) => stops.map((s, reel) => STRIPS[reel][(s + row) % STRIPS[reel].length]));
}

/** Total pay of a stop combination, in line bets, with the winning lines. */
export function evaluate(stops: number[]) {
  const window = windowAt(stops);
  const lineWins = LINES.map((rows, line) => {
    const symbols = rows.map((row, reel) => window[row][reel]);
    return { line, symbols, pay: linePay(symbols) };
  }).filter((w) => w.pay > 0);
  return { window, lineWins, units: lineWins.reduce((s, w) => s + w.pay, 0) };
}

export function validateSlotsStake(stake: number): void {
  const { min, max, multiple_of } = slotsConfig.stake_limits;
  if (!Number.isSafeInteger(stake) || stake < min || stake > max || stake % multiple_of !== 0) {
    throw new Error(`قيمة الدخول يجب أن تكون بين ${min / 100} و${max / 100} نقطة.`);
  }
}

export function resolveSlots(stream: RandomStream, stake: number): SlotsOutcome {
  validateSlotsStake(stake);
  const stops = STRIPS.map((strip) => unbiasedInteger(stream, strip.length));
  const { window, lineWins, units } = evaluate(stops);
  const gross = (stake / LINE_COUNT) * units;
  if (gross > slotsConfig.payout_model.max_gross_payout) throw new Error("gross payout above the configured maximum");
  return { stops, window, lineWins, gross };
}

export function playSlots(seeds: { serverSeedHex: string; clientSeed: string; nonce: number }, stake: number): SlotsOutcome {
  return resolveSlots(new RandomStream({ ...seeds, domain: gameDomain("slots") }), stake);
}

/**
 * PAR sheet by full enumeration of every stop combination (spec 4.3): exact RTP as a fraction,
 * hit frequency, volatility, max pay and each symbol's share of the return.
 */
export function parSheet() {
  const [l0, l1, l2] = STRIPS.map((s) => s.length);
  const total = l0 * l1 * l2;
  let sum = 0;
  let sumSq = 0;
  let hits = 0;
  let maxUnits = 0;
  const bySymbol: Record<string, number> = {};
  for (let a = 0; a < l0; a++)
    for (let b = 0; b < l1; b++)
      for (let c = 0; c < l2; c++) {
        const { lineWins, units } = evaluate([a, b, c]);
        sum += units;
        sumSq += units * units;
        if (units > 0) hits++;
        if (units > maxUnits) maxUnits = units;
        for (const w of lineWins) {
          const key = w.symbols[0] === w.symbols[2] ? w.symbols[0] : "two_cherries";
          bySymbol[key] = (bySymbol[key] ?? 0) + w.pay;
        }
      }
  // RTP = Σ units / (LINE_COUNT × total)
  const den = LINE_COUNT * total;
  const rtp = sum / den;
  const variance = sumSq / (LINE_COUNT * LINE_COUNT * total) - rtp * rtp;
  return {
    combinations: total,
    rtpNumerator: sum,
    rtpDenominator: den,
    rtp,
    hitFrequency: hits / total,
    volatility: Math.sqrt(variance),
    maxUnits,
    maxMultiplier: maxUnits / LINE_COUNT,
    contribution: Object.fromEntries(Object.entries(bySymbol).map(([k, v]) => [k, v / den])),
  };
}
