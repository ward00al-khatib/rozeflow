"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { DemoFairness } from "@/components/DemoFairness";
import { Shell } from "@/components/Shell";
import { useDemoSession, type DemoRound } from "@/lib/demo/session";
import {
  PLINKO_CONFIG,
  PLINKO_SCALE,
  playPlinko,
  plinkoTable,
  validatePlinkoBet,
  type PlinkoBet,
  type PlinkoOutcome,
  type PlinkoRisk,
  type PlinkoRows,
} from "@/lib/games/plinko";
import { formatPoints } from "@/lib/points";
import { useMember } from "@/lib/useMember";
import styles from "./plinko.module.css";

const RISK_LABEL: Record<PlinkoRisk, string> = { low: "منخفضة", medium: "متوسطة", high: "عالية" };
const STEP_MS = 90;

/** Short label for a slot (fits 17 slots on a phone): whole numbers from 10x, one decimal from 1x, ".03" style below 1x. Full value in the tooltip. */
function shortMult(m: number) {
  const x = m / PLINKO_SCALE;
  if (x >= 10) return String(Math.floor(x));
  if (x >= 1) return (Math.floor(x * 10) / 10).toString();
  return (Math.floor(x * 100) / 100).toFixed(2).slice(1); // ".03"
}

function slotTone(m: number) {
  if (m >= 3 * PLINKO_SCALE) return styles.hot;
  if (m >= PLINKO_SCALE) return styles.warm;
  return styles.cold;
}

export default function PlinkoPage() {
  const member = useMember();
  const demo = useDemoSession();
  const [rows, setRows] = useState<PlinkoRows>(12);
  const [risk, setRisk] = useState<PlinkoRisk>("medium");
  const [stakeText, setStakeText] = useState("10");
  const [error, setError] = useState<string | null>(null);
  const [drop, setDrop] = useState<{ round: DemoRound<PlinkoBet, PlinkoOutcome>; step: number } | null>(null);
  const timer = useRef<number | null>(null);

  useEffect(() => () => {
    if (timer.current) window.clearInterval(timer.current);
  }, []);

  const table = plinkoTable(risk, rows);
  const stake = Math.round(Number(stakeText) * 100);
  const dropping = drop !== null && drop.step < drop.round.bet.rows;

  function play() {
    setError(null);
    const bet: PlinkoBet = { stake, rows, risk };
    try {
      validatePlinkoBet(bet);
      const round = demo.play("plinko", bet, stake, (seeds) => {
        const outcome = playPlinko(seeds, bet);
        return { outcome, gross: outcome.gross };
      });
      setDrop({ round, step: 0 });
      if (timer.current) window.clearInterval(timer.current);
      const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (reduced) {
        setDrop({ round, step: bet.rows });
        return;
      }
      timer.current = window.setInterval(() => {
        setDrop((d) => {
          if (!d) return d;
          if (d.step >= d.round.bet.rows) {
            window.clearInterval(timer.current!);
            return d;
          }
          return { ...d, step: d.step + 1 };
        });
      }, STEP_MS);
    } catch (e) {
      setError(e instanceof Error ? e.message : "تعذّر اللعب.");
    }
  }

  // Board geometry (SVG units). Row i has i + 3 pegs; slots sit under the last row.
  const shownRows = drop && dropping ? drop.round.bet.rows : rows;
  const shownTable = drop && dropping ? plinkoTable(drop.round.bet.risk, drop.round.bet.rows) : table;
  const W = 400;
  const gap = W / (shownRows + 2);
  const rowH = 300 / (shownRows + 1);
  const pegX = (row: number, j: number) => W / 2 + (j - (row + 2) / 2) * gap;
  const pegY = (row: number) => 24 + row * rowH;

  let ball: { x: number; y: number } | null = null;
  if (drop) {
    const { path } = drop.round.outcome;
    const rights = path.slice(0, drop.step).reduce((a, b) => a + b, 0);
    // after `step` bounces the ball sits between pegs of row `step`
    ball = { x: W / 2 + (rights - drop.step / 2) * gap, y: pegY(drop.step) - rowH / 2 };
  }
  const landed = drop && !dropping ? drop.round : null;

  const rounds = demo.rounds.filter((r): r is DemoRound<PlinkoBet, PlinkoOutcome> => r.game === "plinko");

  return (
    <Shell member={member}>
      <div className={styles.page}>
        <div className={styles.titleRow}>
          <h1 className={styles.title}>بلينكو</h1>
          <span className={styles.demoBadge}>وضع تجريبي</span>
        </div>
        <p className="muted">
          ترتد الكرة يميناً أو يساراً عند كل صف باحتمال متساوٍ، والخانة التي تستقر فيها تحدد المضاعف. كل جدول عائده النظري{" "}
          <span className="num">99%</span>.
        </p>

        <section className={styles.board}>
          <svg viewBox={`0 0 ${W} 330`} className={styles.svg} role="img" aria-label="لوحة بلينكو">
            {Array.from({ length: shownRows }, (_, row) =>
              Array.from({ length: row + 3 }, (_, j) => (
                <circle key={`${row}-${j}`} cx={pegX(row, j)} cy={pegY(row)} r={Math.max(2, gap / 9)} className={styles.peg} />
              )),
            )}
            {ball && <circle cx={ball.x} cy={ball.y} r={Math.max(5, gap / 4)} className={styles.ball} />}
          </svg>
          <div className={styles.slots} dir="ltr" style={{
              gridTemplateColumns: `repeat(${shownRows + 1}, 1fr)`,
              width: `${((shownRows + 1) / (shownRows + 2)) * 100}%`,
            }}>
            {shownTable.map((m, k) => (
              <span
                key={k}
                title={`${(m / PLINKO_SCALE).toFixed(4)}×`}
                className={`num ${styles.slot} ${slotTone(m)} ${landed && landed.outcome.slot === k ? styles.landed : ""}`}
              >
                {shortMult(m)}
              </span>
            ))}
          </div>
          <p className={styles.resultLine} aria-live="polite">
            {landed ? (
              <span className={landed.gross >= landed.stake ? styles.win : styles.loss}>
                <span className="num">{(landed.outcome.multiplier / PLINKO_SCALE).toFixed(4).replace(/0+$/, "").replace(/\.$/, "")}×</span> · العائد{" "}
                <span className="num">{formatPoints(landed.gross)}</span> · الصافي{" "}
                <span className="num">
                  {landed.gross >= landed.stake ? "+" : "-"}
                  {formatPoints(Math.abs(landed.gross - landed.stake))}
                </span>
              </span>
            ) : (
              <span className="muted">اختر الصفوف والمخاطرة، ثم ابدأ.</span>
            )}
          </p>
        </section>

        <section className={styles.controls}>
          <div className={styles.selectRow}>
            <div className="field">
              <label>الصفوف</label>
              <div className={styles.toggle} role="radiogroup">
                {(PLINKO_CONFIG.rules.rows as PlinkoRows[]).map((n) => (
                  <button key={n} type="button" role="radio" aria-checked={rows === n} disabled={dropping} onClick={() => setRows(n)}>
                    <span className="num">{n}</span>
                  </button>
                ))}
              </div>
            </div>
            <div className="field">
              <label>المخاطرة</label>
              <div className={styles.toggle} role="radiogroup">
                {(PLINKO_CONFIG.rules.risks as PlinkoRisk[]).map((r) => (
                  <button key={r} type="button" role="radio" aria-checked={risk === r} disabled={dropping} onClick={() => setRisk(r)}>
                    {RISK_LABEL[r]}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="field">
            <label htmlFor="stake">
              قيمة الدخول (من <span className="num">{PLINKO_CONFIG.stake_limits.min / 100}</span> إلى{" "}
              <span className="num">{formatPoints(PLINKO_CONFIG.stake_limits.max)}</span> نقطة)
            </label>
            <input
              id="stake"
              className="input num"
              inputMode="decimal"
              value={stakeText}
              onChange={(e) => setStakeText(e.target.value.replace(/[^0-9.]/g, ""))}
            />
          </div>

          <button type="button" className={`btn-primary ${styles.dropButton}`} onClick={play} disabled={!demo.ready || dropping}>
            أسقط الكرة
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

        {rounds.length > 0 && (
          <section className={styles.controls}>
            <h2 className={styles.h2}>آخر الجولات</h2>
            <div className={styles.recent} dir="ltr">
              {rounds.slice(0, 16).map((r) => (
                <span key={`${r.serverSeedHash}:${r.nonce}`} className={`num ${slotTone(r.outcome.multiplier)}`}>
                  {shortMult(r.outcome.multiplier)}×
                </span>
              ))}
            </div>
          </section>
        )}

        <DemoFairness
          demo={demo}
          game="plinko"
          verify={(seeds, round) => {
            const o = playPlinko(seeds, round.bet as PlinkoBet);
            return `المسار ${o.path.map((x) => (x ? "يمين" : "يسار")).join("، ")} ← الخانة ${o.slot}`;
          }}
        />

        <p className="muted">
          <Link href="/">← كل الألعاب</Link>
        </p>
      </div>
    </Shell>
  );
}
