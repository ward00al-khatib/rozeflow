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

export const PLINKO_RTP_BP = plinkoConfig.payout_model.target_rtp_bp;

/**
 * The table for (risk, rows) at the given RTP. The published base tables are built for table_rtp_bp;
 * when the owner sets another RTP every multiplier is scaled by rtp / table_rtp and floored
 * (same rule as plinko_multiplier in SQL).
 */
export function plinkoTable(risk: PlinkoRisk, rows: PlinkoRows, rtpBp: number = PLINKO_RTP_BP): number[] {
  const t = (plinkoConfig.payout_model.multipliers as Record<string, Record<string, number[]>>)[risk]?.[String(rows)];
  if (!t || t.length !== rows + 1) throw new Error("جدول غير موجود لهذا الاختيار.");
  const base = plinkoConfig.payout_model.table_rtp_bp;
  return rtpBp === base ? t : t.map((m) => Math.floor((m * rtpBp) / base));
}

export function validatePlinkoBet(bet: PlinkoBet): void {
  const { min, max } = plinkoConfig.stake_limits;
  if (!Number.isSafeInteger(bet.stake) || bet.stake < min || bet.stake > max) {
    throw new Error(`قيمة الدخول يجب أن تكون بين ${min / 100} و${max / 100} نقطة.`);
  }
  if (!plinkoConfig.rules.rows.includes(bet.rows)) throw new Error("عدد صفوف غير مسموح.");
  if (!plinkoConfig.rules.risks.includes(bet.risk)) throw new Error("مستوى مخاطرة غير معروف.");
}

export function resolvePlinko(stream: RandomStream, bet: PlinkoBet, rtpBp: number = PLINKO_RTP_BP): PlinkoOutcome {
  validatePlinkoBet(bet);
  const path: number[] = [];
  for (let i = 0; i < bet.rows; i++) path.push(unbiasedInteger(stream, 2));
  const slot = path.reduce((a, b) => a + b, 0);
  const multiplier = plinkoTable(bet.risk, bet.rows, rtpBp)[slot];
  const gross = Math.floor((bet.stake * multiplier) / PLINKO_SCALE);
  if (gross > plinkoConfig.payout_model.max_gross_payout) throw new Error("gross payout above the configured maximum");
  return { path, slot, multiplier, gross };
}

export function playPlinko(
  seeds: { serverSeedHex: string; clientSeed: string; nonce: number },
  bet: PlinkoBet,
  rtpBp: number = PLINKO_RTP_BP,
): PlinkoOutcome {
  return resolvePlinko(new RandomStream({ ...seeds, domain: gameDomain("plinko") }), bet, rtpBp);
}
