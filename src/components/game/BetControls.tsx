"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import styles from "./BetControls.module.css";

export interface AutoSettings {
  rounds: number; // 0 = until stopped
  stopProfit: string; // points, "" = off
  stopLoss: string;
}

export function AutoFields({ value, onChange, disabled }: { value: AutoSettings; onChange: (v: AutoSettings) => void; disabled?: boolean }) {
  return (
    <div className={styles.auto}>
      <span className={styles.label}>عدد الجولات</span>
      <div className={styles.chips}>
        {[10, 25, 50, 100, 0].map((n) => (
          <button key={n} type="button" disabled={disabled} aria-pressed={value.rounds === n} onClick={() => onChange({ ...value, rounds: n })}>
            {n === 0 ? "∞" : <span className="num">{n}</span>}
          </button>
        ))}
      </div>
      <div className={styles.pair}>
        <label>
          <span className={styles.label}>توقف عند ربح</span>
          <input className={`num ${styles.small}`} inputMode="decimal" placeholder="—" disabled={disabled} value={value.stopProfit}
            onChange={(e) => onChange({ ...value, stopProfit: e.target.value.replace(/[^0-9.]/g, "") })} />
        </label>
        <label>
          <span className={styles.label}>توقف عند خسارة</span>
          <input className={`num ${styles.small}`} inputMode="decimal" placeholder="—" disabled={disabled} value={value.stopLoss}
            onChange={(e) => onChange({ ...value, stopLoss: e.target.value.replace(/[^0-9.]/g, "") })} />
        </label>
      </div>
    </div>
  );
}

/**
 * Plays rounds one after another. `playOnce` plays a round and returns its net (centi-points), or
 * null when it could not play (the run stops). `busy` is true while the round animates.
 */
export function useAutoPlay(playOnce: () => number | null, busy: boolean, gapMs = 350) {
  const [running, setRunning] = useState(false);
  const [left, setLeft] = useState(0); // -1 = until stopped
  const [net, setNet] = useState(0);
  const limits = useRef({ profit: 0, loss: 0 });
  const fn = useRef(playOnce);
  fn.current = playOnce;

  const stop = useCallback(() => setRunning(false), []);

  const start = useCallback((s: AutoSettings) => {
    limits.current = { profit: Math.round(Number(s.stopProfit) * 100) || 0, loss: Math.round(Number(s.stopLoss) * 100) || 0 };
    setNet(0);
    setLeft(s.rounds === 0 ? -1 : s.rounds);
    setRunning(true);
  }, []);

  useEffect(() => {
    if (!running || busy) return;
    if (left === 0) {
      setRunning(false);
      return;
    }
    const t = window.setTimeout(() => {
      const r = fn.current();
      if (r === null) {
        setRunning(false);
        return;
      }
      setLeft((l) => (l > 0 ? l - 1 : l));
      setNet((n) => {
        const total = n + r;
        const { profit, loss } = limits.current;
        if ((profit > 0 && total >= profit) || (loss > 0 && -total >= loss)) setRunning(false);
        return total;
      });
    }, gapMs);
    return () => window.clearTimeout(t);
  }, [running, busy, left, gapMs]);

  return { running, left, net, start, stop };
}

/** Space bar plays (desktop), unless the player is typing in a field. */
export function useSpaceKey(action: () => void, enabled: boolean) {
  const fn = useRef(action);
  fn.current = action;
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== "Space" || e.repeat) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "SELECT" || t.tagName === "TEXTAREA" || t.tagName === "BUTTON")) return;
      e.preventDefault();
      fn.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled]);
}
