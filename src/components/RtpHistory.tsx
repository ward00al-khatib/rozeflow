"use client";
import { useEffect, useState } from "react";
import { fmtRtp, rtpOf, type ConfigVersionRow } from "@/lib/server/gameConfig";
import { supabase } from "@/lib/supabase/client";
import styles from "./RtpHistory.module.css";

const GAME_NAMES: Record<string, string> = {
  dice: "النرد",
  roulette: "الروليت",
  plinko: "بلينكو",
  mines: "الألغام",
  crash: "كراش",
  slots: "السلوتس",
  reef: "شعاب الفقاعات",
  bolt: "بُرغي الصغير",
};

const fmtDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";

/** Public log of RTP versions (spec 2.5): every change the owner makes is listed for members. */
export function RtpHistory({ gameId, reloadKey }: { gameId?: string; reloadKey?: number }) {
  const [rows, setRows] = useState<ConfigVersionRow[] | null>(null);

  useEffect(() => {
    let q = supabase()
      .from("game_config_versions")
      .select("game_id, version, status, config_json, effective_at, change_reason")
      .order("effective_at", { ascending: false })
      .limit(gameId ? 6 : 30);
    if (gameId) q = q.eq("game_id", gameId);
    q.then(({ data }) => setRows((data ?? []) as ConfigVersionRow[]), () => setRows([]));
  }, [gameId, reloadKey]);

  if (!rows || rows.length === 0) return gameId ? null : <p className="muted">لا تغييرات بعد.</p>;

  return (
    <div className={styles.wrap}>
      {gameId && <h3>سجل نسبة العائد</h3>}
      <table className={styles.table}>
        <thead>
          <tr>
            {!gameId && <th>اللعبة</th>}
            <th>الإصدار</th>
            <th>العائد</th>
            <th>منذ</th>
            {!gameId && <th>السبب</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const bp = rtpOf(r);
            return (
              <tr key={`${r.game_id}:${r.version}`} className={r.status === "ACTIVE" ? styles.active : undefined}>
                {!gameId && <td>{GAME_NAMES[r.game_id] ?? r.game_id}</td>}
                <td className="num">{r.version}</td>
                <td className="num">{bp ? `${fmtRtp(bp)}%` : "—"}</td>
                <td className="num" dir="ltr">{fmtDate(r.effective_at)}</td>
                {!gameId && <td>{r.change_reason ?? ""}</td>}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
