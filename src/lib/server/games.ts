"use client";
import type { CrashBet, CrashOutcome } from "../games/crash";
import type { MinesBet, MinesOutcome } from "../games/mines";
import type { PlinkoBet, PlinkoOutcome } from "../games/plinko";
import type { RouletteBet, RouletteOutcome } from "../games/roulette";
import { boltEvaluate, type BoltBet, type BoltOutcome } from "../games/bolt";
import { reefEvaluate, type ReefBet, type ReefOutcome } from "../games/reef";
import { evaluate, type SlotsBet, type SlotsOutcome } from "../games/slots";
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

interface ServerSpin {
  stops: number[];
  multiplier?: number;
}

const SLOTS: ServerGame<SlotsBet, SlotsOutcome> = {
  game: "slots",
  rpc: "play_slots",
  args: (bet) => ({ p_stake: bet.stake, p_buy: bet.buy }),
  // The server stores the reel stops; the window and the winning lines follow from them.
  parse: (o, _stake, gross) => {
    const base = o.base as ServerSpin | null;
    return {
      bet: { stake: Number(o.bet_stake), buy: Boolean(o.buy) },
      outcome: {
        base: base ? evaluate(base.stops) : null,
        freeSpins: ((o.free_spins as ServerSpin[]) ?? []).map((f) => ({ ...evaluate(f.stops), multiplier: Number(f.multiplier) })),
        baseGross: Number(o.base_gross),
        freeGross: Number(o.free_gross),
        gross,
        cost: Number(o.cost),
      },
    };
  },
};

export const useServerSlots = (userId: string | null) => useServerRounds(userId, SLOTS);

interface ServerReefSpin {
  stops: number[];
  multiplier?: number;
  added?: number;
}

const REEF: ServerGame<ReefBet, ReefOutcome> = {
  game: "reef",
  rpc: "play_reef",
  args: (bet) => ({ p_stake: bet.stake }),
  // The server stores the reel stops; the window and the winning lines follow from them.
  parse: (o, _stake, gross) => ({
    bet: { stake: Number(o.bet_stake) },
    outcome: {
      base: reefEvaluate((o.base as ServerReefSpin).stops),
      freeSpins: ((o.free_spins as ServerReefSpin[]) ?? []).map((f) => ({
        ...reefEvaluate(f.stops),
        multiplier: Number(f.multiplier),
        added: Number(f.added ?? 0),
      })),
      baseGross: Number(o.base_gross),
      freeGross: Number(o.free_gross),
      gross,
    },
  }),
};

export const useServerReef = (userId: string | null) => useServerRounds(userId, REEF);

interface ServerBoltSpin {
  stops: number[];
  multiplier?: number;
  added?: number;
}

const BOLT: ServerGame<BoltBet, BoltOutcome> = {
  game: "bolt",
  rpc: "play_bolt",
  args: (bet) => ({ p_stake: bet.stake }),
  // The server stores the reel stops; the window and the winning lines follow from them.
  parse: (o, _stake, gross) => ({
    bet: { stake: Number(o.bet_stake) },
    outcome: {
      base: boltEvaluate((o.base as ServerBoltSpin).stops),
      freeSpins: ((o.free_spins as ServerBoltSpin[]) ?? []).map((f) => ({
        ...boltEvaluate(f.stops),
        multiplier: Number(f.multiplier),
        added: Number(f.added ?? 0),
      })),
      baseGross: Number(o.base_gross),
      freeGross: Number(o.free_gross),
      gross,
    },
  }),
};

export const useServerBolt = (userId: string | null) => useServerRounds(userId, BOLT);
