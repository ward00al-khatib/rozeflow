/**
 * Roulette — spec 4.3 (single-zero wheel, RTP fixed by structure at 36/37), 6.7 (derivation).
 *
 * One spin per round; a round holds several bets. Every bet type pays a gross multiplier such that
 * covered_pockets × multiplier = 36, so each one has RTP exactly 36/37 ≈ 97.30% (checked in tests).
 */
import rouletteConfig from "../../../config/games/roulette.json";
import { RandomStream, gameDomain, unbiasedInteger } from "../fairness/rng";

export type RouletteBetKind = "straight" | "red" | "black" | "odd" | "even" | "low" | "high" | "dozen" | "column";

export interface RouletteBet {
  kind: RouletteBetKind;
  /** straight: 0–36; dozen and column: 1–3; others: unused */
  value?: number;
  amount: number; // centi-points
}

export interface RouletteOutcome {
  pocket: number;
  wins: boolean[]; // per bet, same order as placed
  gross: number;
}

export const ROULETTE_CONFIG = rouletteConfig;
const RED = new Set<number>(rouletteConfig.rules.red);

export const isRed = (n: number) => RED.has(n);

/** Pockets a bet covers. Zero is covered only by a straight bet on 0. */
export function coveredPockets(kind: RouletteBetKind, value?: number): number[] {
  const all = Array.from({ length: 36 }, (_, i) => i + 1);
  switch (kind) {
    case "straight":
      return [value!];
    case "red":
      return all.filter(isRed);
    case "black":
      return all.filter((n) => !isRed(n));
    case "odd":
      return all.filter((n) => n % 2 === 1);
    case "even":
      return all.filter((n) => n % 2 === 0);
    case "low":
      return all.filter((n) => n <= 18);
    case "high":
      return all.filter((n) => n >= 19);
    case "dozen":
      return all.filter((n) => Math.ceil(n / 12) === value);
    case "column":
      return all.filter((n) => ((n - 1) % 3) + 1 === value);
  }
}

export function multiplierOf(kind: RouletteBetKind): number {
  return rouletteConfig.payout_model.gross_multiplier[kind];
}

export function betKey(b: Pick<RouletteBet, "kind" | "value">): string {
  return b.value === undefined ? b.kind : `${b.kind}:${b.value}`;
}

export function totalStake(bets: RouletteBet[]): number {
  return bets.reduce((s, b) => s + b.amount, 0);
}

export function validateBets(bets: RouletteBet[]): void {
  const { min, max, min_per_bet } = rouletteConfig.stake_limits;
  if (bets.length === 0) throw new Error("ضع رهاناً واحداً على الأقل.");
  if (bets.length > rouletteConfig.rules.max_bets_per_round) throw new Error("عدد الرهانات أكبر من المسموح.");
  const seen = new Set<string>();
  for (const b of bets) {
    if (!(b.kind in rouletteConfig.payout_model.gross_multiplier)) throw new Error("نوع رهان غير معروف.");
    if (b.kind === "straight" && !(Number.isInteger(b.value) && b.value! >= 0 && b.value! <= 36)) {
      throw new Error("رقم غير صالح.");
    }
    if ((b.kind === "dozen" || b.kind === "column") && ![1, 2, 3].includes(b.value!)) throw new Error("مجموعة غير صالحة.");
    if (!Number.isSafeInteger(b.amount) || b.amount < min_per_bet) {
      throw new Error(`أقل قيمة لكل رهان ${min_per_bet / 100} نقطة.`);
    }
    const k = betKey(b);
    if (seen.has(k)) throw new Error("رهان مكرر على الخانة نفسها.");
    seen.add(k);
  }
  const total = totalStake(bets);
  if (total < min || total > max) throw new Error(`مجموع الرهانات يجب أن يكون بين ${min / 100} و${max / 100} نقطة.`);
}

export function settleBets(pocket: number, bets: RouletteBet[]): { wins: boolean[]; gross: number } {
  const wins = bets.map((b) => coveredPockets(b.kind, b.value).includes(pocket));
  const gross = bets.reduce((s, b, i) => s + (wins[i] ? b.amount * multiplierOf(b.kind) : 0), 0);
  if (gross > rouletteConfig.payout_model.max_gross_payout) throw new Error("gross payout above the configured maximum");
  return { wins, gross };
}

export function resolveRoulette(stream: RandomStream, bets: RouletteBet[]): RouletteOutcome {
  validateBets(bets);
  const pocket = unbiasedInteger(stream, rouletteConfig.rules.pockets);
  return { pocket, ...settleBets(pocket, bets) };
}

export function playRoulette(
  seeds: { serverSeedHex: string; clientSeed: string; nonce: number },
  bets: RouletteBet[],
): RouletteOutcome {
  return resolveRoulette(new RandomStream({ ...seeds, domain: gameDomain("roulette") }), bets);
}
