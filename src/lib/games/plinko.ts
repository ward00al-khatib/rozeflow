/**
 * Plinko — spec 4.3 (model), 6.7 (derivation: one unbiased_integer(2) per row).
 *
 * The ball starts at the top and moves right on 1, left on 0, once per row; the final slot is the
 * number of right moves (0..rows), so P(slot k) = C(rows, k) / 2^rows. Each (risk, rows) pair is its
 * own published multiplier table (fixed-point, 10000 = 1.0x); tests check every table's exact RTP.
 */
import plinkoConfig from "../../../config/games/plinko.json";
import { RandomStream, gameDomain, unbiasedInteger } from "../fairness/rng";

export type PlinkoRisk = "low" | "medium" | "high";
export type PlinkoRows = 8 | 12 | 16;

export interface PlinkoBet {
  stake: number; // centi-points
  rows: PlinkoRows;
  risk: PlinkoRisk;
}

export interface PlinkoOutcome {
  path: number[]; // 0 = left, 1 = right, one per row
  slot: number;
  multiplier: number; // ten-thousandths
  gross: number;
}

export const PLINKO_CONFIG = plinkoConfig;
export const PLINKO_SCALE = plinkoConfig.payout_model.multiplier_scale;

export function plinkoTable(risk: PlinkoRisk, rows: PlinkoRows): number[] {
  const t = (plinkoConfig.payout_model.multipliers as Record<string, Record<string, number[]>>)[risk]?.[String(rows)];
  if (!t || t.length !== rows + 1) throw new Error("جدول غير موجود لهذا الاختيار.");
  return t;
}

export function validatePlinkoBet(bet: PlinkoBet): void {
  const { min, max } = plinkoConfig.stake_limits;
  if (!Number.isSafeInteger(bet.stake) || bet.stake < min || bet.stake > max) {
    throw new Error(`قيمة الدخول يجب أن تكون بين ${min / 100} و${max / 100} نقطة.`);
  }
  if (!plinkoConfig.rules.rows.includes(bet.rows)) throw new Error("عدد صفوف غير مسموح.");
  if (!plinkoConfig.rules.risks.includes(bet.risk)) throw new Error("مستوى مخاطرة غير معروف.");
}

export function resolvePlinko(stream: RandomStream, bet: PlinkoBet): PlinkoOutcome {
  validatePlinkoBet(bet);
  const path: number[] = [];
  for (let i = 0; i < bet.rows; i++) path.push(unbiasedInteger(stream, 2));
  const slot = path.reduce((a, b) => a + b, 0);
  const multiplier = plinkoTable(bet.risk, bet.rows)[slot];
  const gross = Math.floor((bet.stake * multiplier) / PLINKO_SCALE);
  if (gross > plinkoConfig.payout_model.max_gross_payout) throw new Error("gross payout above the configured maximum");
  return { path, slot, multiplier, gross };
}

export function playPlinko(
  seeds: { serverSeedHex: string; clientSeed: string; nonce: number },
  bet: PlinkoBet,
): PlinkoOutcome {
  return resolvePlinko(new RandomStream({ ...seeds, domain: gameDomain("plinko") }), bet);
}
