"use client";
import { useEffect, useRef, useState } from "react";
import { BOLT_LINES as LINES, BOLT_PAY_SYMBOLS, BOLT_REELS, BOLT_ROWS, type BoltSymbol } from "@/lib/games/bolt";
import { boltSfx } from "./sfx";
import { BoltSym } from "./symbols";
import styles from "./bolt.module.css";

const FILLER = 14;
const ALL: BoltSymbol[] = [...BOLT_PAY_SYMBOLS, "bot", "core"];
const rnd = () => ALL[Math.floor(Math.random() * ALL.length)];
const REELS = Array.from({ length: BOLT_REELS }, (_, i) => i);
const ROWS = Array.from({ length: BOLT_ROWS }, (_, i) => i);

export const LINE_COLORS = ["#ffbe3d", "#3ddcff", "#ff8fc8", "#a7ffd6", "#c79bff", "#ff8a3d", "#9fdcff", "#ffe89a", "#7ef0e0", "#ff9a8a"];

/**
 * Five reels in a 5×3 window. When `spinKey` changes, each reel scrolls from the previous symbols
 * through a blurred filler strip down to the new ones, stopping left to right with a clunk. Robots
 * throw sparks as they land, cores hum, and after two cores the later reels glow and spin longer.
 * `onStopped` fires once every reel has landed.
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
  coreHit,
  charging,
}: {
  window: BoltSymbol[][]; // [row][reel]
  previous: BoltSymbol[][];
  spinKey: number;
  quickStop: number; // bump to land the turning reels at once
  turbo: boolean;
  onStopped: () => void;
  wins: { line: number }[];
  activeLine: number | null;
  dim: boolean;
  coreHit: boolean; // cores light up (they start or feed the bonus)
  charging: boolean; // robots on screen charge the battery (free spins)
}) {
  const inner = useRef<(HTMLDivElement | null)[]>([]);
  const done = useRef(onStopped);
  done.current = onStopped;
  // Deterministic first render (the page is pre-rendered); random fillers from the first spin on.
  const fillers = useRef<BoltSymbol[][]>(REELS.map((r) => Array.from({ length: FILLER }, (_, i) => ALL[(r * 3 + i) % ALL.length])));
  const landed = useRef<boolean[]>(REELS.map(() => true));
  const [landedReels, setLandedReels] = useState<number>(BOLT_REELS); // how many reels have landed (for sparks)
  const timers = useRef<number[]>([]);
  const gridRef = useRef(grid);
  gridRef.current = grid;
  const coresSoFar = useRef(0);

  function land(reel: number) {
    const el = inner.current[reel];
    if (!el || landed.current[reel]) return;
    landed.current[reel] = true;
    el.classList.remove(styles.blur);
    el.parentElement?.classList.remove(styles.anticipate);
    el.parentElement?.classList.add(styles.thud);
    timers.current.push(window.setTimeout(() => el.parentElement?.classList.remove(styles.thud), 260));
    const col = ROWS.map((row) => gridRef.current[row][reel]);
    if (col.includes("core")) boltSfx("core", coresSoFar.current++);
    else if (col.includes("bot")) boltSfx("wild");
    else boltSfx("stop");
    setLandedReels(landed.current.filter(Boolean).length);
    if (landed.current.every(Boolean)) done.current();
  }

  useEffect(() => {
    if (spinKey === 0) return;
    fillers.current = REELS.map(() => Array.from({ length: FILLER }, rnd));
    const total = FILLER + 2 * BOLT_ROWS;
    landed.current = REELS.map(() => false);
    setLandedReels(0);
    coresSoFar.current = 0;
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
    boltSfx("spin");
    let coresBefore = 0;
    let extra = 0;
    inner.current.forEach((el, reel) => {
      if (!el) return;
      if (coresBefore >= 2) {
        extra += turbo ? 450 : 1000;
        el.parentElement?.classList.add(styles.anticipate);
      }
      const dur = (turbo ? 260 : 600) + reel * (turbo ? 60 : 150) + extra;
      el.style.transition = "none";
      el.style.transform = `translateY(-${((FILLER + BOLT_ROWS) / total) * 100}%)`;
      el.classList.add(styles.blur);
      void el.offsetHeight; // apply the start position before animating
      el.style.transition = `transform ${dur}ms cubic-bezier(0.32, 0.02, 0.25, 1.06)`;
      el.style.transform = "translateY(0)";
      timers.current.push(window.setTimeout(() => land(reel), dur));
      if (ROWS.map((row) => grid[row][reel]).includes("core")) coresBefore++;
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
      timers.current.push(window.setTimeout(() => land(reel), 150 + reel * 30));
    });
  }, [quickStop]);

  const winCells = new Set<string>();
  const shownLines = wins.filter((w) => activeLine === null || w.line === activeLine);
  for (const w of shownLines) LINES[w.line].forEach((row, reel) => winCells.add(`${row}:${reel}`));

  return (
    <div className={styles.window} dir="ltr">
      {REELS.map((reel) => (
        <div key={reel} className={styles.reel}>
          <div
            className={styles.reelInner}
            ref={(el) => {
              inner.current[reel] = el;
            }}
          >
            {[
              ...ROWS.map((row) => ({ s: grid[row][reel], row, final: true })),
              ...fillers.current[reel].map((s) => ({ s, row: -1, final: false })),
              ...ROWS.map((row) => ({ s: previous[row][reel], row: -1, final: false })),
            ].map((c, i) => {
              const hit = c.final && winCells.has(`${c.row}:${reel}`);
              const coreLit = c.final && c.s === "core" && coreHit;
              const spark = c.final && c.s === "bot" && reel < landedReels;
              return (
                <div
                  key={i}
                  className={`${styles.cell} ${hit || coreLit ? styles.hit : ""} ${c.final && dim && !hit && !coreLit ? styles.dimmed : ""} ${spark ? styles.sparkCell : ""} ${spark && charging ? styles.chargeCell : ""}`}
                >
                  <BoltSym s={c.s} className={styles.sym} />
                  {spark && (
                    <span className={styles.sparks} aria-hidden="true">
                      {Array.from({ length: 8 }, (_, k) => (
                        <i key={k} style={{ rotate: `${k * 45}deg` }} />
                      ))}
                    </span>
                  )}
                  {spark && charging && <span className={styles.chargeTag}>⚡+1</span>}
                </div>
              );
            })}
          </div>
        </div>
      ))}
      <svg className={styles.lines} viewBox={`0 0 ${BOLT_REELS * 100} ${BOLT_ROWS * 100}`} preserveAspectRatio="none" aria-hidden="true">
        {shownLines.map((w) => {
          const pts = LINES[w.line].map((row, reel) => `${reel * 100 + 50},${row * 100 + 50}`).join(" ");
          const color = LINE_COLORS[w.line % LINE_COLORS.length];
          return (
            <g key={w.line}>
              <polyline className={styles.line} points={pts} style={{ stroke: color }} />
              <polyline className={styles.arc} points={pts} />
            </g>
          );
        })}
      </svg>
    </div>
  );
}
