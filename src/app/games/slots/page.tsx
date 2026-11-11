"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DemoFairness } from "@/components/DemoFairness";
import { useAutoPlay, useSpaceKey } from "@/components/game/BetControls";
import { BarStatus, ControlBar } from "@/components/game/ControlBar";
import { GameFrame, ResultStrip } from "@/components/game/GameFrame";
import { WinBanner } from "@/components/game/WinBanner";
import { useDemoSession, type DemoRound } from "@/lib/demo/session";
import {
  BUY_PRICE_MULTIPLIER,
  BUY_SPINS,
  FS_MULTIPLIER_STEP,
  FS_START_MULTIPLIER,
  LINES,
  LINE_COUNT,
  PAYS,
  PAY_SYMBOLS,
  SLOTS_CONFIG,
  costOf,
  exactRtp,
  freeSpinsFor,
  playSlots,
  validateSlotsStake,
  windowAt,
  type SlotSymbol,
  type SlotsBet,
  type SlotsOutcome,
  type SpinResult,
} from "@/lib/games/slots";
import { formatPoints } from "@/lib/points";
import { playSound } from "@/lib/sound";
import { resultTone } from "@/lib/winTier";
import { LINE_COLORS, Reels } from "./Reels";
import { SYMBOL_NAMES, Symbol, SymbolDefs } from "./symbols";
import styles from "./slots.module.css";

type Round = DemoRound<SlotsBet, SlotsOutcome>;
type Phase = "idle" | "spinning" | "fsIntro" | "fsSpinning" | "fsOutro";

const START = windowAt([0, 10, 20, 30, 40]);
const INTRO_KEY = "rozeflow:slots:intro-seen";
const PAR = SLOTS_CONFIG.payout_model.par;
// Top round: the best spin, then 20 free spins at multipliers 1..20.
const MAX_WIN = Math.round((PAR.base_max_line_bet_units * (1 + 210)) / LINE_COUNT);

export default function SlotsPage() {
  const demo = useDemoSession();
  const rtp = useMemo(() => exactRtp(), []);
  const [stake, setStake] = useState(2000);
  const [turbo, setTurbo] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [grid, setGrid] = useState<SlotSymbol[][]>(START);
  const [prev, setPrev] = useState<SlotSymbol[][]>(START);
  const [spinKey, setSpinKey] = useState(0);
  const [round, setRound] = useState<Round | null>(null);
  const [current, setCurrent] = useState<SpinResult | null>(null); // spin on screen once landed
  const [fsIndex, setFsIndex] = useState(-1);
  const [fsWin, setFsWin] = useState(0);
  const [lastWin, setLastWin] = useState(0);
  const [pending, setPending] = useState(0); // gross not yet shown in the balance
  const [activeLine, setActiveLine] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [intro, setIntro] = useState(false);
  const [buyOpen, setBuyOpen] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);
  const [quickStop, setQuickStop] = useState(0);
  const timers = useRef<number[]>([]);

  useEffect(() => {
    try {
      if (localStorage.getItem(INTRO_KEY) !== "1") setIntro(true);
    } catch {
      setIntro(true);
    }
    const t = timers.current;
    return () => t.forEach((x) => window.clearTimeout(x));
  }, []);

  const later = (fn: () => void, ms: number) => timers.current.push(window.setTimeout(fn, ms));
  const lineBet = stake / LINE_COUNT;
  const busy = phase !== "idle";

  /** Puts a spin on the reels; the rest happens in `landed`. */
  function show(spin: SpinResult, from: SlotSymbol[][]) {
    setPrev(from);
    setGrid(spin.window);
    setCurrent(null);
    setActiveLine(null);
    setSpinKey((k) => k + 1);
  }

  function play(buy: boolean): number | null {
    setError(null);
    const bet: SlotsBet = { stake, buy };
    let r: Round;
    try {
      validateSlotsStake(stake);
      r = demo.play("slots", bet, costOf(bet), (seeds) => {
        const outcome = playSlots(seeds, bet);
        return { outcome, gross: outcome.gross };
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "تعذّر اللعب.");
      return null;
    }
    setRound(r);
    setCurrent(null);
    setPending(r.gross);
    setLastWin(0);
    setFsWin(0);
    setFsIndex(-1);
    setBanner(null);
    if (r.outcome.base) {
      playSound("start");
      setPhase("spinning");
      show(r.outcome.base, grid);
    } else {
      setPhase("fsIntro");
      later(() => startFree(r, 0, grid), 2200);
    }
    return r.gross - r.stake;
  }

  function startFree(r: Round, i: number, from: SlotSymbol[][]) {
    setPhase("fsSpinning");
    setFsIndex(i);
    show(r.outcome.freeSpins[i], from);
  }

  function finish(r: Round) {
    setPhase("idle");
    setPending(0);
    setBanner(`${r.serverSeedHash}:${r.nonce}`); // the banner picks the win size, if any
    if (r.gross === 0) playSound("lose");
  }

  const landed = useCallback(() => {
    if (!round) return;
    const o = round.outcome;
    if (phase === "spinning" && o.base) {
      const base = o.base;
      setCurrent(base);
      const win = base.units * lineBet;
      setLastWin(win);
      if (o.freeSpins.length > 0) {
        playSound("cashout");
        later(() => setPhase("fsIntro"), turbo ? 700 : 1300);
        later(() => startFree(round, 0, base.window), turbo ? 2400 : 3600);
      } else {
        later(() => finish(round), turbo ? 150 : 450);
      }
      return;
    }
    if (phase === "fsSpinning") {
      const spin = o.freeSpins[fsIndex];
      setCurrent(spin);
      const win = spin.units * lineBet * spin.multiplier;
      if (win > 0) playSound(spin.units > 0 && fsIndex + 1 < o.freeSpins.length ? "cashout" : "win");
      setFsWin((w) => w + win);
      const next = fsIndex + 1;
      if (next < o.freeSpins.length) later(() => startFree(round, next, spin.window), turbo ? 450 : win > 0 ? 1300 : 650);
      else
        later(() => {
          setPhase("fsOutro");
          playSound(o.freeGross >= round.stake * 10 ? "bigWin" : "cashout");
          later(() => {
            setLastWin(o.gross);
            finish(round);
          }, 2600);
        }, 900);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [round, phase, fsIndex, lineBet, turbo]);

  // Cycle through winning lines one at a time while idle.
  useEffect(() => {
    if (phase !== "idle" || !current || current.lineWins.length < 2) return;
    let i = -1;
    const t = window.setInterval(() => {
      i = (i + 1) % current.lineWins.length;
      setActiveLine(current.lineWins[i].line);
    }, 1100);
    return () => window.clearInterval(t);
  }, [phase, current]);

  const autoplay = useAutoPlay(() => play(false), busy, turbo ? 150 : 500);
  useSpaceKey(() => {
    if (phase === "spinning" || phase === "fsSpinning") setQuickStop((q) => q + 1);
    else if (!busy && !autoplay.running && demo.ready) play(false);
  }, !intro && !buyOpen);


  const rounds = useMemo(() => demo.rounds.filter((r): r is Round => r.game === "slots" && "freeSpins" in (r.outcome as object)), [demo.rounds]);
  const inFree = phase === "fsIntro" || phase === "fsSpinning" || phase === "fsOutro";
  const wins = current ? current.lineWins.map((w) => ({ line: w.line, count: w.count })) : [];
  const fsTotal = round?.outcome.freeSpins.length ?? 0;
  const fsSpin = inFree && fsIndex >= 0 && round ? round.outcome.freeSpins[fsIndex] : null;
  // Multiplier on screen: the current spin's, and after it lands, the next one's.
  const fsMult = fsSpin ? (current === fsSpin && fsSpin.units > 0 ? fsSpin.multiplier + FS_MULTIPLIER_STEP : fsSpin.multiplier) : FS_START_MULTIPLIER;

  const stage = (
    <div className={`${styles.scene} ${inFree ? styles.sceneFree : ""}`}>
      <SymbolDefs />
      <Decorations />
      <div className={styles.strip}>
        <ResultStrip
          items={rounds.slice(busy ? 1 : 0, (busy ? 1 : 0) + 12).map((r) => ({
            key: `${r.serverSeedHash}:${r.nonce}`,
            label: `${(r.gross / r.stake).toFixed(r.gross >= 10 * r.stake ? 0 : 1)}×`,
            tone: resultTone(r.gross, r.stake),
          }))}
        />
      </div>
      <div className={styles.machineTop}>
        <span className={styles.gameName}>مختبر الليل</span>
        {inFree ? (
          <span className={styles.fsCounter}>
            لفّة مجانية <span className="num">{Math.max(fsIndex + 1, 0)}/{fsTotal}</span>
            <span key={fsMult} className={`num ${styles.multBadge}`}>
              ×{fsMult}
            </span>
          </span>
        ) : (
          <span className={styles.tagline}>
            <span className="num">{LINE_COUNT}</span> خطاً · WILD · بونص لفّات مجانية بمضاعف يكبر
          </span>
        )}
      </div>
      <div className={styles.machine}>
        <Reels
          window={grid}
          previous={prev}
          spinKey={spinKey}
          quickStop={quickStop}
          turbo={turbo}
          onStopped={landed}
          wins={wins}
          activeLine={activeLine}
          dim={!!current && (current.lineWins.length > 0 || current.scatters >= 3)}
        />
        {current && current.lineWins.length > 0 && phase !== "fsIntro" && phase !== "fsOutro" && (
          <div className={styles.lineAmounts} dir="ltr">
            {current.lineWins
              .filter((w) => activeLine === null || w.line === activeLine)
              .slice(0, activeLine === null ? 3 : 1)
              .map((w) => (
                <span key={w.line} className="num" style={{ borderColor: LINE_COLORS[w.line % LINE_COLORS.length] }}>
                  {formatPoints(w.units * lineBet * current.multiplier)}
                </span>
              ))}
          </div>
        )}

        {phase === "fsIntro" && round && (
          <div className={styles.overlay}>
            <div className={styles.fsCard}>
              <Symbol s="scatter" className={styles.fsIcon} />
              <strong>بونص! لفّات مجانية</strong>
              <span className={`num ${styles.fsBig}`}>{round.outcome.freeSpins.length}</span>
              <span>
                المضاعف يبدأ <span className="num">×{FS_START_MULTIPLIER}</span> ويزيد <span className="num">{FS_MULTIPLIER_STEP}</span> بعد كل
                لفّة رابحة
              </span>
            </div>
          </div>
        )}
        {phase === "fsOutro" && round && (
          <div className={styles.overlay}>
            <div className={styles.fsCard}>
              <strong>انتهت اللفّات المجانية</strong>
              <span className={`num ${styles.fsBig}`}>{formatPoints(round.outcome.freeGross)}</span>
              <span className="muted">
                من <span className="num">{fsTotal}</span> لفّات
              </span>
            </div>
          </div>
        )}
        {intro && (
          <div className={styles.overlay}>
            <div className={styles.intro}>
              <span className={styles.introName}>مختبر الليل</span>
              <div className={styles.introCards}>
                <div>
                  <span>أعلى ربح ممكن</span>
                  <strong className="num">{MAX_WIN.toLocaleString("en-US")}×</strong>
                </div>
                <div>
                  <span>التقلّب</span>
                  <strong>متوسط</strong>
                </div>
                <div>
                  <span>العائد النظري</span>
                  <strong className="num">{(rtp.rtpValue * 100).toFixed(2)}%</strong>
                </div>
              </div>
              <div className={styles.introRow}>
                <Symbol s="wild" className={styles.introSym} />
                <p>WILD يظهر على البكرات 2 و3 و4 ويحل محل أي رمز عدا البونص.</p>
              </div>
              <div className={styles.introRow}>
                <Symbol s="scatter" className={styles.introSym} />
                <p>
                  ثلاثة رموز بونص أو أكثر في أي مكان تفتح <span className="num">10</span> إلى <span className="num">20</span> لفّة مجانية،
                  ومضاعفها يكبر مع كل لفّة رابحة.
                </p>
              </div>
              <button
                type="button"
                className={styles.introGo}
                onClick={() => {
                  setIntro(false);
                  try {
                    localStorage.setItem(INTRO_KEY, "1");
                  } catch {
                    /* storage blocked */
                  }
                }}
              >
                ابدأ اللعب
              </button>
            </div>
          </div>
        )}
        <WinBanner id={banner} gross={round?.gross ?? 0} stake={round?.stake ?? 1} />
      </div>
    </div>
  );

  const panel = (
    <>
      <ControlBar
        balance={demo.balance - pending}
        status={
          inFree ? (
            <BarStatus win={fsWin} label="ربح اللفّات المجانية" hint={<>بالتوفيق…</>} />
          ) : (
            <BarStatus win={phase === "idle" ? lastWin : null} hint={error ?? (busy ? "بالتوفيق…" : "ضع رهانك وأدِر البكرات")} />
          )
        }
        stake={stake}
        onStake={setStake}
        min={SLOTS_CONFIG.stake_limits.min}
        max={SLOTS_CONFIG.stake_limits.max}
        multipleOf={SLOTS_CONFIG.stake_limits.multiple_of}
        locked={busy || autoplay.running}
        extra={
          <button type="button" className={styles.buy} onClick={() => setBuyOpen(true)} disabled={busy || autoplay.running || !demo.ready}>
            <span>شراء البونص</span>
            <span className="num">{formatPoints(stake * BUY_PRICE_MULTIPLIER)}</span>
          </button>
        }
        turbo={turbo}
        onTurbo={() => setTurbo((t) => !t)}
        auto={{
          running: autoplay.running,
          left: autoplay.left,
          net: autoplay.net,
          onStart: autoplay.start,
          onStop: autoplay.stop,
          disabled: !demo.ready || busy || intro,
        }}
        primary={
          autoplay.running
            ? { kind: "stop", label: "إيقاف اللعب التلقائي", onClick: autoplay.stop }
            : phase === "spinning" || phase === "fsSpinning"
              ? { kind: "play", label: "إيقاف سريع", onClick: () => setQuickStop((q) => q + 1), busy: true }
              : { kind: "play", label: "أدِر", onClick: () => play(false), disabled: !demo.ready || busy || intro }
        }
      />
      {buyOpen && (
        <div className={styles.modalBack} onClick={() => setBuyOpen(false)}>
          <div className={styles.modal} role="dialog" aria-modal="true" aria-label="شراء البونص" onClick={(e) => e.stopPropagation()}>
            <Symbol s="scatter" className={styles.fsIcon} />
            <h2>شراء البونص</h2>
            <p>
              تبدأ فوراً <span className="num">{BUY_SPINS}</span> لفّات مجانية بمضاعف يبدأ <span className="num">×{FS_START_MULTIPLIER}</span> ويكبر
              مع كل لفّة رابحة. الرهان لكل لفّة <span className="num">{formatPoints(stake)}</span>.
            </p>
            <div className={styles.modalPrice}>
              <span>السعر</span>
              <strong className="num">{formatPoints(stake * BUY_PRICE_MULTIPLIER)}</strong>
              <span className="muted">
                (<span className="num">{BUY_PRICE_MULTIPLIER}</span> ضعف الرهان · العائد النظري{" "}
                <span className="num">{(rtp.buyValue * 100).toFixed(2)}%</span>)
              </span>
            </div>
            <div className={styles.modalActions}>
              <button type="button" className={styles.popGo} onClick={() => {
                  setBuyOpen(false);
                  play(true);
                }}>
                اشترِ
              </button>
              <button type="button" className={styles.cancel} onClick={() => setBuyOpen(false)}>
                إلغاء
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );

  return (
    <GameFrame
      title="السلوتس"
      onReset={demo.reset}
      resetDisabled={busy || autoplay.running}
      rulesTitle="مختبر الليل: الجدول والقواعد"
      stage={stage}
      panel={panel}
      rules={<InfoSheet lineBet={lineBet} rounds={rounds} rtp={rtp} />}
      below={
        <DemoFairness
          demo={demo}
          game="slots"
          verify={(seeds, r) => {
            const bet = r.bet as SlotsBet;
            if (typeof bet !== "object" || !("buy" in bet)) return "جولة من إصدار سابق للعبة";
            const o = playSlots(seeds, bet);
            const stops = o.base ? `مواضع البكرات ${o.base.stops.join("، ")}` : "شراء لفّات";
            return `${stops}، لفّات مجانية ${o.freeSpins.length} ← العائد ${formatPoints(o.gross)}`;
          }}
        />
      }
    />
  );
}

/** Lab props beside the machine on wide screens: test tubes with bubbles, and a slow orbit. */
function Decorations() {
  return (
    <>
      <svg className={`${styles.deco} ${styles.decoLeft}`} viewBox="0 0 170 260" aria-hidden="true">
        <rect x="10" y="200" width="150" height="14" rx="4" fill="#24304f" />
        <rect x="18" y="214" width="8" height="40" fill="#1a2440" />
        <rect x="144" y="214" width="8" height="40" fill="#1a2440" />
        {[
          [34, "#3ecf8e", 120],
          [72, "#a66bff", 90],
          [110, "#ff8a1f", 140],
          [146, "#ff8fb0", 105],
        ].map(([x, c, h], i) => (
          <g key={i}>
            <rect x={(x as number) - 11} y={200 - (h as number)} width="22" height={h as number} rx="11" fill="#cfe9ff" fillOpacity="0.07" stroke="#9fb4ff" strokeOpacity="0.4" strokeWidth="2" />
            <rect x={(x as number) - 8} y={200 - (h as number) * 0.55} width="16" height={(h as number) * 0.55 - 3} rx="8" fill={c as string} opacity="0.75" />
            <circle className={styles.bubble} cx={x as number} cy={196} r="2.6" fill="#fff" opacity="0.8" />
          </g>
        ))}
      </svg>
      <svg className={`${styles.deco} ${styles.decoRight}`} viewBox="0 0 170 260" aria-hidden="true">
        <circle cx="85" cy="120" r="30" fill="url(#sx-orange)" opacity="0.85" />
        <g className={styles.orbit} fill="none" stroke="#9fb4ff" strokeOpacity="0.5" strokeWidth="2">
          <ellipse cx="85" cy="120" rx="70" ry="24" />
          <ellipse cx="85" cy="120" rx="70" ry="24" transform="rotate(60 85 120)" />
          <ellipse cx="85" cy="120" rx="70" ry="24" transform="rotate(-60 85 120)" />
          <circle cx="155" cy="120" r="5" fill="#ffd2a1" stroke="none" />
        </g>
        <rect x="35" y="214" width="100" height="10" rx="5" fill="#24304f" />
      </svg>
    </>
  );
}

function InfoSheet({ lineBet, rounds, rtp }: { lineBet: number; rounds: Round[]; rtp: ReturnType<typeof exactRtp> }) {
  const [tab, setTab] = useState<"pay" | "lines" | "rules" | "history">("pay");
  return (
    <div className={styles.info}>
      <SymbolDefs />
      <div className={styles.tabs} role="tablist">
        {(
          [
            ["pay", "جدول الدفع"],
            ["lines", "الخطوط"],
            ["rules", "القواعد"],
            ["history", "سجلّي"],
          ] as const
        ).map(([k, label]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>
            {label}
          </button>
        ))}
      </div>

      {tab === "pay" && (
        <>
          <p className="muted">
            المبالغ بالنقاط لرهانك الحالي (رهان الخط = الرهان ÷ <span className="num">{LINE_COUNT}</span>). في اللفّات المجانية تُضرب بالمضاعف الحالي.
          </p>
          <div className={styles.payGrid}>
            {PAY_SYMBOLS.map((s) => (
              <div key={s} className={styles.payItem}>
                <Symbol s={s} className={styles.paySym} />
                <dl>
                  {[5, 4, 3].map((n) => (
                    <div key={n}>
                      <dt className="num">{n}</dt>
                      <dd className="num">{formatPoints(Math.round(PAYS[s][n - 3] * lineBet))}</dd>
                    </div>
                  ))}
                </dl>
                <span className={styles.payName}>{SYMBOL_NAMES[s]}</span>
              </div>
            ))}
          </div>
        </>
      )}

      {tab === "lines" && (
        <>
          <p className="muted">
            <span className="num">{LINE_COUNT}</span> خطاً تلعب دائماً. الخط يربح بثلاثة رموز متطابقة أو أكثر متتالية من البكرة الأولى (اليسرى).
          </p>
          <div className={styles.lineGrid} dir="ltr">
            {LINES.map((rows, i) => (
              <div key={i} className={styles.mini}>
                <span className="num">{i + 1}</span>
                <div>
                  {Array.from({ length: 25 }, (_, k) => {
                    const row = Math.floor(k / 5);
                    const reel = k % 5;
                    return <i key={k} className={rows[reel] === row ? styles.on : ""} />;
                  })}
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {tab === "rules" && (
        <div className={styles.rules}>
          <div className={styles.introRow}>
            <Symbol s="wild" className={styles.introSym} />
            <p>WILD يظهر على البكرات 2 و3 و4 فقط، ويحل محل أي رمز عدا البونص.</p>
          </div>
          <div className={styles.introRow}>
            <Symbol s="scatter" className={styles.introSym} />
            <p>
              رمز البونص في أي مكان: <span className="num">3</span> = <span className="num">{freeSpinsFor(3)}</span> لفّات مجانية،{" "}
              <span className="num">4</span> = <span className="num">{freeSpinsFor(4)}</span>، <span className="num">5</span> ={" "}
              <span className="num">{freeSpinsFor(5)}</span>. يبدأ المضاعف عند <span className="num">×{FS_START_MULTIPLIER}</span> ويزيد{" "}
              <span className="num">{FS_MULTIPLIER_STEP}</span> بعد كل لفّة مجانية رابحة، فتكبر الأرباح كلما تقدمت. اللفّات المجانية لا تعيد
              تشغيل نفسها، وتأتي مرة كل <span className="num">{Math.round(rtp.triggerOneIn)}</span> لفّة في المتوسط. عند ظهور رمزَي بونص تدور
              البكرات الباقية أبطأ وتتوهج.
            </p>
          </div>
          <p>
            شراء البونص: <span className="num">{BUY_SPINS}</span> لفّات مجانية فوراً بسعر <span className="num">{BUY_PRICE_MULTIPLIER}</span> ضعف الرهان،
            وعائده النظري <span className="num">{(rtp.buyValue * 100).toFixed(2)}%</span>.
          </p>
          <p>
            العائد النظري للعبة <span className="num">{(rtp.rtpValue * 100).toFixed(2)}%</span>، محسوب بالضبط من البكرات وجدول الدفع وليس
            بالمحاكاة. يأتي <span className="num">{(rtp.baseValue * 100).toFixed(2)}%</span> منه من اللفّات العادية، و
            <span className="num">{(rtp.freeValue * 100).toFixed(2)}%</span> من اللفّات المجانية. نسبة اللفّات الرابحة{" "}
            <span className="num">{(PAR.base_hit_frequency * 100).toFixed(1)}%</span>، وأعلى ربح ممكن في جولة{" "}
            <span className="num">{MAX_WIN.toLocaleString("en-US")}×</span> الرهان.
          </p>
          <p>كل جولة، مع لفّاتها المجانية، تُحسب من بذور معلنة مسبقاً، ويمكنك التحقق منها في قسم «العدالة» أسفل الصفحة.</p>
        </div>
      )}

      {tab === "history" && (
        <div className={styles.history}>
          {rounds.length === 0 ? (
            <p className="muted">لا جولات بعد.</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>الجولة</th>
                  <th>النوع</th>
                  <th>الكلفة</th>
                  <th>العائد</th>
                </tr>
              </thead>
              <tbody>
                {rounds.slice(0, 20).map((r) => (
                  <tr key={`${r.serverSeedHash}:${r.nonce}`}>
                    <td>
                      <span className="num">{r.nonce}</span>
                    </td>
                    <td>
                      {r.bet.buy ? "شراء لفّات" : r.outcome.freeSpins.length > 0 ? `لفّة + ${r.outcome.freeSpins.length} مجانية` : "لفّة"}
                    </td>
                    <td>
                      <span className="num">{formatPoints(r.stake)}</span>
                    </td>
                    <td className={r.gross > r.stake ? styles.win : styles.loss}>
                      <span className="num">{formatPoints(r.gross)}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
