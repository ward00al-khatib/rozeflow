"use client";
import type { DiceBet, DiceOutcome } from "../games/dice";
import { useServerRounds, type ServerGame, type ServerRound } from "./rounds";

export type DiceRound = ServerRound<DiceBet, DiceOutcome>;

const DICE: ServerGame<DiceBet, DiceOutcome> = {
  game: "dice",
  rpc: "play_dice",
  args: (bet) => ({ p_stake: bet.stake, p_target: bet.target, p_direction: bet.direction }),
  parse: (o, stake, gross) => ({
    bet: { stake, target: Number(o.target), direction: o.direction as DiceBet["direction"] },
    outcome: { roll: Number(o.roll), win: Boolean(o.win), multiplier: Number(o.multiplier), gross },
  }),
};

export const useServerDice = (userId: string | null) => useServerRounds(userId, DICE);
