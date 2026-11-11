"use client";
import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { formatPoints } from "@/lib/points";
import { useSound } from "@/lib/sound";
import styles from "./GameFrame.module.css";

/**
 * Full-screen game layout shared by all six games: top bar (back, name, balance, sound, rules),
 * a stage for the game itself, and the bet panel (beside the stage on wide screens, under it on phones).
 */
export function GameFrame({
  title,
  balance,
  onReset,
  resetDisabled,
  rules,
  stage,
  panel,
  below,
}: {
  title: string;
  balance: number;
  onReset: () => void;
  resetDisabled?: boolean;
  rules: ReactNode;
  stage: ReactNode;
  panel: ReactNode;
  below?: ReactNode;
}) {
  const sound = useSound();
  const [showRules, setShowRules] = useState(false);
  const [bump, setBump] = useState<"up" | "down" | null>(null);
  const prev = useRef(balance);

  useEffect(() => {
    if (balance === prev.current) return;
    setBump(balance > prev.current ? "up" : "down");
    prev.current = balance;
    const t = window.setTimeout(() => setBump(null), 600);
    return () => window.clearTimeout(t);
  }, [balance]);

  return (
    <div className={styles.frame}>
      <header className={styles.bar}>
        <Link href="/" className={styles.back} aria-label="كل الألعاب">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M9 5l7 7-7 7" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </Link>
        <div className={styles.name}>
          <span className={styles.brand} dir="ltr">
            ROZE<span>FLOW</span>
          </span>
          <h1>{title}</h1>
        </div>
        <div className={styles.tools}>
          <div className={`${styles.wallet} ${bump ? styles[bump] : ""}`} title="الرصيد التجريبي">
            <span className={styles.walletLabel}>تجريبي</span>
            <span className="num">{formatPoints(balance)}</span>
          </div>
          <button type="button" className={styles.icon} onClick={sound.toggle} aria-pressed={sound.on} aria-label={sound.on ? "كتم الصوت" : "تشغيل الصوت"}>
            {sound.on ? (
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor" />
                <path d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor" />
                <path d="M16 9l5 6M21 9l-5 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
            )}
          </button>
          <button type="button" className={styles.icon} onClick={() => setShowRules(true)} aria-label="القواعد">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="1.8" />
              <path d="M12 11v6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              <circle cx="12" cy="7.6" r="1.3" fill="currentColor" />
            </svg>
          </button>
        </div>
      </header>

      <div className={styles.body}>
        <section className={styles.stage}>{stage}</section>
        <aside className={styles.panel}>{panel}</aside>
      </div>

      <div className={styles.below}>
        {below}
        <div className={styles.footer}>
          <span>النقاط هنا تجريبية وتبقى في متصفحك، والرصيد الحقيقي لا يتأثر.</span>
          <button type="button" className={styles.linkButton} onClick={onReset} disabled={resetDisabled}>
            إعادة الرصيد إلى <span className="num">1,000</span>
          </button>
        </div>
      </div>

      {showRules && (
        <div className={styles.sheetBackdrop} onClick={() => setShowRules(false)}>
          <div className={styles.sheet} role="dialog" aria-modal="true" aria-label={`قواعد ${title}`} onClick={(e) => e.stopPropagation()}>
            <div className={styles.sheetHead}>
              <h2>قواعد {title}</h2>
              <button type="button" className={styles.icon} onClick={() => setShowRules(false)} aria-label="إغلاق">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
              </button>
            </div>
            <div className={styles.sheetBody}>{rules}</div>
          </div>
        </div>
      )}
    </div>
  );
}

/** Recent results as a strip of chips at the top of the stage, newest first. */
export function ResultStrip({ items }: { items: { key: string; label: string; tone: "win" | "loss" | "big" }[] }) {
  return (
    <div className={styles.strip} dir="ltr" aria-label="آخر النتائج">
      {items.map((it, i) => (
        <span key={it.key} className={`num ${styles.chip} ${styles[it.tone]} ${i === 0 ? styles.fresh : ""}`}>
          {it.label}
        </span>
      ))}
    </div>
  );
}
