"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { formatPoints } from "@/lib/points";
import { playSound } from "@/lib/sound";
import { AutoFields, type AutoSettings } from "./BetControls";
import styles from "./ControlBar.module.css";

const STEPS = [100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000, 100000]; // centi-points

export interface PrimaryAction {
  kind: "play" | "cash" | "stop";
  label: string; // accessible name, and the caption under the icon
  sub?: string; // e.g. the cash-out amount
  onClick: () => void;
  disabled?: boolean;
  busy?: boolean; // icon turns while a round plays
}

/**
 * The one control bar every game uses, always in the same order (right to left):
 * balance · result · stake − + · game extra · quick · auto · the big round play button.
 */
export function ControlBar({
  balance,
  status,
  stake,
  onStake,
  min,
  max,
  multipleOf = 1,
  stakeLabel = "الرهان",
  locked,
  extra,
  turbo,
  onTurbo,
  turboUnavailable,
  auto,
  primary,
}: {
  balance: number;
  status: ReactNode;
  stake: number;
  onStake: (centi: number) => void;
  min: number;
  max: number;
  multipleOf?: number;
  stakeLabel?: string;
  locked?: boolean; // stake can't change (round in play)
  extra?: ReactNode;
  turbo: boolean;
  onTurbo: () => void;
  turboUnavailable?: string; // why quick play doesn't apply to this game
  auto: {
    running: boolean;
    left: number;
    net: number;
    onStart: (s: AutoSettings) => void;
    onStop: () => void;
    disabled?: boolean;
    unavailable?: string; // why autoplay doesn't apply to this game
  };
  primary: PrimaryAction;
}) {
  const [autoOpen, setAutoOpen] = useState(false);
  const [stakeOpen, setStakeOpen] = useState(false);
  const [settings, setSettings] = useState<AutoSettings>({ rounds: 25, stopProfit: "", stopLoss: "" });
  const [typed, setTyped] = useState("");
  const [bump, setBump] = useState<"up" | "down" | null>(null);
  const prev = useRef(balance);

  useEffect(() => {
    if (balance === prev.current) return;
    setBump(balance > prev.current ? "up" : "down");
    prev.current = balance;
    const t = window.setTimeout(() => setBump(null), 650);
    return () => window.clearTimeout(t);
  }, [balance]);

  const steps = STEPS.filter((s) => s >= min && s <= max && s % multipleOf === 0);
  const clamp = (c: number) => Math.min(max, Math.max(min, Math.floor(c / multipleOf) * multipleOf));

  function step(dir: 1 | -1) {
    playSound("click");
    const next = dir === 1 ? steps.find((s) => s > stake) : [...steps].reverse().find((s) => s < stake);
    onStake(next ?? (dir === 1 ? max : min));
  }

  return (
    <div className={styles.bar}>
      <div className={`${styles.info} ${styles.balance} ${bump ? styles[bump] : ""}`}>
        <span className={styles.label}>الرصيد التجريبي</span>
        <span className={`num ${styles.value}`}>{formatPoints(balance)}</span>
      </div>

      <div className={styles.status} aria-live="polite">
        {status}
      </div>

      <div className={styles.stake}>
        <button type="button" className={styles.round} onClick={() => step(-1)} disabled={locked || stake <= min} aria-label="خفض الرهان">
          −
        </button>
        <button
          type="button"
          className={`${styles.info} ${styles.stakeValue}`}
          onClick={() => {
            setTyped(String(stake / 100));
            setStakeOpen((o) => !o);
            setAutoOpen(false);
          }}
          disabled={locked}
          aria-label="تحديد الرهان"
        >
          <span className={styles.label}>{stakeLabel}</span>
          <span className={`num ${styles.value}`}>{formatPoints(stake)}</span>
        </button>
        <button type="button" className={styles.round} onClick={() => step(1)} disabled={locked || stake >= max} aria-label="رفع الرهان">
          +
        </button>
        {stakeOpen && !locked && (
          <div className={`${styles.popover} ${styles.stakePop}`}>
            <span className={styles.label}>
              من <span className="num">{formatPoints(min)}</span> إلى <span className="num">{formatPoints(max)}</span>
            </span>
            <input
              className={`num ${styles.input}`}
              inputMode="decimal"
              value={typed}
              autoFocus
              onChange={(e) => setTyped(e.target.value.replace(/[^0-9.]/g, ""))}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  onStake(clamp(Math.round(Number(typed) * 100)));
                  setStakeOpen(false);
                }
              }}
            />
            <div className={styles.chips}>
              <button type="button" onClick={() => onStake(clamp(Math.floor(stake / 2)))}>
                ½
              </button>
              <button type="button" onClick={() => onStake(clamp(stake * 2))}>
                <span className="num">2×</span>
              </button>
              <button type="button" onClick={() => onStake(clamp(Math.min(max, balance)))}>
                الأقصى
              </button>
            </div>
            <div className={styles.chips}>
              {steps.map((s) => (
                <button key={s} type="button" aria-pressed={s === stake} onClick={() => onStake(s)}>
                  <span className="num">{formatPoints(s)}</span>
                </button>
              ))}
            </div>
            <button
              type="button"
              className={styles.go}
              onClick={() => {
                if (typed) onStake(clamp(Math.round(Number(typed) * 100)));
                setStakeOpen(false);
              }}
            >
              تم
            </button>
          </div>
        )}
      </div>

      <div className={styles.actions}>
        {extra}
        <button type="button" className={styles.round} aria-pressed={turbo && !turboUnavailable} onClick={onTurbo} disabled={!!turboUnavailable} aria-label="لعب سريع" title={turboUnavailable ?? "لعب سريع"}>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M13 2L4 14h7l-1 8 9-12h-7z" fill="currentColor" />
          </svg>
        </button>
        <div className={styles.autoWrap}>
          <button
            type="button"
            className={styles.round}
            aria-pressed={auto.running}
            disabled={!!auto.unavailable || (auto.disabled && !auto.running)}
            title={auto.unavailable ?? "لعب تلقائي"}
            aria-label={auto.running ? "إيقاف اللعب التلقائي" : "لعب تلقائي"}
            onClick={() => {
              if (auto.running) auto.onStop();
              else {
                setAutoOpen((o) => !o);
                setStakeOpen(false);
              }
            }}
          >
            {auto.running ? (
              <span className="num">{auto.left > 0 ? auto.left : "∞"}</span>
            ) : (
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M20 12a8 8 0 1 1-2.3-5.6M20 4v5h-5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                <text x="12" y="15.5" textAnchor="middle" fontSize="8" fontWeight="800" fill="currentColor">
                  A
                </text>
              </svg>
            )}
          </button>
          {autoOpen && !auto.running && (
            <div className={`${styles.popover} ${styles.autoPop}`}>
              <AutoFields value={settings} onChange={setSettings} />
              <button
                type="button"
                className={styles.go}
                onClick={() => {
                  setAutoOpen(false);
                  auto.onStart(settings);
                }}
              >
                ابدأ اللعب التلقائي
              </button>
            </div>
          )}
        </div>
        <button
          type="button"
          className={`${styles.primary} ${styles[primary.kind]} ${primary.busy ? styles.busy : ""}`}
          onClick={primary.onClick}
          disabled={primary.disabled}
          aria-label={primary.label}
        >
          {primary.kind === "stop" ? (
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <rect x="7" y="7" width="10" height="10" rx="2" fill="currentColor" />
            </svg>
          ) : primary.kind === "cash" ? (
            <span className={styles.cashText}>
              <span>{primary.label}</span>
              {primary.sub && <span className="num">{primary.sub}</span>}
            </span>
          ) : (
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M19 12a7 7 0 1 1-2-4.9" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" />
              <path d="M19 4v4.5h-4.5" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
        </button>
      </div>
      {auto.running && (
        <span className={styles.autoNet}>
          تلقائي · الصافي{" "}
          <span className={`num ${auto.net >= 0 ? styles.pos : ""}`}>
            {auto.net >= 0 ? "+" : "-"}
            {formatPoints(Math.abs(auto.net))}
          </span>
        </span>
      )}
    </div>
  );
}

/** Standard result text for the bar's middle slot. */
export function BarStatus({ win, hint, label = "الربح" }: { win?: number | null; hint?: ReactNode; label?: string }) {
  if (win != null && win > 0)
    return (
      <>
        <span className={styles.label}>{label}</span>
        <span className={`num ${styles.win}`}>{formatPoints(win)}</span>
      </>
    );
  return <span className={styles.hint}>{hint}</span>;
}
