/**
 * Dice — spec 4.3 (model), 6.7 (derivation), 7.9 (config).
 *
 * Integer arithmetic only. Probabilities are counts out of `outcome_space` (10000), the RTP is in
 * basis points (9900 = 99.00%), multipliers are in ten-thousandths (20000 = 2.0000x) and amounts in centi-points.
 *
 * The roll R is uniform in {0..9999}, shown as 00.00–99.99.
 *   under T: win when R <  T  → win_count = T
 *   over  T: win when R >= T  → win_count = 10000 − T
 * multiplier = floor(rtp_bp × 10000 / win_count) ten-thousandths; gross = floor(stake × multiplier / 10000).
 * Four decimals (not two) keep every choice within 0.01% of the target RTP; two decimals lost up to 0.94%.
 */
import diceConfig from "../../../config/games/dice.json";
import { RandomStream, gameDomain, unbiasedInteger } from "../fairness/rng";

export type DiceDirection = "under" | "over";

export interface DiceConfig {
  game_id: "dice";
  config_version: number;
  stake_limits: { min: number; max: number };
  rules: { outcome_space: number; win_count_bounds: { min: number; max: number }; directions: string[] };
  payout_model: { target_rtp_bp: number; max_gross_payout: number };
}

export const DICE_CONFIG = diceConfig as DiceConfig;

export interface DiceBet {
  stake: number; // centi-points
  target: number; // threshold T in {0..10000}
  direction: DiceDirection;
}

export interface DiceOutcome {
  roll: number;
  win: boolean;
  multiplier: number; // ten-thousandths
  gross: number; // centi-points, includes the stake on a win, 0 on a loss
}

export function winCount(target: number, direction: DiceDirection, config = DICE_CONFIG): number {
  return direction === "under" ? target : config.rules.outcome_space - target;
}

/** Throws with an Arabic message the UI can show as-is. */
export function validateBet(bet: DiceBet, config = DICE_CONFIG): void {
  const { min, max } = config.stake_limits;
  if (!Number.isSafeInteger(bet.stake) || bet.stake < min || bet.stake > max) {
    throw new Error(`قيمة الدخول يجب أن تكون بين ${min / 100} و${max / 100} نقطة.`);
  }
  if (!config.rules.directions.includes(bet.direction)) throw new Error("اتجاه غير معروف.");
  if (!Number.isSafeInteger(bet.target)) throw new Error("الحد يجب أن يكون عدداً صحيحاً.");
  const wc = winCount(bet.target, bet.direction, config);
  const b = config.rules.win_count_bounds;
  if (wc < b.min || wc > b.max) {
    throw new Error(`فرصة الفوز يجب أن تكون بين ${b.min / 100}% و${b.max / 100}%.`);
  }
}

/** Multipliers are fixed-point with this many units per 1.0x. */
export const MULTIPLIER_SCALE = 10000;

export function multiplierFor(wc: number, config = DICE_CONFIG): number {
  return Math.floor((config.payout_model.target_rtp_bp * MULTIPLIER_SCALE) / wc);
}

export function grossPayout(stake: number, multiplier: number): number {
  return Math.floor((stake * multiplier) / MULTIPLIER_SCALE);
}

/** Exact RTP of one bet choice, as a fraction win_count × multiplier / (outcome_space × scale). */
export function exactRtp(wc: number, config = DICE_CONFIG): { num: number; den: number } {
  return { num: wc * multiplierFor(wc, config), den: config.rules.outcome_space * MULTIPLIER_SCALE };
}

export function resolveDice(stream: RandomStream, bet: DiceBet, config = DICE_CONFIG): DiceOutcome {
  validateBet(bet, config);
  const roll = unbiasedInteger(stream, config.rules.outcome_space);
  const win = bet.direction === "under" ? roll < bet.target : roll >= bet.target;
  const multiplier = multiplierFor(winCount(bet.target, bet.direction, config), config);
  const gross = win ? grossPayout(bet.stake, multiplier) : 0;
  if (gross > config.payout_model.max_gross_payout) throw new Error("gross payout above the configured maximum");
  return { roll, win, multiplier, gross };
}

/** Convenience for one round from seed material (the server and the verifier call this). */
export function playDice(
  seeds: { serverSeedHex: string; clientSeed: string; nonce: number },
  bet: DiceBet,
  config = DICE_CONFIG,
): DiceOutcome {
  return resolveDice(new RandomStream({ ...seeds, domain: gameDomain("dice") }), bet, config);
}
