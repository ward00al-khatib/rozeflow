"use client";
import { useEffect, useState } from "react";
import { formatPoints } from "@/lib/points";
import { playSound } from "@/lib/sound";
import styles from "./WinBanner.module.css";

/**
 * Win celebration over the stage. `id` changes for every new win so the same amount twice still
 * replays. Every win plays a sound; 10× and up also get the full-stage banner (50× and up the top tier).
 * `net` is the profit shown, in centi-points.
 */
export function WinBanner({ id, net, multiplier }: { id: string | null; net: number; multiplier: number }) {
  const [shown, setShown] = useState<string | null>(null);
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!id || net <= 0) return;
    const tier = multiplier >= 10 ? 2 : 1;
    playSound(tier === 2 ? "bigWin" : "win");
    if (tier === 1) return;
    setShown(id);
    const dur = 1200;
    const t0 = performance.now();
    let raf = 0;
    const step = (t: number) => {
      const p = Math.min(1, (t - t0) / dur);
      setCount(Math.round(net * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    const hide = window.setTimeout(() => setShown(null), 2600);
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(hide);
    };
  }, [id, net, multiplier]);

  if (!shown || shown !== id) return null;
  const tier = multiplier >= 50 ? "huge" : "big";
  const title = tier === "huge" ? "فوز ضخم" : "فوز كبير";
  return (
    <div className={`${styles.wrap} ${styles[tier]}`} aria-live="polite" onClick={() => setShown(null)}>
      <div className={styles.rays} aria-hidden="true">
        {Array.from({ length: 18 }, (_, i) => (
          <i key={i} style={{ ["--a" as string]: `${i * 20}deg`, ["--d" as string]: `${(i % 6) * 60}ms` }} />
        ))}
      </div>
      <div className={styles.card}>
        <span className={styles.title}>{title}</span>
        <span className={`num ${styles.amount}`}>+{formatPoints(count)}</span>
        <span className={`num ${styles.mult}`}>{multiplier.toFixed(multiplier >= 100 ? 0 : 2)}×</span>
      </div>
    </div>
  );
}
