"use client";
import { useEffect, useState } from "react";
import { formatPoints } from "@/lib/points";
import { playSound } from "@/lib/sound";
import { WIN_TIER_LABEL, winTier } from "@/lib/winTier";
import styles from "./WinBanner.module.css";

/**
 * Win label over the stage, in four sizes (see lib/winTier): a small badge for wins under 5×,
 * a card for 5×–20×, and the full-stage celebration from 20× (gold from 100×). `id` changes for
 * every new result so the same amount twice still replays. Shows the gross payout counting up.
 */
export function WinBanner({ id, gross, stake }: { id: string | null; gross: number; stake: number }) {
  const [shown, setShown] = useState<string | null>(null);
  const [count, setCount] = useState(0);
  const tier = winTier(gross, stake);

  useEffect(() => {
    if (!id || tier === "none") return;
    setShown(id);
    playSound(tier === "big" || tier === "epic" ? "bigWin" : "win");
    const dur = { small: 350, medium: 900, big: 1600, epic: 2400 }[tier];
    const t0 = performance.now();
    let raf = 0;
    const step = (t: number) => {
      const p = Math.min(1, (t - t0) / dur);
      setCount(Math.round(gross * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    const hide = window.setTimeout(() => setShown(null), { small: 1400, medium: 2200, big: 3200, epic: 4200 }[tier]);
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(hide);
    };
  }, [id, gross, tier]);

  if (!shown || shown !== id || tier === "none") return null;
  const mult = gross / stake;
  const rays = tier === "epic" ? 28 : 18;
  return (
    <div className={`${styles.wrap} ${styles[tier]}`} aria-live="polite" onClick={() => setShown(null)}>
      {(tier === "big" || tier === "epic") && (
        <div className={styles.rays} aria-hidden="true">
          {Array.from({ length: rays }, (_, i) => (
            <i key={i} style={{ ["--a" as string]: `${(i * 360) / rays}deg`, ["--d" as string]: `${(i % 6) * 70}ms` }} />
          ))}
        </div>
      )}
      <div className={styles.card}>
        <span className={styles.title}>{WIN_TIER_LABEL[tier]}</span>
        <span className={`num ${styles.amount}`}>{formatPoints(count)}</span>
        <span className={`num ${styles.mult}`}>{mult.toFixed(mult >= 100 ? 0 : 2)}×</span>
      </div>
    </div>
  );
}
