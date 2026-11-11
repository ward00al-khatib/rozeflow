"use client";
import { useEffect, useRef } from "react";
import { LINES, PAY_SYMBOLS, type SlotSymbol } from "@/lib/games/slots";
import { playSound } from "@/lib/sound";
import { Symbol } from "./symbols";
import styles from "./slots.module.css";

const FILLER = 14;
const ALL: SlotSymbol[] = [...PAY_SYMBOLS, "wild", "scatter"];
const rnd = () => ALL[Math.floor(Math.random() * ALL.length)];

/**
 * Five reels in a 5×5 window. When `spinKey` changes, each reel scrolls from the previous symbols
 * through a blurred filler strip down to the new ones, stopping left to right. `onStopped` fires
 * once the last reel lands.
 */
export function Reels({
  window: grid,
  previous,
  spinKey,
  turbo,
  onStopped,
  wins,
  activeLine,
  dim,
}: {
  window: SlotSymbol[][]; // [row][reel]
  previous: SlotSymbol[][];
  spinKey: number;
  turbo: boolean;
  onStopped: () => void;
  wins: { line: number; count: number }[];
  activeLine: number | null;
  dim: boolean;
}) {
  const inner = useRef<(HTMLDivElement | null)[]>([]);
  const done = useRef(onStopped);
  done.current = onStopped;
  // Deterministic first render (the page is pre-rendered); random fillers from the first spin on.
  const fillers = useRef<SlotSymbol[][]>(Array.from({ length: 5 }, (_, r) => Array.from({ length: FILLER }, (_, i) => ALL[(r * 3 + i) % ALL.length])));

  useEffect(() => {
    if (spinKey === 0) return;
    fillers.current = Array.from({ length: 5 }, () => Array.from({ length: FILLER }, rnd));
    const total = FILLER + 10;
    const timers: number[] = [];
    inner.current.forEach((el, reel) => {
      if (!el) return;
      const dur = (turbo ? 260 : 620) + reel * (turbo ? 70 : 170);
      el.style.transition = "none";
      el.style.transform = `translateY(-${((FILLER + 5) / total) * 100}%)`;
      el.classList.add(styles.blur);
      void el.offsetHeight; // apply the start position before animating
      el.style.transition = `transform ${dur}ms cubic-bezier(0.32, 0.02, 0.25, 1.06)`;
      el.style.transform = "translateY(0)";
      timers.push(
        window.setTimeout(() => {
          el.classList.remove(styles.blur);
          const scatter = Array.from({ length: 5 }, (_, row) => grid[row][reel]).includes("scatter");
          playSound(scatter ? "pop" : "tick");
          if (reel === 4) done.current();
        }, dur),
      );
    });
    return () => timers.forEach((t) => window.clearTimeout(t));
    // grid is read when the reel lands; it changes together with spinKey
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spinKey]);

  const winCells = new Set<string>();
  for (const w of wins) {
    if (activeLine !== null && w.line !== activeLine) continue;
    LINES[w.line].slice(0, w.count).forEach((row, reel) => winCells.add(`${row}:${reel}`));
  }
  const shownLines = wins.filter((w) => activeLine === null || w.line === activeLine);

  return (
    <div className={styles.window} dir="ltr">
      {[0, 1, 2, 3, 4].map((reel) => (
        <div key={reel} className={styles.reel}>
          <div
            className={styles.reelInner}
            ref={(el) => {
              inner.current[reel] = el;
            }}
          >
            {[
              ...[0, 1, 2, 3, 4].map((row) => ({ s: grid[row][reel], row, final: true })),
              ...fillers.current[reel].map((s) => ({ s, row: -1, final: false })),
              ...[0, 1, 2, 3, 4].map((row) => ({ s: previous[row][reel], row: -1, final: false })),
            ].map((c, i) => {
              const hit = c.final && winCells.has(`${c.row}:${reel}`);
              const scatterHit = c.final && c.s === "scatter" && dim && wins.length === 0;
              return (
                <div
                  key={i}
                  className={`${styles.cell} ${hit || scatterHit ? styles.hit : ""} ${c.final && dim && !hit && !scatterHit ? styles.dimmed : ""}`}
                >
                  <Symbol s={c.s} className={styles.sym} />
                </div>
              );
            })}
          </div>
        </div>
      ))}
      <svg className={styles.lines} viewBox="0 0 500 500" preserveAspectRatio="none" aria-hidden="true">
        {shownLines.map((w) => (
          <polyline
            key={w.line}
            className={styles.line}
            points={LINES[w.line].map((row, reel) => `${reel * 100 + 50},${row * 100 + 50}`).join(" ")}
            style={{ stroke: LINE_COLORS[w.line % LINE_COLORS.length] }}
          />
        ))}
      </svg>
    </div>
  );
}

export const LINE_COLORS = ["#ffae5c", "#3ecf8e", "#c79bff", "#ff8fb0", "#ffe08a", "#9fb4ff"];
