"use client";
import { formatPoints } from "@/lib/points";
import { fmtMultiplier, useBigWins } from "@/lib/social";
import styles from "./social.module.css";

/** A slow strip of members' recent wins of 10× or more (last 7 days). */
export function BigWinTicker({ userId }: { userId: string | null }) {
  const wins = useBigWins(userId);
  if (!userId || wins.length === 0) return null;
  const items = wins.map((w, i) => (
    <span key={i} className={styles.tickItem}>
      <b>{w.display_name}</b> ربح <span className={`num ${styles.tickMult}`} dir="ltr">{fmtMultiplier(w.multiplier_bp)}</span> في {w.name_ar}
      {" "}
      <span className="num muted" dir="ltr">+{formatPoints(w.gross)}</span>
    </span>
  ));
  return (
    <div className={styles.ticker} aria-label="فوزات كبيرة حديثة">
      <span className={styles.tickLabel}>فوزات كبيرة</span>
      <div className={styles.tickViewport}>
        <div className={styles.tickTrack} style={{ animationDuration: `${Math.max(20, wins.length * 7)}s` }}>
          {items}
          <span aria-hidden="true" className={styles.tickCopy}>
            {items}
          </span>
        </div>
      </div>
    </div>
  );
}
