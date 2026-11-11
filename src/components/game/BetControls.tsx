"use client";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { formatPoints } from "@/lib/points";
import { playSound } from "@/lib/sound";
import styles from "./BetControls.module.css";

/** Stake field with quick buttons. Works in points as text; the page converts to centi-points. */
export function StakeInput({
  value,
  onChange,
  min,
  max,
  balance,
  disabled,
  label = "قيمة الدخول",
  step = 1,
}: {
  value: string;
  onChange: (v: string) => void;
  min: number; // centi-points
  max: number;
  balance: number;
  disabled?: boolean;
  label?: string;
  step?: number; // centi-points the stake must be a multiple of
}) {
  const centi = Math.round(Number(value) * 100) || 0;
  const set = (c: number) => {
    const top = Math.max(min, Math.min(max, balance));
    const v = Math.min(Math.max(Math.floor(c / step) * step, min), top);
    playSound("click");
    onChange(String(v / 100));
  };
  return (
    <div className={styles.stake}>
      <label htmlFor="stake" className={styles.label}>
        {label}
        <span className="num">
          {formatPoints(min)}–{formatPoints(max)}
        </span>
      </label>
      <div className={styles.stakeBox}>
        <input
          id="stake"
          className={`num ${styles.stakeInput}`}
          inputMode="decimal"
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value.replace(/[^0-9.]/g, ""))}
        />
        <button type="button" disabled={disabled} onClick={() => set(Math.floor(centi / 2))}>
          ½
        </button>
        <button type="button" disabled={disabled} onClick={() => set(centi * 2)}>
          <span className="num">2×</span>
        </button>
      </div>
      <div className={styles.chips}>
        {[min, 1000, 5000, 10000, 50000].filter((c, i, a) => c >= min && c <= max && a.indexOf(c) === i).map((c) => (
          <button key={c} type="button" disabled={disabled} className="num" onClick={() => set(c)} aria-pressed={centi === c}>
            {formatPoints(c)}
          </button>
        ))}
        <button type="button" disabled={disabled} onClick={() => set(max)}>
          الأقصى
        </button>
      </div>
    </div>
  );
}

export function ModeTabs({ mode, onChange, disabled }: { mode: "manual" | "auto"; onChange: (m: "manual" | "auto") => void; disabled?: boolean }) {
  return (
    <div className={styles.tabs} role="tablist">
      {(["manual", "auto"] as const).map((m) => (
        <button key={m} type="button" role="tab" aria-selected={mode === m} disabled={disabled} onClick={() => onChange(m)}>
          {m === "manual" ? "يدوي" : "تلقائي"}
        </button>
      ))}
    </div>
  );
}

export function PlayButton({ children, onClick, disabled, variant = "go" }: { children: ReactNode; onClick: () => void; disabled?: boolean; variant?: "go" | "stop" | "cash" }) {
  return (
    <button type="button" className={`${styles.play} ${styles[variant]}`} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  );
}

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
