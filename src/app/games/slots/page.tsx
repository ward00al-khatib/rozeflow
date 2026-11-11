"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { DemoFairness } from "@/components/DemoFairness";
import { Shell } from "@/components/Shell";
import { useDemoSession, type DemoRound } from "@/lib/demo/session";
import { SLOTS_CONFIG, parSheet, playSlots, validateSlotsStake, windowAt, type SlotSymbol, type SlotsOutcome } from "@/lib/games/slots";
import { formatPoints } from "@/lib/points";
import { useMember } from "@/lib/useMember";
import styles from "./slots.module.css";

const NAMES: Record<SlotSymbol, string> = {
  seven: "سبعة",
  bar: "بار",
  bell: "جرس",
  star: "نجمة",
  gem: "جوهرة",
  cherry: "كرز",
};

function Glyph({ s }: { s: SlotSymbol }) {
  switch (s) {
    case "seven":
      return (
        <svg viewBox="0 0 40 40" className={styles.sym} aria-label={NAMES[s]}>
          <text x="20" y="31" textAnchor="middle" fontSize="30" fontWeight="800" fill="var(--signal)" fontFamily="var(--font-mono)">
            7
          </text>
        </svg>
      );
    case "bar":
      return (
        <svg viewBox="0 0 40 40" className={styles.sym} aria-label={NAMES[s]}>
          <rect x="4" y="12" width="32" height="16" rx="3" fill="var(--ink)" />
          <text x="20" y="24.5" textAnchor="middle" fontSize="10" fontWeight="800" fill="var(--paper)" fontFamily="var(--font-mono)">
            BAR
          </text>
        </svg>
      );
    case "bell":
      return (
        <svg viewBox="0 0 40 40" className={styles.sym} aria-label={NAMES[s]}>
          <path d="M20 6c-6 0-9 5-9 11v7l-4 5h26l-4-5v-7c0-6-3-11-9-11z" fill="#e8c35a" />
          <circle cx="20" cy="32" r="3" fill="#e8c35a" />
        </svg>
      );
    case "star":
      return (
        <svg viewBox="0 0 40 40" className={styles.sym} aria-label={NAMES[s]}>
          <path d="M20 5l4.4 9.6 10.4 1.1-7.8 7 2.3 10.3L20 27.7 10.7 33l2.3-10.3-7.8-7 10.4-1.1z" fill="var(--signal-ink)" />
        </svg>
      );
    case "gem":
      return (
        <svg viewBox="0 0 40 40" className={styles.sym} aria-label={NAMES[s]}>
          <path d="M11 8h18l6 9-15 16L5 17z" fill="var(--win)" />
          <path d="M5 17h30M15 8l5 25 5-25" stroke="var(--sheet)" strokeWidth="1.2" fill="none" opacity="0.5" />
        </svg>
      );
    case "cherry":
      return (
        <svg viewBox="0 0 40 40" className={styles.sym} aria-label={NAMES[s]}>
          <path d="M14 26C16 16 22 10 28 7M26 26c0-8-1-14 2-19" stroke="#7fb069" strokeWidth="2" fill="none" />
          <circle cx="13" cy="28" r="6" fill="#c2455d" />
          <circle cx="26" cy="28" r="6" fill="#c2455d" />
        </svg>
      );
  }
}

const LINE_NAMES = ["الوسط", "الأعلى", "الأسفل", "قُطر ↘", "قُطر ↗"];

export default function SlotsPage() {
  const member = useMember();
  const demo = useDemoSession();
  const [stakeText, setStakeText] = useState("10");
  const [error, setError] = useState<string | null>(null);
  const [last, setLast] = useState<DemoRound<{ stake: number }, SlotsOutcome> | null>(null);
  const [spinning, setSpinning] = useState(false);
  const par = useMemo(() => parSheet(), []);

  const grid = last ? last.outcome.window : windowAt([11, 11, 11]);
  const winLines = !spinning && last ? last.outcome.lineWins.map((w) => w.line) : [];
  const winCells = new Set(
    !spinning && last
      ? last.outcome.lineWins.flatMap((w) => SLOTS_CONFIG.rules.lines[w.line].map((row, reel) => `${row}:${reel}`))
      : [],
  );

  function spin() {
    setError(null);
    const stake = Math.round(Number(stakeText) * 100);
    try {
      validateSlotsStake(stake);
      const round = demo.play("slots", { stake }, stake, (seeds) => {
        const outcome = playSlots(seeds, stake);
        return { outcome, gross: outcome.gross };
      });
      setSpinning(true);
      setLast(round);
      window.setTimeout(() => setSpinning(false), 900);
    } catch (e) {
      setError(e instanceof Error ? e.message : "تعذّر اللعب.");
    }
  }

  const rounds = demo.rounds.filter((r): r is DemoRound<{ stake: number }, SlotsOutcome> => r.game === "slots");
  const pays = SLOTS_CONFIG.payout_model.three_of_a_kind as Record<SlotSymbol, number>;

  return (
    <Shell member={member}>
      <div className={styles.page}>
        <div className={styles.titleRow}>
          <h1 className={styles.title}>السلوتس</h1>
          <span className={styles.demoBadge}>وضع تجريبي</span>
        </div>
        <p className="muted">
          ثلاث بكرات وخمسة خطوط تلعب دائماً، وقيمة الدخول تُقسم عليها بالتساوي. العائد النظري{" "}
          <span className="num">{(par.rtp * 100).toFixed(2)}%</span> محسوب بعدّ كل المواضع الممكنة (
          <span className="num">{par.combinations.toLocaleString("en-US")}</span>).
        </p>

        <section className={styles.machine}>
          <div className={styles.reels} dir="ltr">
            {[0, 1, 2].map((reel) => (
              <div key={reel} className={`${styles.reel} ${spinning ? styles.spin : ""}`} style={{ animationDelay: `${reel * 120}ms` }}>
                {[0, 1, 2].map((row) => (
                  <div key={row} className={`${styles.cell} ${winCells.has(`${row}:${reel}`) ? styles.hit : ""}`}>
                    <Glyph s={grid[row][reel]} />
                  </div>
                ))}
              </div>
            ))}
          </div>
          <p className={styles.result} aria-live="polite">
            {spinning || !last ? (
              <span className="muted">{spinning ? "…" : "اضغط «أدِر» للبدء."}</span>
            ) : last.gross > 0 ? (
              <span className={last.gross >= last.stake ? styles.win : styles.loss}>
                {winLines.map((l) => LINE_NAMES[l]).join("، ")} · العائد <span className="num">{formatPoints(last.gross)}</span> · الصافي{" "}
                <span className="num">
                  {last.gross >= last.stake ? "+" : "-"}
                  {formatPoints(Math.abs(last.gross - last.stake))}
                </span>
              </span>
            ) : (
              <span className={styles.loss}>
                لا خط رابح <span className="num">-{formatPoints(last.stake)}</span>
              </span>
            )}
          </p>
        </section>

        <section className={styles.controls}>
          <div className="field">
            <label htmlFor="stake">
              قيمة الدخول (<span className="num">{SLOTS_CONFIG.stake_limits.min / 100}</span>–
              <span className="num">{formatPoints(SLOTS_CONFIG.stake_limits.max)}</span> نقطة، تُقسم على{" "}
              <span className="num">5</span> خطوط)
            </label>
            <input id="stake" className="input num" inputMode="decimal" value={stakeText}
              onChange={(e) => setStakeText(e.target.value.replace(/[^0-9.]/g, ""))} />
          </div>
          <button type="button" className={`btn-primary ${styles.wide}`} onClick={spin} disabled={!demo.ready || spinning}>
            أدِر
          </button>
          {error && <p className="error">{error}</p>}
          <div className={styles.balance}>
            <span>الرصيد التجريبي</span>
            <span className="num">{formatPoints(demo.balance)}</span>
            <button type="button" className={styles.linkButton} onClick={demo.reset}>
              إعادة إلى <span className="num">1,000</span>
            </button>
          </div>
        </section>

        <details className={styles.controls}>
          <summary className={styles.summary}>جدول الدفع وورقة PAR</summary>
          <table className={styles.paytable}>
            <tbody>
              {(Object.keys(pays) as SlotSymbol[]).map((s) => (
                <tr key={s}>
                  <td className={styles.triple}>
                    <Glyph s={s} />
                    <Glyph s={s} />
                    <Glyph s={s} />
                  </td>
                  <td className="num">×{pays[s]}</td>
                  <td className="num muted">{((par.contribution[s] ?? 0) * 100).toFixed(2)}%</td>
                </tr>
              ))}
              <tr>
                <td className={styles.triple}>
                  <Glyph s="cherry" />
                  <Glyph s="cherry" />
                  <span className="muted">أي رمز</span>
                </td>
                <td className="num">×{SLOTS_CONFIG.payout_model.two_cherries_left}</td>
                <td className="num muted">{((par.contribution.two_cherries ?? 0) * 100).toFixed(2)}%</td>
              </tr>
            </tbody>
          </table>
          <p className="muted">
            المضاعف لكل خط من قيمة رهان الخط (الدخول ÷ 5). العمود الأخير: مساهمة كل تركيبة في العائد.
          </p>
          <dl className={styles.par}>
            <div>
              <dt>العائد النظري</dt>
              <dd className="num">{(par.rtp * 100).toFixed(4)}%</dd>
            </div>
            <div>
              <dt>تكرار الفوز</dt>
              <dd className="num">{(par.hitFrequency * 100).toFixed(2)}%</dd>
            </div>
            <div>
              <dt>التذبذب</dt>
              <dd className="num">{par.volatility.toFixed(2)}</dd>
            </div>
            <div>
              <dt>أعلى عائد</dt>
              <dd className="num">{par.maxMultiplier.toFixed(1)}×</dd>
            </div>
          </dl>
        </details>

        {rounds.length > 0 && (
          <section className={styles.controls}>
            <h2 className={styles.h2}>آخر الجولات</h2>
            <div className={styles.recent} dir="ltr">
              {rounds.slice(0, 16).map((r) => (
                <span key={`${r.serverSeedHash}:${r.nonce}`} className={`num ${r.gross >= r.stake ? styles.win : styles.loss}`}>
                  {(r.gross / r.stake).toFixed(1)}×
                </span>
              ))}
            </div>
          </section>
        )}

        <DemoFairness
          demo={demo}
          game="slots"
          verify={(seeds, round) => {
            const o = playSlots(seeds, (round.bet as { stake: number }).stake);
            return `مواضع البكرات ${o.stops.join("، ")} ← العائد ${formatPoints(o.gross)}`;
          }}
        />

        <p className="muted">
          <Link href="/">← كل الألعاب</Link>
        </p>
      </div>
    </Shell>
  );
}
