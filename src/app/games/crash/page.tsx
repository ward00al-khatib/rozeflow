"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DemoFairness } from "@/components/DemoFairness";
import { useAutoPlay, useSpaceKey } from "@/components/game/BetControls";
import { BarStatus, ControlBar, type PrimaryAction } from "@/components/game/ControlBar";
import { GameFrame, ResultStrip } from "@/components/game/GameFrame";
import { WinBanner } from "@/components/game/WinBanner";
import ui from "@/components/game/stage.module.css";
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
import { playSound } from "@/lib/sound";
import { resultTone } from "@/lib/winTier";
import styles from "./crash.module.css";

const fmt = (h: number) => (h / 100).toFixed(2) + "×";
const TARGETS = [150, 200, 300, 500, 1000];

interface FlightState {
  startedAt: number; // ms epoch, set by the browser in demo mode (server time in the real game)
}

type Round = DemoRound<CrashBet, CrashOutcome>;

export default function CrashPage() {
  const demo = useDemoSession();
  const [stake, setStake] = useState(1000);
  const [autoText, setAutoText] = useState("2.00");
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [last, setLast] = useState<Round | null>(null);
  const settling = useRef(false);
  const lastTick = useRef(0);

  const { min, max } = CRASH_CONFIG.stake_limits;
  const autoLimits = CRASH_CONFIG.rules.auto_cashout;
  const autoCashout = Math.round(Number(autoText) * 100);
  const autoValid = Number.isInteger(autoCashout) && autoCashout >= autoLimits.min && autoCashout <= autoLimits.max;

  const open = demo.open?.game === "crash" ? (demo.open as OpenRound<CrashBet, FlightState>) : null;
  const flying = open !== null;

  // Crash point of the open round. Demo mode only: on the server it stays secret until the round ends.
  const crash = open ? crashPoint(demo.openSeeds()) : null;
  const elapsed = open ? Math.max(0, now - open.state.startedAt) : 0;
  const live = open ? Math.min(multiplierAt(elapsed), crash!) : null;

  const finishRound = useCallback(
    (manualAt: number | null) => {
      if (!open || settling.current) return;
      settling.current = true;
      const outcome = settleCrash(open.bet, crashPoint(demo.openSeeds()), manualAt);
      demo.finish(outcome, outcome.gross);
      playSound(outcome.cashedAt ? "cashout" : "lose");
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
      // A tick every tenth of a multiplier keeps the climb audible without flooding.
      if (Math.floor(m / 10) !== lastTick.current) {
        lastTick.current = Math.floor(m / 10);
        playSound("tick");
      }
      if (m >= open.bet.autoCashout || m >= crash!) {
        finishRound(null);
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [open, crash, finishRound]);

  /** Starts a flight. Returns its net for autoplay (no manual cash-out during autoplay), or null. */
  function start(): number | null {
    setError(null);
    const bet: CrashBet = { stake, autoCashout };
    try {
      validateCrashBet(bet);
      const net = settleCrash(bet, crashPoint(demo.nextSeeds()), null).gross - stake;
      demo.begin<CrashBet, FlightState>("crash", bet, bet.stake, { startedAt: Date.now() });
      lastTick.current = 10;
      playSound("start");
      return net;
    } catch (e) {
      setError(e instanceof Error ? e.message : "تعذّر البدء.");
      return null;
    }
  }

  function cashOut() {
    if (!open) return;
    finishRound(multiplierAt(Date.now() - open.state.startedAt));
  }

  const autoplay = useAutoPlay(start, flying, 900);
  const locked = flying || autoplay.running;

  const primary: PrimaryAction = autoplay.running
    ? { kind: "stop", label: "إيقاف", onClick: autoplay.stop }
    : flying
      ? { kind: "cash", label: "حصّل", sub: formatPoints(Math.floor((open!.bet.stake * live!) / 100)), onClick: cashOut }
      : { kind: "play", label: "انطلق", onClick: () => start(), disabled: !demo.ready || !autoValid };
  useSpaceKey(() => !primary.disabled && primary.onClick(), true);

  // Curve: x = time, y = multiplier (smooth, unfloored), scaled to fill the stage.
  const W = 400;
  const H = 220;
  const end = flying ? elapsed : last ? timeToReach(Math.max(101, last.outcome.cashedAt ?? last.outcome.crashPoint)) : 0;
  const peak = Math.exp((CRASH_CONFIG.rules.growth_rate_per_second * end) / 1000);
  const tMax = Math.max(4000, end * 1.1);
  const mMax = Math.max(1.5, 1 + (peak - 1) * 1.15);
  const pts: [number, number][] = [];
  for (let i = 0; i <= 60; i++) {
    const t = (end * i) / 60;
    const m = Math.exp((CRASH_CONFIG.rules.growth_rate_per_second * t) / 1000);
    pts.push([(t / tMax) * W, H - ((m - 1) / (mMax - 1)) * H]);
  }
  const line = pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const head = pts[pts.length - 1];

  const crashed = !flying && last !== null;
  const won = crashed && last!.outcome.cashedAt !== null;
  const rounds = useMemo(() => demo.rounds.filter((r): r is Round => r.game === "crash"), [demo.rounds]);

  const stage = (
    <>
      <ResultStrip
        items={rounds.slice(0, 14).map((r) => ({
          key: `${r.serverSeedHash}:${r.nonce}`,
          label: fmt(r.outcome.crashPoint),
          tone: resultTone(r.gross, r.stake),
        }))}
      />
      <WinBanner id={last ? `${last.serverSeedHash}:${last.nonce}` : null} gross={last?.gross ?? 0} stake={last?.stake ?? 1} />

      <div className={`${styles.sky} ${crashed && !won ? styles.boom : ""}`}>
        <svg viewBox={`0 0 ${W} ${H}`} className={styles.svg} preserveAspectRatio="none" aria-hidden="true">
          {end > 0 && (
            <>
              <polygon points={`0,${H} ${line} ${head[0].toFixed(1)},${H}`} className={`${styles.area} ${crashed ? (won ? styles.areaWin : styles.areaLoss) : ""}`} />
              <polyline points={line} className={`${styles.curve} ${crashed ? (won ? styles.curveWin : styles.curveLoss) : ""}`} />
            </>
          )}
        </svg>
        {end > 0 && (
          <span
            className={`${styles.head} ${crashed ? (won ? styles.headWin : styles.headLoss) : ""}`}
            style={{ left: `calc(16px + (100% - 32px) * ${(head[0] / W).toFixed(4)})`, top: `calc(16px + (100% - 28px) * ${(head[1] / H).toFixed(4)})` }}
          />
        )}
        <div className={styles.overlay} aria-live="polite">
          <span className={`num ${styles.mult} ${crashed && !won ? styles.multLoss : ""} ${won ? styles.multWin : ""}`}>
            {flying ? fmt(live!) : last ? fmt(last.outcome.crashPoint) : "1.00×"}
          </span>
          {flying && (
            <span className="muted">
              تحصيل تلقائي عند <span className="num">{fmt(open!.bet.autoCashout)}</span>
            </span>
          )}
          {crashed &&
            (won ? (
              <span className={ui.win}>
                حصّلت عند <span className="num">{fmt(last!.outcome.cashedAt!)}</span>
              </span>
            ) : (
              <span className={ui.loss}>انهار قبل التحصيل</span>
            ))}
        </div>
      </div>

      <div className={ui.options}>
        <div className={ui.group}>
          <span className={ui.groupLabel}>تحصيل تلقائي</span>
          <label className={ui.field}>
            <input
              className="num"
              inputMode="decimal"
              value={autoText}
              disabled={locked}
              aria-label="تحصيل تلقائي عند"
              onFocus={(e) => e.target.select()}
              onChange={(e) => setAutoText(e.target.value.replace(/[^0-9.]/g, ""))}
              onBlur={() => autoValid && setAutoText((autoCashout / 100).toFixed(2))}
            />
            <i>×</i>
          </label>
          <div className={ui.seg} role="radiogroup" aria-label="أهداف سريعة">
            {TARGETS.map((t) => (
              <button
                key={t}
                type="button"
                role="radio"
                aria-checked={autoCashout === t}
                disabled={locked}
                onClick={() => {
                  playSound("click");
                  setAutoText((t / 100).toFixed(2));
                }}
              >
                <span className="num">{t / 100}×</span>
              </button>
            ))}
          </div>
        </div>
        <div className={ui.group}>
          <span className={ui.groupLabel}>فرصة الوصول</span>
          <span className="num">{autoValid ? (9900 / autoCashout).toFixed(2) + "%" : "—"}</span>
        </div>
      </div>
    </>
  );

  const panel = (
    <ControlBar
      balance={demo.balance}
      status={
        error ? (
          <span className="error">{error}</span>
        ) : flying ? (
          <BarStatus win={Math.floor((open!.bet.stake * live!) / 100)} label="قيمة التحصيل" />
        ) : (
          <BarStatus
            win={won ? last!.gross : null}
            hint={
              autoValid ? (
                <>
                  العائد عند الهدف <span className="num">{formatPoints(Math.floor((stake * autoCashout) / 100))}</span>
                </>
              ) : (
                "حدّد هدف التحصيل"
              )
            }
          />
        )
      }
      stake={open?.bet.stake ?? stake}
      onStake={setStake}
      min={min}
      max={max}
      locked={locked}
      turbo={false}
      onTurbo={() => {}}
      turboUnavailable="اللعب السريع لا ينطبق على كراش لأن الوقت جزء من اللعبة"
      auto={{
        running: autoplay.running,
        left: autoplay.left,
        net: autoplay.net,
        onStart: autoplay.start,
        onStop: autoplay.stop,
        disabled: !demo.ready || flying || !autoValid,
      }}
      primary={primary}
    />
  );

  return (
    <GameFrame
      title="كراش"
      onReset={demo.reset}
      resetDisabled={locked}
      stage={stage}
      panel={panel}
      rules={
        <>
          <p>
            المضاعف يرتفع من <span className="num">1.00×</span> حتى ينهار عند نقطة حُدِّدت من البذور قبل الانطلاق. حصّل قبل الانهيار لتربح قيمة
            الدخول مضروبة بالمضاعف.
          </p>
          <p>
            حدّد هدف التحصيل التلقائي، وستُحصَّل الجولة وحدها عند بلوغه. فرصة الوصول إلى أي هدف = <span className="num">99 ÷ الهدف</span>، فمثلاً
            فرصة <span className="num">2×</span> هي <span className="num">49.5%</span>، والعائد النظري <span className="num">99%</span>. أعلى
            مضاعف <span className="num">1,000×</span>.
          </p>
          <p>في اللعب التلقائي تُلعب جولات متتالية بنفس الهدف، والتحصيل فيها تلقائي فقط.</p>
          <p>كل نقطة انهيار تُحسب من بذور معلنة مسبقاً، ويمكنك التحقق منها في قسم «العدالة» أسفل الصفحة.</p>
        </>
      }
      below={
        <>
          <section className={ui.history}>
            <h2>رهاناتي</h2>
            {rounds.length === 0 ? (
              <p className="muted">لا جولات بعد.</p>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>الجولة</th>
                    <th>الانهيار</th>
                    <th>التحصيل</th>
                    <th>الصافي</th>
                  </tr>
                </thead>
                <tbody>
                  {rounds.slice(0, 12).map((r) => (
                    <tr key={`${r.serverSeedHash}:${r.nonce}`}>
                      <td className="num">{r.nonce}</td>
                      <td className="num">{fmt(r.outcome.crashPoint)}</td>
                      <td>{r.outcome.cashedAt ? <span className="num">{fmt(r.outcome.cashedAt)}</span> : "—"}</td>
                      <td className={r.gross >= r.stake ? ui.win : ui.loss}>
                        <span className="num">
                          {r.gross >= r.stake ? "+" : "-"}
                          {formatPoints(Math.abs(r.gross - r.stake))}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
          <DemoFairness demo={demo} game="crash" verify={(seeds) => `نقطة الانهيار ${fmt(crashPoint(seeds))}`} />
        </>
      }
    />
  );
}
