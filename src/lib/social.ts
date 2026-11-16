"use client";
/** Data for the social layer: daily bonus, recent big wins, leaderboard, own stats (spec appendix ي). */
import { useCallback, useEffect, useState } from "react";
import { formatPoints } from "./points";
import { supabase } from "./supabase/client";

export interface BonusState {
  enabled: boolean;
  claimed_today: boolean;
  streak: number;
  next_amount: number;
  base: number;
  next_at: string;
}

export interface BigWin {
  display_name: string;
  game_id: string;
  name_ar: string;
  stake: number;
  gross: number;
  multiplier_bp: number;
  at: string;
}

export interface BoardRow {
  user_id: string;
  display_name: string;
  rounds: number;
  wagered: number;
  net: number;
  best_multiplier_bp: number;
  lifetime_wagered: number;
  me: boolean;
}

const BONUS_ERRORS: Record<string, string> = {
  BONUS_ALREADY_CLAIMED: "أخذت مكافأة اليوم. عد غداً.",
  BONUS_DISABLED: "المكافأة اليومية متوقفة حالياً.",
  DEVICE_NOT_APPROVED: "هذا الجهاز ينتظر موافقة المالك.",
  DEVICE_BLOCKED: "أوقف المالك اللعب من هذا الجهاز.",
  DEVICE_UNKNOWN: "لم يُسجَّل هذا الجهاز بعد. أعد تحميل الصفحة.",
};

export function useDailyBonus(userId: string | null) {
  const [state, setState] = useState<BonusState | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    if (!userId) return;
    const { data, error } = await supabase().rpc("daily_bonus_state");
    if (!error && data) setState(data as BonusState);
  }, [userId]);

  useEffect(() => {
    void load();
  }, [load]);

  const claim = useCallback(async () => {
    setBusy(true);
    setMsg(null);
    const { data, error } = await supabase().rpc("claim_daily_bonus");
    setBusy(false);
    if (error) {
      setMsg({ ok: false, text: BONUS_ERRORS[error.message] ?? "تعذّر الاتصال بالخادم. حاول مرة أخرى." });
    } else {
      const r = data as { amount: number; streak: number };
      setMsg({ ok: true, text: `أُضيفت ${formatPoints(r.amount)} نقطة إلى رصيدك. اليوم ${r.streak} من السلسلة.` });
    }
    void load();
    return !error;
  }, [load]);

  return { state, busy, msg, claim };
}

export function useBigWins(userId: string | null, limit = 12) {
  const [wins, setWins] = useState<BigWin[]>([]);
  useEffect(() => {
    if (!userId) return;
    let alive = true;
    const load = async () => {
      const { data, error } = await supabase().rpc("recent_big_wins", { p_limit: limit });
      if (alive && !error && data) setWins(data as BigWin[]);
    };
    void load();
    const t = setInterval(load, 60_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [userId, limit]);
  return wins;
}

export function useLeaderboard(userId: string | null, period: "week" | "all") {
  const [rows, setRows] = useState<BoardRow[] | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    if (!userId) return;
    let alive = true;
    setRows(null);
    supabase()
      .rpc("leaderboard", { p_period: period })
      .then(({ data, error: e }) => {
        if (!alive) return;
        if (e || !data) return setError(true);
        setError(false);
        setRows((data as { rows: BoardRow[] }).rows);
      });
    return () => {
      alive = false;
    };
  }, [userId, period]);
  return { rows, error };
}

export function useMyStats(userId: string | null) {
  const [stats, setStats] = useState<{ rounds: number; lifetime_wagered: number } | null>(null);
  useEffect(() => {
    if (!userId) return;
    supabase()
      .rpc("my_stats")
      .then(({ data, error }) => {
        if (!error && data) setStats(data as { rounds: number; lifetime_wagered: number });
      });
  }, [userId]);
  return stats;
}

/** "12.5×" from basis points. */
export function fmtMultiplier(bp: number): string {
  const x = bp / 10000;
  return `${x >= 100 ? Math.round(x).toLocaleString("en-US") : x.toFixed(x >= 10 ? 1 : 2)}×`;
}
