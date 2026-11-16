"use client";
import type { CrashBet, CrashOutcome } from "../games/crash";
import type { MinesBet, MinesOutcome } from "../games/mines";
import type { PlinkoBet, PlinkoOutcome } from "../games/plinko";
import type { RouletteBet, RouletteOutcome } from "../games/roulette";
import { useServerRounds, type ServerGame } from "./rounds";

const ROULETTE: ServerGame<RouletteBet[], RouletteOutcome> = {
  game: "roulette",
  rpc: "play_roulette",
  args: (bets) => ({ p_bets: bets.map((b) => (b.value === undefined ? { kind: b.kind, amount: b.amount } : { kind: b.kind, value: b.value, amount: b.amount })) }),
  parse: (o, _stake, gross) => ({
    bet: o.bets as RouletteBet[],
    outcome: { pocket: Number(o.pocket), wins: o.wins as boolean[], gross },
  }),
};

const PLINKO: ServerGame<PlinkoBet, PlinkoOutcome> = {
  game: "plinko",
  rpc: "play_plinko",
  args: (bet) => ({ p_stake: bet.stake, p_rows: bet.rows, p_risk: bet.risk }),
  parse: (o, stake, gross) => ({
    bet: { stake, rows: Number(o.rows) as PlinkoBet["rows"], risk: o.risk as PlinkoBet["risk"] },
    outcome: { path: o.path as number[], slot: Number(o.slot), multiplier: Number(o.multiplier), gross },
  }),
};

export const useServerRoulette = (userId: string | null) => useServerRounds(userId, ROULETTE);
export const useServerPlinko = (userId: string | null) => useServerRounds(userId, PLINKO);

const MINES: ServerGame<MinesBet, MinesOutcome> = {
  game: "mines",
  rpc: "mines_start",
  args: (bet) => ({ p_stake: bet.stake, p_mines: bet.mines }),
  parse: (o, stake, gross) => ({
    bet: { stake, mines: Number(o.mines_count) },
    outcome: {
      mines: (o.mines as number[]) ?? [],
      picks: (o.picks as number[]) ?? [],
      status: o.status === "cashed" ? "cashed" : "busted",
      multiplier: Number(o.multiplier),
      gross,
    },
  }),
};

const CRASH: ServerGame<CrashBet, CrashOutcome> = {
  game: "crash",
  rpc: "crash_start",
  args: (bet) => ({ p_stake: bet.stake, p_auto_cashout: bet.autoCashout }),
  parse: (o, stake, gross) => ({
    bet: { stake, autoCashout: Number(o.auto_cashout) },
    outcome: { crashPoint: Number(o.crash_point), cashedAt: o.cashed_at == null ? null : Number(o.cashed_at), gross },
  }),
};

export const useServerMines = (userId: string | null) => useServerRounds(userId, MINES);
export const useServerCrash = (userId: string | null) => useServerRounds(userId, CRASH);
