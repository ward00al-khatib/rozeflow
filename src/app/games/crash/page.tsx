"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DemoFairness } from "@/components/DemoFairness";
import { useAutoPlay, useSpaceKey } from "@/components/game/BetControls";
import { BarStatus, ControlBar, type PrimaryAction } from "@/components/game/ControlBar";
import { GameFrame, ResultStrip } from "@/components/game/GameFrame";
import { WinBanner } from "@/components/game/WinBanner";
import ui from "@/components/game/stage.module.css";
import { RtpHistory } from "@/components/RtpHistory";
import { useDemoSession, type DemoRound, type OpenRound } from "@/lib/demo/session";
import { useServerCrash } from "@/lib/server/games";
import { fmtRtp, useLiveConfig } from "@/lib/server/gameConfig";
import type { RoundView, ServerRound } from "@/lib/server/rounds";
import { playsReal, useMember } from "@/lib/useMember";
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

/** How often a real flight asks the server where it stands (the crash point is known only there). */
const POLL_MS = 300;

export default function CrashPage() {
  const demo = useDemoSession();
  const member = useMember();
  // Members play on the server with the real wallet; visitors play the demo in the browser.
  const real = playsReal(member);
  const server = useServerCrash(real ? member.profile.user_id : null);
  const { config, refresh: refreshConfig } = useLiveConfig("crash", CRASH_CONFIG);
  const rtpBp = config.payout_model.target_rtp_bp;
  const ready = member.status !== "loading" && (real ? server.ready : demo.ready);
  const [serverOpen, setServerOpen] = useState<OpenRound<CrashBet, FlightState> | null>(null);
  const [waiting, setWaiting] = useState(false);
  const [stake, setStake] = useState(1000);
  const [autoText, setAutoText] = useState("2.00");
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [last, setLast] = useState<Round | null>(null);
  const settling = useRef(false);
  const lastTick = useRef(0);
  const asking = useRef(false); // a request about the real flight is on its way
  const lastAsk = useRef(0);
  const pendingCash = useRef(false); // cash-out pressed while another request was on its way
  const landed = useRef<((net: number | null) => void) | null>(null); // autoplay waits here for a real flight to end

  const { min, max } = CRASH_CONFIG.stake_limits;
  const autoLimits = CRASH_CONFIG.rules.auto_cashout;
  const autoCashout = Math.round(Number(autoText) * 100);
  const autoValid = Number.isInteger(autoCashout) && autoCashout >= autoLimits.min && autoCashout <= autoLimits.max;

  const open = real ? serverOpen : demo.open?.game === "crash" ? (demo.open as OpenRound<CrashBet, FlightState>) : null;
  const flying = open !== null;

  // Crash point of the open round. Demo mode only: on the server it stays secret until the round ends.
  const crash = open && !real ? crashPoint(demo.openSeeds(), rtpBp) : null;
  const elapsed = open ? Math.max(0, now - open.state.startedAt) : 0;
  // A real flight never shows more than its automatic target: the server pays exactly that once it is reached.
  const live = open ? Math.min(multiplierAt(elapsed), crash ?? open.bet.autoCashout) : null;

  const finishRound = useCallback(
    (manualAt: number | null) => {
      if (!open || settling.current) return;
      settling.current = true;
      const outcome = settleCrash(open.bet, crashPoint(demo.openSeeds(), rtpBp), manualAt);
      demo.finish(outcome, outcome.gross);
      playSound(outcome.cashedAt ? "cashout" : "lose");
      const { state: _s, ...rest } = open;
      void _s;
      setLast({ ...rest, outcome, gross: outcome.gross });
    },
    [open, demo, rtpBp],
  );

  /** A real flight as the page tracks it. The clock starts at the server's start, as seen from this browser. */
  const toFlight = useCallback(
    (view: RoundView, startedAt: number): OpenRound<CrashBet, FlightState> => ({
      game: "crash",
      nonce: Number(view.nonce),
      serverSeedHash: view.server_seed_hash,
      clientSeed: view.client_seed,
      bet: { stake: Number(view.stake), autoCashout: Number(view.auto_cashout) },
      stake: Number(view.stake),
      state: { startedAt },
      at: startedAt,
    }),
    [],
  );

  const { call, resume } = server;
  /** Asks the server where the real flight stands; `cash` is the player's cash-out press. */
  const ask = useCallback(
    (cash: boolean) => {
      if (asking.current) {
        // Never drop a cash-out press: it goes out as soon as the current request returns.
        if (cash) pendingCash.current = true;
        return;
      }
      asking.current = true;
      let ended = false;
      call("crash_step", { p_cash: cash }, false)
        .then(({ round }) => {
          if (!round) return;
          ended = true;
          playSound(round.outcome.cashedAt ? "cashout" : "lose");
          setServerOpen(null);
          setLast(round);
          landed.current?.(round.gross - round.stake);
          landed.current = null;
        })
        .catch(() =>
          // The answer may have been lost, or the flight was settled elsewhere: ask where things stand.
          resume().then(
            (view) => {
              if (view) return;
              setServerOpen(null);
              landed.current?.(null);
              landed.current = null;
            },
            () => undefined,
          ),
        )
        .finally(() => {
          asking.current = false;
          const again = pendingCash.current && !ended;
          pendingCash.current = false;
          if (again) askRef.current(true);
        });
    },
    [call, resume],
  );
  const askRef = useRef(ask);
  askRef.current = ask;

  // A reload in the middle of a real flight picks it up again.
  useEffect(() => {
    if (!real || !server.ready) return;
    void resume().then(
      (view) => view && setServerOpen(toFlight(view, Date.now() - Number(view.elapsed_ms))),
      () => undefined,
    );
  }, [real, server.ready, resume, toFlight]);

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
      if (real) {
        // The effect restarts on every frame, so the time of the last question lives in a ref.
        if (t - lastAsk.current >= POLL_MS) {
          lastAsk.current = t;
          ask(false);
        }
      } else if (m >= open.bet.autoCashout || m >= crash!) {
        finishRound(null);
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [open, crash, finishRound, real, ask]);

  /** Starts a flight. Returns its net for autoplay (no manual cash-out during autoplay), or null. */
  function start(): number | null | Promise<number | null> {
    setError(null);
    const bet: CrashBet = { stake, autoCashout };
    try {
      validateCrashBet(bet);
      if (real) {
        if (stake > server.balance) throw new Error("رصيدك لا يكفي لهذه الجولة.");
        const sent = Date.now();
        setWaiting(true);
        return call("crash_start", { p_stake: bet.stake, p_auto_cashout: bet.autoCashout }, true).then(
          ({ view, round }) => {
            setWaiting(false);
            if (round) {
              // Answer to a repeated request for a flight that already ended.
              setLast(round);
              return round.gross - round.stake;
            }
            // The server started its clock while the request was on its way: split the round trip.
            const startedAt = sent + (Date.now() - sent) / 2 - Number(view.elapsed_ms ?? 0);
            lastTick.current = 10;
            playSound("start");
            if (view.rtp_bp !== rtpBp) refreshConfig();
            setLast(null);
            setServerOpen(toFlight(view, startedAt));
            return new Promise<number | null>((resolve) => {
              landed.current = resolve;
            });
          },
          (e) => {
            setWaiting(false);
            setError(e instanceof Error ? e.message : "تعذّر البدء.");
            return null;
          },
        );
      }
      const net = settleCrash(bet, crashPoint(demo.nextSeeds(), rtpBp), null).gross - stake;
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
    if (real) ask(true);
    else finishRound(multiplierAt(Date.now() - open.state.startedAt));
  }

  const autoplay = useAutoPlay(start, flying || waiting, 900);
  const locked = flying || waiting || autoplay.running;

  const primary: PrimaryAction = autoplay.running
    ? { kind: "stop", label: "إيقاف", onClick: autoplay.stop }
    : flying
      ? { kind: "cash", label: "حصّل", sub: formatPoints(Math.floor((open!.bet.stake * live!) / 100)), onClick: cashOut }
      : { kind: "play", label: "انطلق", onClick: () => start(), disabled: !ready || !autoValid || waiting, busy: waiting };
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
  // Nose direction: along the curve (the stage is about twice as wide as it is tall per unit).
  const prev = pts[pts.length - 4] ?? pts[0];
  const tilt = 90 - (Math.atan2(prev[1] - head[1], (head[0] - prev[0]) * 1.6 + 0.001) * 180) / Math.PI;

  const crashed = !flying && last !== null;
  const won = crashed && last!.outcome.cashedAt !== null;
  const allRounds = real ? server.rounds : demo.rounds;
  const rounds = useMemo(() => allRounds.filter((r): r is Round => r.game === "crash"), [allRounds]);

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
        <div className={`${styles.stars} ${flying ? styles.starsLive : ""}`} aria-hidden="true" />
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
            className={styles.head}
            style={{ left: `calc(16px + (100% - 32px) * ${(head[0] / W).toFixed(4)})`, top: `calc(16px + (100% - 28px) * ${(head[1] / H).toFixed(4)})` }}
          >
            {crashed && !won ? (
              <span key={`${last!.serverSeedHash}:${last!.nonce}`} className={styles.blast}>
                {Array.from({ length: 10 }, (_, i) => (
                  <i key={i} style={{ transform: `rotate(${i * 36}deg)` }} />
                ))}
              </span>
            ) : (
              <svg viewBox="-20 -30 40 62" className={`${styles.rocket} ${flying ? styles.rocketLive : ""}`} style={{ transform: `translate(-50%, -50%) rotate(${tilt.toFixed(1)}deg)` }} aria-hidden="true">
                <path className={styles.flame} d="M-6 14h12l-6 18z" fill="#ffd27a" />
                <path d="M0 -28c11 8 13 24 10 42h-20c-3-18-1-34 10-42z" fill={won ? "#3ecf8e" : "#eef2f8"} />
                <circle cy="-8" r="5" fill="#0c1120" stroke="#9fb4ff" strokeWidth="1.5" />
                <path d="M-10 6l-9 12 9-3zM10 6l9 12-9-3z" fill="#ff8a1f" />
              </svg>
            )}
          </span>
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
          <span className="num">{autoValid ? (rtpBp / autoCashout).toFixed(2) + "%" : "—"}</span>
        </div>
      </div>
    </>
  );

  const panel = (
    <ControlBar
      balance={real ? server.balance : demo.balance}
      balanceLabel={real ? "رصيدك" : undefined}
      status={
        error || (real && server.loadError) ? (
          <span className="error">{error ?? server.loadError}</span>
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
        disabled: !ready || flying || waiting || !autoValid,
      }}
      primary={primary}
    />
  );

  return (
    <GameFrame
      title="كراش"
      music="crash"
      tint="#ff8a1f"
      real={real}
      device={member.status === "member" ? member.device : undefined}
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
            حدّد هدف التحصيل التلقائي، وستُحصَّل الجولة وحدها عند بلوغه. فرصة الوصول إلى أي هدف = <span className="num">{fmtRtp(rtpBp)} ÷ الهدف</span>، فمثلاً
            فرصة <span className="num">2×</span> هي <span className="num">{fmtRtp(rtpBp / 2)}%</span>، والعائد النظري <span className="num">{fmtRtp(rtpBp)}%</span> لكل اللاعبين. أعلى
            مضاعف <span className="num">1,000×</span>.
          </p>
          <p>في اللعب التلقائي تُلعب جولات متتالية بنفس الهدف، والتحصيل فيها تلقائي فقط.</p>
          <p>كل نقطة انهيار تُحسب من بذور معلنة مسبقاً، ويمكنك التحقق منها في قسم «العدالة» أسفل الصفحة.</p>
          <RtpHistory gameId="crash" />
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
          <DemoFairness
            demo={real ? { ...server, open: serverOpen } : demo}
            game="crash"
            verify={(seeds, round) => `نقطة الانهيار ${fmt(crashPoint(seeds, (round as ServerRound<CrashBet, CrashOutcome>).rtpBp ?? rtpBp))}`}
          />
        </>
      }
    />
  );
}
