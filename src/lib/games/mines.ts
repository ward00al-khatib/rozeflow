/**
 * Mines — spec 4.3 (model), 6.7 (derivation), 9.2 (multi-step rounds).
 *
 * 25 tiles, the player picks the number of mines M. Mine positions are fixed at round start by
 * shuffle(stream, [0..24]) and the first M entries. After k safe picks the cash-out multiplier is
 *   m(k) = floor(rtp_bp × C(25, k) / C(25 − M, k))  in ten-thousandths,
 * i.e. RTP applied once to the cumulative odds, never per step (spec 4.3).
 * A round auto-cashes when every safe tile is open, or when the next pick would pass the 1,000x cap,
 * so every reachable stopping point keeps the full RTP and the payout cap is never clipped.
 */
import minesConfig from "../../../config/games/mines.json";
import { RandomStream, gameDomain, shuffle } from "../fairness/rng";

export interface MinesBet {
  stake: number; // centi-points
  mines: number;
}

export const MINES_CONFIG = minesConfig;
export const MINES_SCALE = minesConfig.payout_model.multiplier_scale;
const N = minesConfig.rules.tiles;

function binom(n: number, k: number): bigint {
  if (k < 0 || k > n) return 0n;
  let r = 1n;
  for (let i = 0; i < k; i++) r = (r * BigInt(n - i)) / BigInt(i + 1);
  return r;
}

/** Cash-out multiplier after k safe picks (k ≥ 1), in ten-thousandths. */
export function minesMultiplier(mines: number, k: number): number {
  if (k < 1 || k > N - mines) throw new Error("k out of range");
  return Number((BigInt(minesConfig.payout_model.target_rtp_bp) * binom(N, k)) / binom(N - mines, k));
}

/** Most safe picks allowed: all safe tiles, but never past the multiplier cap. */
const maxPicksCache = new Map<number, number>();
export function maxPicks(mines: number): number {
  const hit = maxPicksCache.get(mines);
  if (hit !== undefined) return hit;
  let k = 0;
  while (k < N - mines && minesMultiplier(mines, k + 1) <= minesConfig.payout_model.max_multiplier) k++;
  maxPicksCache.set(mines, k);
  return k;
}

export function validateMinesBet(bet: MinesBet): void {
  const { min, max } = minesConfig.stake_limits;
  if (!Number.isSafeInteger(bet.stake) || bet.stake < min || bet.stake > max) {
    throw new Error(`قيمة الدخول يجب أن تكون بين ${min / 100} و${max / 100} نقطة.`);
  }
  const m = minesConfig.rules.mines;
  if (!Number.isInteger(bet.mines) || bet.mines < m.min || bet.mines > m.max) {
    throw new Error(`عدد الألغام يجب أن يكون بين ${m.min} و${m.max}.`);
  }
}

/** The mine tiles of a round, fixed by the seeds before the first pick. */
export function minePositions(seeds: { serverSeedHex: string; clientSeed: string; nonce: number }, mines: number): number[] {
  const order = shuffle(new RandomStream({ ...seeds, domain: gameDomain("mines") }), [...Array(N).keys()]);
  return order.slice(0, mines).sort((a, b) => a - b);
}

export type MinesStatus = "playing" | "busted" | "cashed";

export interface MinesState {
  picks: number[];
  status: MinesStatus;
}

export interface MinesOutcome {
  mines: number[];
  picks: number[];
  status: "busted" | "cashed";
  multiplier: number; // 0 when busted
  gross: number;
}

/** Applies one pick. Returns the new state; the caller settles when status is no longer "playing". */
export function applyPick(state: MinesState, tile: number, mineTiles: number[], bet: MinesBet): MinesState {
  if (state.status !== "playing") throw new Error("الجولة منتهية.");
  if (!Number.isInteger(tile) || tile < 0 || tile >= N) throw new Error("خانة غير صالحة.");
  if (state.picks.includes(tile)) throw new Error("هذه الخانة مكشوفة.");
  const picks = [...state.picks, tile];
  if (mineTiles.includes(tile)) return { picks, status: "busted" };
  return { picks, status: picks.length >= maxPicks(bet.mines) ? "cashed" : "playing" };
}

export function settleMines(state: MinesState, mineTiles: number[], bet: MinesBet): MinesOutcome {
  if (state.status === "busted") return { mines: mineTiles, picks: state.picks, status: "busted", multiplier: 0, gross: 0 };
  const k = state.picks.length;
  if (k < 1) throw new Error("لا يمكن التحصيل قبل أول اختيار.");
  const multiplier = minesMultiplier(bet.mines, k);
  const gross = Math.floor((bet.stake * multiplier) / MINES_SCALE);
  if (gross > minesConfig.payout_model.max_gross_payout) throw new Error("gross payout above the configured maximum");
  return { mines: mineTiles, picks: state.picks, status: "cashed", multiplier, gross };
}

/** Replays a whole round from seeds and the picks in order (used by the verifier). */
export function replayMines(
  seeds: { serverSeedHex: string; clientSeed: string; nonce: number },
  bet: MinesBet,
  picks: number[],
): MinesOutcome {
  const mineTiles = minePositions(seeds, bet.mines);
  let state: MinesState = { picks: [], status: "playing" };
  for (const t of picks) {
    state = applyPick(state, t, mineTiles, bet);
    if (state.status !== "playing") break;
  }
  return settleMines(state.status === "playing" ? { ...state, status: "cashed" } : state, mineTiles, bet);
}
