"use client";
/**
 * Real play for members: every round is settled on the server (one SQL function per game) against the
 * real wallet, in one transaction. The browser only sends the bet and shows the answer.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { DemoRound, RevealedSeed } from "../demo/session";
import { supabase } from "../supabase/client";

export type ServerRound<B, O> = DemoRound<B, O> & { id?: string; rtpBp?: number };

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

/** What the server stores as a round's outcome; each game adds its own fields. */
export interface ServerOutcome {
  server_seed_hash: string;
  client_seed: string;
  rtp_bp?: number;
  [field: string]: unknown;
}

interface PlayResult extends ServerOutcome {
  round_id: string;
  stake: number;
  gross: number;
  nonce: number;
  available: number;
}

interface RoundRow {
  id: string;
  nonce: number;
  stake: number;
  gross_payout: number;
  outcome: ServerOutcome;
  created_at: string;
}

interface SeedPairRow {
  server_seed_hash: string;
  client_seed: string;
  status: string;
  server_seed: string | null;
  rounds: number;
}

/** How one game talks to its SQL function. Define it once, outside the component. */
export interface ServerGame<B, O> {
  game: string;
  rpc: string;
  args: (bet: B) => Record<string, unknown>;
  /** Rebuilds the bet and the outcome from the server's outcome JSON. */
  parse: (o: ServerOutcome, stake: number, gross: number) => { bet: B; outcome: O };
}

const MAX_ROUNDS = 50;

/** `userId` is the signed-in member, or null for visitors. The owner can read every wallet and round, so queries name the user. */
export function useServerRounds<B, O>(userId: string | null, def: ServerGame<B, O>) {
  const [ready, setReady] = useState(false);
  const [balance, setBalance] = useState(0);
  const [rounds, setRounds] = useState<ServerRound<B, O>[]>([]);
  const [revealed, setRevealed] = useState<RevealedSeed[]>([]);
  const [seed, setSeed] = useState({ serverSeedHash: "", clientSeed: "", nonce: 0 });
  const [loadError, setLoadError] = useState<string | null>(null);
  const busy = useRef(false);

  const toRound = useCallback(
    (o: ServerOutcome, id: string, nonce: number, stake: number, gross: number, at: number): ServerRound<B, O> => ({
      id,
      game: def.game,
      nonce,
      serverSeedHash: o.server_seed_hash,
      clientSeed: o.client_seed,
      ...def.parse(o, stake, gross),
      stake,
      gross,
      rtpBp: o.rtp_bp,
      at,
    }),
    [def],
  );

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
      sb.from("game_rounds").select("id, nonce, stake, gross_payout, outcome, created_at").eq("user_id", userId).eq("game_id", def.game).eq("status", "SETTLED").order("created_at", { ascending: false }).limit(MAX_ROUNDS),
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
        toRound(r.outcome, r.id, Number(r.nonce), Number(r.stake), Number(r.gross_payout), Date.parse(r.created_at)),
      ),
    );
    applyPairs((pairs.data ?? []) as SeedPairRow[]);
    setLoadError(null);
    setReady(true);
  }, [applyPairs, userId, def.game, toRound]);

  useEffect(() => {
    void load().catch(() => setLoadError(OFFLINE));
  }, [load]);

  /** One round. The same idempotency key is sent again if the network drops, so a round is never played twice. */
  const play = useCallback(
    async (bet: B): Promise<ServerRound<B, O>> => {
      if (busy.current) throw new Error("انتظر انتهاء الجولة الحالية.");
      busy.current = true;
      try {
        const args = { ...def.args(bet), p_idempotency_key: crypto.randomUUID() };
        let res = await supabase().rpc(def.rpc, args);
        if (res.error && !ERRORS[res.error.message]) res = await supabase().rpc(def.rpc, args);
        if (res.error) throw serverError(res.error.message);
        const p = res.data as PlayResult;
        const round = toRound(p, p.round_id, Number(p.nonce), Number(p.stake), Number(p.gross), Date.now());
        setBalance(Number(p.available));
        setSeed({ serverSeedHash: p.server_seed_hash, clientSeed: p.client_seed, nonce: Number(p.nonce) + 1 });
        setRounds((rs) => [round, ...rs].slice(0, MAX_ROUNDS));
        return round;
      } finally {
        busy.current = false;
      }
    },
    [def, toRound],
  );

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
