/**
 * Crash (single player) — spec 4.3 (model), 6.7 (derivation), 4.2 (one open round).
 *
 * The crash point C is fixed by the seeds when the round starts:
 *   X = the 52-bit integer behind unit_float (U = X / 2^52)
 *   C = min(1000x, max(1.00x, floor(100 × rtp / (1 − U)) / 100))       (hundredths, exact BigInt maths)
 * so P(C ≥ x) = rtp / x for every target x in [1.01x, 1000x]: every cash-out target has RTP = 99%.
 * The 1000x cap equals the payout cap at max stake, so it never clips a reachable payout.
 *
 * Timing: the multiplier grows as floor(100 · e^(0.08 t)) / 100. In demo mode the browser keeps
 * time; on the server the cash-out time is the server's (spec: Crash over HTTP with server timing).
 */
import crashConfig from "../../../config/games/crash.json";
import { RandomStream, gameDomain } from "../fairness/rng";

export const CRASH_CONFIG = crashConfig;
const TWO52 = 1n << 52n;

export interface CrashBet {
  stake: number; // centi-points
  autoCashout: number; // hundredths, e.g. 200 = 2.00x
}

export interface CrashOutcome {
  crashPoint: number; // hundredths
  cashedAt: number | null; // hundredths, null = crashed first
  gross: number;
}

/** The raw 52-bit integer X; unitFloat(stream) === X / 2^52. Reads 7 bytes like unitFloat. */
function unitInteger(stream: RandomStream): bigint {
  const b = stream.readBytes(7);
  let x = 0n;
  for (const byte of b) x = (x << 8n) | BigInt(byte);
  return x >> 4n;
}

export function crashPointFromInteger(x: bigint, rtpBp = crashConfig.payout_model.target_rtp_bp): number {
  // floor(100 × (rtp_bp / 10000) × 2^52 / (2^52 − X))
  const c = (100n * BigInt(rtpBp) * TWO52) / (10000n * (TWO52 - x));
  const capped = c > BigInt(crashConfig.payout_model.max_multiplier) ? BigInt(crashConfig.payout_model.max_multiplier) : c;
  return Math.max(100, Number(capped));
}

export function crashPoint(seeds: { serverSeedHex: string; clientSeed: string; nonce: number }): number {
  return crashPointFromInteger(unitInteger(new RandomStream({ ...seeds, domain: gameDomain("crash") })));
}

export function validateCrashBet(bet: CrashBet): void {
  const { min, max } = crashConfig.stake_limits;
  if (!Number.isSafeInteger(bet.stake) || bet.stake < min || bet.stake > max) {
    throw new Error(`قيمة الدخول يجب أن تكون بين ${min / 100} و${max / 100} نقطة.`);
  }
  const a = crashConfig.rules.auto_cashout;
  if (!Number.isInteger(bet.autoCashout) || bet.autoCashout < a.min || bet.autoCashout > a.max) {
    throw new Error(`التحصيل التلقائي يجب أن يكون بين ${(a.min / 100).toFixed(2)}× و${a.max / 100}×.`);
  }
}

/** Multiplier shown after `ms` milliseconds of flight, in hundredths. */
export function multiplierAt(ms: number): number {
  return Math.floor(100 * Math.exp((crashConfig.rules.growth_rate_per_second * Math.max(0, ms)) / 1000));
}

/** Milliseconds until the multiplier first reaches `m` hundredths. */
export function timeToReach(m: number): number {
  return Math.ceil((Math.log(m / 100) / crashConfig.rules.growth_rate_per_second) * 1000);
}

/**
 * Settles a round. `manualAt` is the multiplier at the moment the player pressed cash out (null if
 * they did not). The earlier of manual and automatic cash-out wins; it must be below the crash point.
 */
export function settleCrash(bet: CrashBet, crash: number, manualAt: number | null): CrashOutcome {
  const candidates = [bet.autoCashout, ...(manualAt !== null ? [manualAt] : [])];
  const at = Math.min(...candidates);
  if (at <= crash && at >= 100) {
    const gross = Math.floor((bet.stake * at) / 100);
    if (gross > crashConfig.payout_model.max_gross_payout) throw new Error("gross payout above the configured maximum");
    return { crashPoint: crash, cashedAt: at, gross };
  }
  return { crashPoint: crash, cashedAt: null, gross: 0 };
}
