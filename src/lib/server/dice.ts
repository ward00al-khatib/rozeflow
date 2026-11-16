"use client";
/**
 * Real Dice for members: every round is settled on the server (SQL function play_dice) against the
 * real wallet, in one transaction. The browser only sends the bet and shows the answer.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { DemoRound, RevealedSeed } from "../demo/session";
import type { DiceBet, DiceOutcome } from "../games/dice";
import { supabase } from "../supabase/client";

export type DiceRound = DemoRound<DiceBet, DiceOutcome> & { id?: string; rtpBp?: number };

const ERRORS: Record<string, string> = {
  INSUFFICIENT_BALANCE: "رصيدك لا يكفي لهذه الجولة.",
  GAME_PAUSED: "اللعبة متوقفة مؤقتاً.",
  ACCOUNT_NOT_ACTIVE: "حسابك غير مفعّل للعب.",
  STAKE_OUT_OF_RANGE: "قيمة الدخول خارج الحدود المسموحة.",
  BAD_BET: "اختيار غير صالح.",
  CLIENT_SEED_TOO_LONG: "البذرة أطول من 64 حرفاً.",
};
const OFFLINE = "تعذّر الاتصال بالخادم. حاول مرة أخرى.";

export function serverError(message: string | undefined): Error {
  return new Error((message && ERRORS[message]) || OFFLINE);
}

interface PlayResult {
  round_id: string;
  roll: number;
  win: boolean;
  multiplier: number;
  target: number;
  direction: "under" | "over";
  stake: number;
  gross: number;
  nonce: number;
  available: number;
  server_seed_hash: string;
  client_seed: string;
  rtp_bp: number;
}

interface RoundRow {
  id: string;
  nonce: number;
  stake: number;
  gross_payout: number;
  outcome: Omit<PlayResult, "round_id" | "stake" | "gross" | "nonce" | "available">;
  created_at: string;
}

interface SeedPairRow {
  server_seed_hash: string;
  client_seed: string;
  status: string;
  server_seed: string | null;
  rounds: number;
}

function toRound(p: Pick<PlayResult, "round_id" | "roll" | "win" | "multiplier" | "target" | "direction" | "stake" | "gross" | "nonce" | "server_seed_hash" | "client_seed" | "rtp_bp">, at: number): DiceRound {
  return {
    id: p.round_id,
    game: "dice",
    nonce: p.nonce,
    serverSeedHash: p.server_seed_hash,
    clientSeed: p.client_seed,
    bet: { stake: p.stake, target: p.target, direction: p.direction },
    outcome: { roll: p.roll, win: p.win, multiplier: p.multiplier, gross: p.gross },
    stake: p.stake,
    gross: p.gross,
    rtpBp: p.rtp_bp,
    at,
  };
}

const MAX_ROUNDS = 50;

/** `userId` is the signed-in member, or null for visitors. The owner can read every wallet and round, so queries name the user. */
export function useServerDice(userId: string | null) {
  const [ready, setReady] = useState(false);
  const [balance, setBalance] = useState(0);
  const [rounds, setRounds] = useState<DiceRound[]>([]);
  const [revealed, setRevealed] = useState<RevealedSeed[]>([]);
  const [seed, setSeed] = useState({ serverSeedHash: "", clientSeed: "", nonce: 0 });
  const [loadError, setLoadError] = useState<string | null>(null);
  const busy = useRef(false);

  const applyPairs = useCallback((pairs: SeedPairRow[]) => {
    setRevealed(
      pairs
        .filter((p) => p.status === "revealed" && p.server_seed)
        .map((p) => ({ serverSeed: p.server_seed!, serverSeedHash: p.server_seed_hash, clientSeed: p.client_seed, lastNonce: p.rounds })),
    );
  }, []);

  const load = useCallback(async () => {
    if (!userId) return;
    const sb = supabase();
    const [wallet, state, history, pairs] = await Promise.all([
      sb.from("wallet_accounts").select("available").eq("user_id", userId).maybeSingle(),
      sb.rpc("my_seed_state"),
      sb.from("game_rounds").select("id, nonce, stake, gross_payout, outcome, created_at").eq("user_id", userId).eq("game_id", "dice").eq("status", "SETTLED").order("created_at", { ascending: false }).limit(MAX_ROUNDS),
      sb.rpc("my_seed_pairs"),
    ]);
    if (wallet.error || state.error || !wallet.data) {
      setLoadError(serverError(state.error?.message).message);
      return;
    }
    setBalance(Number(wallet.data.available));
    setSeed({ serverSeedHash: state.data.server_seed_hash, clientSeed: state.data.client_seed, nonce: Number(state.data.nonce) });
    setRounds(
      ((history.data ?? []) as RoundRow[]).map((r) =>
        toRound({ ...r.outcome, round_id: r.id, stake: Number(r.stake), gross: Number(r.gross_payout), nonce: Number(r.nonce) }, Date.parse(r.created_at)),
      ),
    );
    applyPairs((pairs.data ?? []) as SeedPairRow[]);
    setLoadError(null);
    setReady(true);
  }, [applyPairs, userId]);

  useEffect(() => {
    void load().catch(() => setLoadError(OFFLINE));
  }, [load]);

  /** One round. The same idempotency key is sent again if the network drops, so a round is never played twice. */
  const play = useCallback(async (bet: DiceBet): Promise<DiceRound> => {
    if (busy.current) throw new Error("انتظر انتهاء الجولة الحالية.");
    busy.current = true;
    try {
      const args = { p_stake: bet.stake, p_target: bet.target, p_direction: bet.direction, p_idempotency_key: crypto.randomUUID() };
      let res = await supabase().rpc("play_dice", args);
      if (res.error && !ERRORS[res.error.message]) res = await supabase().rpc("play_dice", args);
      if (res.error) throw serverError(res.error.message);
      const p = res.data as PlayResult;
      const round = toRound(p, Date.now());
      setBalance(Number(p.available));
      setSeed({ serverSeedHash: p.server_seed_hash, clientSeed: p.client_seed, nonce: p.nonce + 1 });
      setRounds((rs) => [round, ...rs].slice(0, MAX_ROUNDS));
      return round;
    } finally {
      busy.current = false;
    }
  }, []);

  const rotateSeeds = useCallback(
    async (clientSeed: string) => {
      const { data, error } = await supabase().rpc("rotate_seed", { p_client_seed: clientSeed.trim() || null });
      if (error) throw serverError(error.message);
      setSeed({ serverSeedHash: data.server_seed_hash, clientSeed: data.client_seed, nonce: Number(data.nonce) });
      const pairs = await supabase().rpc("my_seed_pairs");
      if (!pairs.error) applyPairs((pairs.data ?? []) as SeedPairRow[]);
    },
    [applyPairs],
  );

  return { ready, balance, rounds, revealed, ...seed, open: null, play, rotateSeeds, loadError, reload: load };
}
