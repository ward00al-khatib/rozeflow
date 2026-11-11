import type { CSSProperties } from "react";
import styles from "./Ambient.module.css";

/** Small deterministic generator, so server and browser render the same particles. */
function rand(seed: number) {
  let x = seed * 2654435761;
  return () => {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return ((x >>> 0) % 10000) / 10000;
  };
}

const TONES = ["var(--signal-2)", "var(--signal)", "#a66bff", "var(--win)", "#ffffff"];

/**
 * Slow drifting lights behind a page or a game stage. Pure CSS motion (no canvas, no video),
 * hidden from assistive tech, and still when the visitor prefers reduced motion.
 */
export function Ambient({ count = 26, seed = 7, className }: { count?: number; seed?: number; className?: string }) {
  const r = rand(seed);
  return (
    <div className={`${styles.ambient} ${className ?? ""}`} aria-hidden="true">
      <span className={`${styles.glow} ${styles.glowA}`} />
      <span className={`${styles.glow} ${styles.glowB}`} />
      {Array.from({ length: count }, (_, i) => {
        const size = 2 + Math.floor(r() * 5);
        const style = {
          left: `${(r() * 100).toFixed(2)}%`,
          top: `${(r() * 100).toFixed(2)}%`,
          width: size,
          height: size,
          color: TONES[Math.floor(r() * TONES.length)],
          animationDuration: `${(9 + r() * 14).toFixed(1)}s`,
          animationDelay: `${(-r() * 20).toFixed(1)}s`,
          "--dx": `${Math.round((r() - 0.5) * 80)}px`,
          "--dy": `${-40 - Math.round(r() * 110)}px`,
        } as CSSProperties;
        return <i key={i} style={style} />;
      })}
    </div>
  );
}
