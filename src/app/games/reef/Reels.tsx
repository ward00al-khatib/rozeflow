"use client";
import { useEffect, useRef } from "react";
import { REEF_LINES as LINES, REEF_PAY_SYMBOLS, type ReefSymbol } from "@/lib/games/reef";
import { playSound } from "@/lib/sound";
import { ReefSym } from "./symbols";
import styles from "./reef.module.css";

const FILLER = 12;
const N = 3; // reels and rows
const ALL: ReefSymbol[] = [...REEF_PAY_SYMBOLS, "pearl", "chest"];
const rnd = () => ALL[Math.floor(Math.random() * ALL.length)];

/**
 * Three reels in a 3×3 window (same motion as the Night Lab reels). When `spinKey` changes, each
 * reel scrolls from the previous symbols through a blurred filler strip down to the new ones,
 * stopping left to right. `onStopped` fires once every reel has landed.
 */
export function Reels({
  window: grid,
  previous,
  spinKey,
  quickStop,
  turbo,
  onStopped,
  wins,
  activeLine,
  dim,
  chestHit,
}: {
  window: ReefSymbol[][]; // [row][reel]
  previous: ReefSymbol[][];
  spinKey: number;
  quickStop: number; // bump to land the turning reels at once
  turbo: boolean;
  onStopped: () => void;
  wins: { line: number }[];
  activeLine: number | null;
  dim: boolean;
  chestHit: boolean; // chests light up (they start or feed the bonus)
}) {
  const inner = useRef<(HTMLDivElement | null)[]>([]);
  const done = useRef(onStopped);
  done.current = onStopped;
  // Deterministic first render (the page is pre-rendered); random fillers from the first spin on.
  const fillers = useRef<ReefSymbol[][]>(Array.from({ length: N }, (_, r) => Array.from({ length: FILLER }, (_, i) => ALL[(r * 3 + i) % ALL.length])));

  const landed = useRef<boolean[]>([true, true, true]);
  const timers = useRef<number[]>([]);
  const gridRef = useRef(grid);
  gridRef.current = grid;

  function land(reel: number) {
    const el = inner.current[reel];
    if (!el || landed.current[reel]) return;
    landed.current[reel] = true;
    el.classList.remove(styles.blur);
    el.parentElement?.classList.remove(styles.anticipate);
    const g = gridRef.current;
    const scatter = Array.from({ length: N }, (_, row) => g[row][reel]).includes("chest");
    playSound(scatter ? "pop" : "tick");
    if (landed.current.every(Boolean)) done.current();
  }

  // Spin: every reel scrolls down to its result. Once two bonus symbols have landed, the reels after
  // them spin longer and glow (anticipation).
  useEffect(() => {
    if (spinKey === 0) return;
    fillers.current = Array.from({ length: N }, () => Array.from({ length: FILLER }, rnd));
    const total = FILLER + 2 * N;
    landed.current = [false, false, false];
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
    let scattersBefore = 0;
    let extra = 0;
    inner.current.forEach((el, reel) => {
      if (!el) return;
      if (scattersBefore >= 2) {
        extra += turbo ? 450 : 950;
        el.parentElement?.classList.add(styles.anticipate);
      }
      const dur = (turbo ? 260 : 620) + reel * (turbo ? 70 : 170) + extra;
      el.style.transition = "none";
      el.style.transform = `translateY(-${((FILLER + N) / total) * 100}%)`;
      el.classList.add(styles.blur);
      void el.offsetHeight; // apply the start position before animating
      el.style.transition = `transform ${dur}ms cubic-bezier(0.32, 0.02, 0.25, 1.06)`;
      el.style.transform = "translateY(0)";
      timers.current.push(window.setTimeout(() => land(reel), dur));
      if (Array.from({ length: N }, (_, row) => grid[row][reel]).includes("chest")) scattersBefore++;
    });
    const t = timers.current;
    return () => t.forEach((x) => window.clearTimeout(x));
    // grid is read when the reel lands; it changes together with spinKey
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spinKey]);

  // Quick stop: the reels still turning snap to their results.
  useEffect(() => {
    if (quickStop === 0) return;
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
    inner.current.forEach((el, reel) => {
      if (!el || landed.current[reel]) return;
      const now = getComputedStyle(el).transform;
      el.style.transition = "none";
      el.style.transform = now === "none" ? "translateY(0)" : now;
      void el.offsetHeight;
      el.style.transition = "transform 140ms ease-out";
      el.style.transform = "translateY(0)";
      timers.current.push(window.setTimeout(() => land(reel), 150));
    });
  }, [quickStop]);

  const winCells = new Set<string>();
  for (const w of wins) {
    if (activeLine !== null && w.line !== activeLine) continue;
    LINES[w.line].forEach((row, reel) => winCells.add(`${row}:${reel}`));
  }
  const shownLines = wins.filter((w) => activeLine === null || w.line === activeLine);

  return (
    <div className={styles.window} dir="ltr">
      {[0, 1, 2].map((reel) => (
        <div key={reel} className={styles.reel}>
          <div
            className={styles.reelInner}
            ref={(el) => {
              inner.current[reel] = el;
            }}
          >
            {[
              ...[0, 1, 2].map((row) => ({ s: grid[row][reel], row, final: true })),
              ...fillers.current[reel].map((s) => ({ s, row: -1, final: false })),
              ...[0, 1, 2].map((row) => ({ s: previous[row][reel], row: -1, final: false })),
            ].map((c, i) => {
              const hit = c.final && winCells.has(`${c.row}:${reel}`);
              const scatterHit = c.final && c.s === "chest" && chestHit;
              return (
                <div
                  key={i}
                  className={`${styles.cell} ${hit || scatterHit ? styles.hit : ""} ${c.final && dim && !hit && !scatterHit ? styles.dimmed : ""}`}
                >
                  <ReefSym s={c.s} className={styles.sym} />
                </div>
              );
            })}
          </div>
        </div>
      ))}
      <svg className={styles.lines} viewBox="0 0 300 300" preserveAspectRatio="none" aria-hidden="true">
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

export const LINE_COLORS = ["#ffbe3d", "#7ef0e0", "#ff8fc8", "#c79bff", "#9fdcff"];
