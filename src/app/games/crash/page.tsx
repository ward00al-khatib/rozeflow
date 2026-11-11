"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { DemoFairness } from "@/components/DemoFairness";
import { Shell } from "@/components/Shell";
import { useDemoSession, type DemoRound, type OpenRound } from "@/lib/demo/session";
import {
  CRASH_CONFIG,
  crashPoint,
  multiplierAt,
  settleCrash,
  timeToReach,
  validateCrashBet,
  type CrashBet,
  type CrashOutcome,
} from "@/lib/games/crash";
import { formatPoints } from "@/lib/points";
import { useMember } from "@/lib/useMember";
import styles from "./crash.module.css";

const fmt = (h: number) => (h / 100).toFixed(2) + "×";

interface FlightState {
  startedAt: number; // ms epoch, set by the browser in demo mode (server time in the real game)
}

export default function CrashPage() {
  const member = useMember();
  const demo = useDemoSession();
  const [stakeText, setStakeText] = useState("10");
  const [autoText, setAutoText] = useState("2.00");
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [last, setLast] = useState<DemoRound<CrashBet, CrashOutcome> | null>(null);
  const settling = useRef(false);

  const open = demo.open?.game === "crash" ? (demo.open as OpenRound<CrashBet, FlightState>) : null;
  const flying = open !== null;

  // Crash point of the open round. Demo mode only: on the server it stays secret until the round ends.
  const crash = open ? crashPoint(demo.openSeeds()) : null;
  const elapsed = open ? now - open.state.startedAt : 0;
  const live = open ? Math.min(multiplierAt(elapsed), crash!) : null;

  const finishRound = useCallback(
    (manualAt: number | null) => {
      if (!open || settling.current) return;
      settling.current = true;
      const outcome = settleCrash(open.bet, crashPoint(demo.openSeeds()), manualAt);
      demo.finish(outcome, outcome.gross);
      const { state: _s, ...rest } = open;
      void _s;
      setLast({ ...rest, outcome, gross: outcome.gross });
    },
    [open, demo],
  );

  // Animation clock; settle automatically on auto cash-out or crash.
  useEffect(() => {
    if (!open) {
      settling.current = false;
      return;
    }
    let raf = 0;
    const tick = () => {
      const t = Date.now();
      setNow(t);
      const m = multiplierAt(t - open.state.startedAt);
      if (m >= open.bet.autoCashout || m >= crash!) {
        finishRound(null);
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [open, crash, finishRound]);

  function start() {
    setError(null);
    setLast(null);
    const bet: CrashBet = { stake: Math.round(Number(stakeText) * 100), autoCashout: Math.round(Number(autoText) * 100) };
    try {
      validateCrashBet(bet);
      demo.begin<CrashBet, FlightState>("crash", bet, bet.stake, { startedAt: Date.now() });
    } catch (e) {
      setError(e instanceof Error ? e.message : "تعذّر البدء.");
    }
  }

  function cashOut() {
    if (!open) return;
    finishRound(multiplierAt(Date.now() - open.state.startedAt));
  }

  // Curve: x = time, y = multiplier (smooth, unfloored), scaled to fill the stage.
  const W = 400;
  const H = 220;
  const end = flying ? elapsed : last ? timeToReach(Math.max(101, last.outcome.cashedAt ?? last.outcome.crashPoint)) : 0;
  const peak = Math.exp((CRASH_CONFIG.rules.growth_rate_per_second * end) / 1000);
  const tMax = Math.max(4000, end * 1.1);
  const mMax = Math.max(1.5, 1 + (peak - 1) * 1.15);
  const pts: string[] = [];
  for (let i = 0; i <= 60; i++) {
    const t = (end * i) / 60;
    const m = Math.exp((CRASH_CONFIG.rules.growth_rate_per_second * t) / 1000);
    pts.push(`${((t / tMax) * W).toFixed(1)},${(H - ((m - 1) / (mMax - 1)) * H).toFixed(1)}`);
  }

  const crashed = !flying && last !== null;
  const rounds = demo.rounds.filter((r): r is DemoRound<CrashBet, CrashOutcome> => r.game === "crash");

  return (
    <Shell member={member}>
      <div className={styles.page}>
        <div className={styles.titleRow}>
          <h1 className={styles.title}>كراش</h1>
          <span className={styles.demoBadge}>وضع تجريبي</span>
        </div>
        <p className="muted">
          المضاعف يرتفع حتى ينهار عند نقطة حُدِّدت من البذور قبل الانطلاق. حصّل قبل الانهيار، أو حدّد تحصيلاً تلقائياً. مثلاً فرصة الوصول إلى{" "}
          <span className="num">2×</span> هي <span className="num">49.5%</span>، والعائد النظري لأي هدف <span className="num">99%</span>.
        </p>

        <section className={styles.stage}>
          <svg viewBox={`0 0 ${W} ${H}`} className={styles.svg} preserveAspectRatio="none" aria-hidden="true">
            {end > 0 && (
              <polyline
                points={pts.join(" ")}
                className={`${styles.curve} ${crashed ? (last!.outcome.cashedAt ? styles.curveWin : styles.curveLoss) : ""}`}
              />
            )}
          </svg>
          <div className={styles.overlay} aria-live="polite">
            <span className={`num ${styles.mult} ${crashed && !last!.outcome.cashedAt ? styles.multLoss : ""}`}>
              {flying ? fmt(live!) : last ? fmt(last.outcome.crashPoint) : "1.00×"}
            </span>
            {crashed && (
              <span className={last!.outcome.cashedAt ? styles.win : styles.loss}>
                {last!.outcome.cashedAt ? (
                  <>
                    حصّلت عند <span className="num">{fmt(last!.outcome.cashedAt)}</span> · الصافي{" "}
                    <span className="num">+{formatPoints(last!.gross - last!.stake)}</span>
                  </>
                ) : (
                  <>
                    انهار قبل التحصيل <span className="num">-{formatPoints(last!.stake)}</span>
                  </>
                )}
              </span>
            )}
            {crashed && last!.outcome.cashedAt && <span className="muted">انهار عند {fmt(last!.outcome.crashPoint)}</span>}
            {flying && (
              <span className="muted">
                تحصيل تلقائي عند <span className="num">{fmt(open!.bet.autoCashout)}</span>
              </span>
            )}
          </div>
        </section>

        <section className={styles.controls}>
          {flying ? (
            <button type="button" className={`btn-primary ${styles.wide}`} onClick={cashOut}>
              حصّل الآن <span className="num">{formatPoints(Math.floor((open!.bet.stake * live!) / 100))}</span>
            </button>
          ) : (
            <>
              <div className={styles.row}>
                <div className="field">
                  <label htmlFor="stake">
                    قيمة الدخول (<span className="num">{CRASH_CONFIG.stake_limits.min / 100}</span>–
                    <span className="num">{formatPoints(CRASH_CONFIG.stake_limits.max)}</span>)
                  </label>
                  <input id="stake" className="input num" inputMode="decimal" value={stakeText}
                    onChange={(e) => setStakeText(e.target.value.replace(/[^0-9.]/g, ""))} />
                </div>
                <div className="field">
                  <label htmlFor="auto">تحصيل تلقائي عند (×)</label>
                  <input id="auto" className="input num" inputMode="decimal" value={autoText}
                    onChange={(e) => setAutoText(e.target.value.replace(/[^0-9.]/g, ""))} />
                </div>
              </div>
              <p className="muted">
                فرصة الوصول إلى الهدف:{" "}
                <span className="num">
                  {Number(autoText) >= 1.01 ? ((99 / Number(autoText))).toFixed(2) + "%" : "—"}
                </span>
              </p>
              <button type="button" className={`btn-primary ${styles.wide}`} onClick={start} disabled={!demo.ready}>
                انطلق
              </button>
            </>
          )}
          {error && <p className="error">{error}</p>}
          <div className={styles.balance}>
            <span>الرصيد التجريبي</span>
            <span className="num">{formatPoints(demo.balance)}</span>
            {!flying && (
              <button type="button" className={styles.linkButton} onClick={demo.reset}>
                إعادة إلى <span className="num">1,000</span>
              </button>
            )}
          </div>
        </section>

        {rounds.length > 0 && (
          <section className={styles.controls}>
            <h2 className={styles.h2}>نقاط الانهيار الأخيرة</h2>
            <div className={styles.recent} dir="ltr">
              {rounds.slice(0, 16).map((r) => (
                <span key={`${r.serverSeedHash}:${r.nonce}`} className={`num ${r.outcome.cashedAt ? styles.win : styles.loss}`}>
                  {fmt(r.outcome.crashPoint)}
                </span>
              ))}
            </div>
          </section>
        )}

        <DemoFairness
          demo={demo}
          game="crash"
          verify={(seeds) => `نقطة الانهيار ${fmt(crashPoint(seeds))}`}
        />

        <p className="muted">
          <Link href="/">← كل الألعاب</Link>
        </p>
      </div>
    </Shell>
  );
}
