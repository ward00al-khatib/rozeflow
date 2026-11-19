"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DemoFairness } from "@/components/DemoFairness";
import { useAutoPlay, useSpaceKey } from "@/components/game/BetControls";
import { BarStatus, ControlBar } from "@/components/game/ControlBar";
import { GameFrame, ResultStrip } from "@/components/game/GameFrame";
import { WinBanner } from "@/components/game/WinBanner";
import { useServerReef } from "@/lib/server/games";
import { useLiveConfig } from "@/lib/server/gameConfig";
import type { ServerRound } from "@/lib/server/rounds";
import { playsReal, useMember } from "@/lib/useMember";
import { useDemoSession, type DemoRound } from "@/lib/demo/session";
import {
  REEF_CONFIG,
  REEF_FS,
  REEF_LINES,
  REEF_LINE_COUNT,
  REEF_PAYS,
  REEF_PAY_SYMBOLS,
  playReef,
  reefExactRtp,
  reefScalePay,
  reefWindow,
  validateReefStake,
  type ReefBet,
  type ReefOutcome,
  type ReefSpin,
  type ReefSymbol,
} from "@/lib/games/reef";
import { formatPoints } from "@/lib/points";
import { playSound } from "@/lib/sound";
import { resultTone } from "@/lib/winTier";
import { LINE_COLORS, Reels } from "./Reels";
import { REEF_NAMES, ReefDefs, ReefSym } from "./symbols";
import styles from "./reef.module.css";

type Round = DemoRound<ReefBet, ReefOutcome>;
type Phase = "idle" | "spinning" | "fsIntro" | "fsSpinning" | "fsOutro";

const START = reefWindow([2, 12, 22]);
const INTRO_KEY = "rozeflow:reef:intro-seen";
const PAR = REEF_CONFIG.payout_model.par;
const NAME = "شعاب الفقاعات";

export default function ReefPage() {
  const demo = useDemoSession();
  const member = useMember();
  // Members play on the server with the real wallet; visitors play the demo in the browser.
  const real = playsReal(member);
  const server = useServerReef(real ? member.profile.user_id : null);
  const { config, refresh: refreshConfig } = useLiveConfig("reef", REEF_CONFIG);
  const rtpBp = config.payout_model.target_rtp_bp;
  const ready = member.status !== "loading" && (real ? server.ready : demo.ready);
  const [waiting, setWaiting] = useState(false); // sent to the server, answer not here yet
  const rtp = useMemo(() => reefExactRtp(), []);
  const k = rtpBp / 10000 / rtp.rtpValue; // owner-set RTP over the paytable's own
  const [stake, setStake] = useState(1000);
  const [turbo, setTurbo] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [grid, setGrid] = useState<ReefSymbol[][]>(START);
  const [prev, setPrev] = useState<ReefSymbol[][]>(START);
  const [spinKey, setSpinKey] = useState(0);
  const [round, setRound] = useState<Round | null>(null);
  const [current, setCurrent] = useState<ReefSpin | null>(null); // spin on screen once landed
  const [fsIndex, setFsIndex] = useState(-1);
  const [fsWin, setFsWin] = useState(0);
  const [lastWin, setLastWin] = useState(0);
  const [pending, setPending] = useState(0); // gross not yet shown in the balance
  const [activeLine, setActiveLine] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [intro, setIntro] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);
  const [toast, setToast] = useState<{ key: number; text: string } | null>(null);
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
  const lineBet = stake / REEF_LINE_COUNT;
  const busy = phase !== "idle" || waiting;

  /** Puts a spin on the reels; the rest happens in `landed`. */
  function show(spin: ReefSpin, from: ReefSymbol[][]) {
    setPrev(from);
    setGrid(spin.window);
    setCurrent(null);
    setActiveLine(null);
    setSpinKey((n) => n + 1);
  }

  function fail(e: unknown): null {
    setWaiting(false);
    setError(e instanceof Error ? e.message : "تعذّر اللعب.");
    return null;
  }

  function play(): number | null | Promise<number | null> {
    setError(null);
    const bet: ReefBet = { stake };
    try {
      validateReefStake(stake);
      if (real) {
        if (stake > server.balance) throw new Error("رصيدك لا يكفي لهذه الجولة.");
        setWaiting(true);
        return server.play(bet).then((r) => {
          setWaiting(false);
          // The owner may have changed the RTP since this page loaded: show the new pays.
          if (r.rtpBp !== rtpBp) refreshConfig();
          return begin(r);
        }, fail);
      }
      return begin(
        demo.play("reef", bet, stake, (seeds) => {
          const outcome = playReef(seeds, bet, rtpBp);
          return { outcome, gross: outcome.gross };
        }),
      );
    } catch (e) {
      return fail(e);
    }
  }

  /** Puts a settled round on the reels; returns its net. */
  function begin(r: Round): number {
    setRound(r);
    setCurrent(null);
    setPending(r.gross);
    setLastWin(0);
    setFsWin(0);
    setFsIndex(-1);
    setBanner(null);
    setToast(null);
    playSound("start");
    setPhase("spinning");
    show(r.outcome.base, grid);
    return r.gross - r.stake;
  }

  function startFree(r: Round, i: number, from: ReefSymbol[][]) {
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
    if (phase === "spinning") {
      const base = o.base;
      setCurrent(base);
      setLastWin(o.baseGross);
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
      const win = reefScalePay(spin.units * lineBet * spin.multiplier, rtpBp);
      if (win > 0) playSound("win");
      setFsWin((w) => w + win);
      let pause = turbo ? 450 : win > 0 ? 1300 : 650;
      if (spin.added > 0) {
        playSound("bigWin");
        setToast({ key: Date.now(), text: `+${spin.added} لفّات إضافية!` });
        pause += turbo ? 600 : 1200;
      } else if (spin.chests > 0) {
        playSound("pop");
        setToast({ key: Date.now(), text: `المضاعف +${spin.chests * REEF_FS.step}` });
        pause += turbo ? 200 : 500;
      }
      const next = fsIndex + 1;
      if (next < o.freeSpins.length) later(() => startFree(round, next, spin.window), pause);
      else
        later(() => {
          setPhase("fsOutro");
          playSound(o.freeGross >= round.stake * 10 ? "bigWin" : "cashout");
          later(() => {
            setLastWin(o.gross);
            finish(round);
          }, 2600);
        }, pause);
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

  const autoplay = useAutoPlay(() => play(), busy, turbo ? 150 : 500);
  useSpaceKey(() => {
    if (phase === "spinning" || phase === "fsSpinning") setQuickStop((q) => q + 1);
    else if (!busy && !autoplay.running && ready) play();
  }, !intro);

  const allRounds = real ? server.rounds : demo.rounds;
  const rounds = useMemo(() => allRounds.filter((r): r is Round => r.game === "reef" && "freeSpins" in (r.outcome as object)), [allRounds]);
  const inFree = phase === "fsIntro" || phase === "fsSpinning" || phase === "fsOutro";
  const wins = current ? current.lineWins.map((w) => ({ line: w.line })) : [];
  const fsSpins = round?.outcome.freeSpins ?? [];
  // Spins awarded so far: the first 8, plus every retrigger already shown.
  const fsAwarded = REEF_FS.spins + fsSpins.slice(0, current && fsIndex >= 0 && current === fsSpins[fsIndex] ? fsIndex + 1 : Math.max(fsIndex, 0)).reduce((s, f) => s + f.added, 0);
  const fsSpin = inFree && fsIndex >= 0 ? fsSpins[fsIndex] : null;
  // Multiplier on screen: the current spin's, and after it lands, the next one's.
  const fsMult = fsSpin
    ? current === fsSpin
      ? Math.min(fsSpin.multiplier + REEF_FS.step * fsSpin.chests, REEF_FS.maxMultiplier)
      : fsSpin.multiplier
    : REEF_FS.startMultiplier;

  const stage = (
    <div className={`${styles.scene} ${inFree ? styles.sceneFree : ""}`}>
      <div className={styles.rays} />
      <SeaBubbles />
      <Seabed />
      <ReefDefs />
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
        <span className={styles.gameName}>{NAME}</span>
        {inFree ? (
          <span className={styles.fsBar}>
            لفّة مجانية{" "}
            <span className="num">
              {Math.max(fsIndex + 1, 0)}/{fsAwarded}
            </span>
            <span key={fsMult} className={`num ${styles.multBubble}`}>
              ×{fsMult}
            </span>
          </span>
        ) : (
          <span className={styles.tagline}>
            <span className="num">3×3</span> · <span className="num">{REEF_LINE_COUNT}</span> خطوط · بونص بمضاعف يكبر مع كل صندوق
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
          dim={!!current && (current.lineWins.length > 0 || (inFree ? current.chests > 0 : current.chests >= REEF_FS.trigger))}
          chestHit={!!current && (inFree ? current.chests > 0 : current.chests >= REEF_FS.trigger)}
        />
        {current && current.lineWins.length > 0 && phase !== "fsIntro" && phase !== "fsOutro" && (
          <div className={styles.lineAmounts} dir="ltr">
            {current.lineWins
              .filter((w) => activeLine === null || w.line === activeLine)
              .slice(0, activeLine === null ? 3 : 1)
              .map((w) => (
                <span key={w.line} className="num" style={{ borderColor: LINE_COLORS[w.line % LINE_COLORS.length] }}>
                  {formatPoints(reefScalePay(w.units * lineBet * current.multiplier, rtpBp))}
                </span>
              ))}
          </div>
        )}
        {toast && phase === "fsSpinning" && (
          <div key={toast.key} className={styles.toast}>
            {toast.text}
          </div>
        )}

        {phase === "fsIntro" && round && (
          <div className={styles.overlay}>
            <div className={styles.fsCard}>
              <ReefSym s="chest" className={styles.fsIcon} />
              <strong>بونص! صندوق الكنز انفتح</strong>
              <span className={`num ${styles.fsBig}`}>{REEF_FS.spins}</span>
              <span>لفّات مجانية. كل صندوق يظهر يرفع المضاعف، وثلاثة صناديق تعطيك لفّات إضافية.</span>
            </div>
          </div>
        )}
        {phase === "fsOutro" && round && (
          <div className={styles.overlay}>
            <div className={styles.fsCard}>
              <strong>انتهى البونص</strong>
              <span className={`num ${styles.fsBig}`}>{formatPoints(round.outcome.freeGross)}</span>
              <span className="muted">
                من <span className="num">{fsSpins.length}</span> لفّة مجانية
              </span>
            </div>
          </div>
        )}
        {intro && (
          <div className={styles.overlay}>
            <div className={styles.intro}>
              <span className={styles.introName}>{NAME}</span>
              <div className={styles.introCards}>
                <div>
                  <span>المضاعف</span>
                  <strong className="num">حتى ×{REEF_FS.maxMultiplier}</strong>
                </div>
                <div>
                  <span>البونص</span>
                  <strong className="num">1/{Math.round(rtp.triggerOneIn)}</strong>
                </div>
                <div>
                  <span>العائد النظري</span>
                  <strong className="num">{(rtpBp / 100).toFixed(2)}%</strong>
                </div>
              </div>
              <div className={styles.introRow}>
                <ReefSym s="pearl" className={styles.introSym} />
                <p>اللؤلؤة WILD تحل محل أي رمز عدا الصندوق، وثلاث لآلئ على خط تدفع أعلى جائزة.</p>
              </div>
              <div className={styles.introRow}>
                <ReefSym s="chest" className={styles.introSym} />
                <p>
                  ثلاثة صناديق كنز تفتح <span className="num">{REEF_FS.spins}</span> لفّات مجانية. في البونص كل صندوق يرفع المضاعف{" "}
                  <span className="num">+{REEF_FS.step}</span>، وثلاثة صناديق تضيف <span className="num">{REEF_FS.retriggerSpins}</span> لفّات.
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
    <ControlBar
      balance={(real ? server.balance : demo.balance) - pending}
      balanceLabel={real ? "رصيدك" : undefined}
      status={
        inFree ? (
          <BarStatus win={fsWin} label="ربح البونص" hint={<>بالتوفيق…</>} />
        ) : (
          <BarStatus win={phase === "idle" ? lastWin : null} hint={error ?? (real ? server.loadError : null) ?? (busy ? "بالتوفيق…" : "ضع رهانك وأدِر البكرات")} />
        )
      }
      stake={stake}
      onStake={setStake}
      min={REEF_CONFIG.stake_limits.min}
      max={REEF_CONFIG.stake_limits.max}
      multipleOf={REEF_CONFIG.stake_limits.multiple_of}
      locked={busy || autoplay.running}
      turbo={turbo}
      onTurbo={() => setTurbo((t) => !t)}
      auto={{
        running: autoplay.running,
        left: autoplay.left,
        net: autoplay.net,
        onStart: autoplay.start,
        onStop: autoplay.stop,
        disabled: !ready || busy || intro,
      }}
      primary={
        autoplay.running
          ? { kind: "stop", label: "إيقاف اللعب التلقائي", onClick: autoplay.stop }
          : phase === "spinning" || phase === "fsSpinning"
            ? { kind: "play", label: "إيقاف سريع", onClick: () => setQuickStop((q) => q + 1), busy: true }
            : { kind: "play", label: "أدِر", onClick: () => play(), disabled: !ready || busy || intro, busy: waiting }
      }
    />
  );

  return (
    <GameFrame
      title={NAME}
      music="reef"
      real={real}
      device={member.status === "member" ? member.device : undefined}
      agent={member.status === "member" && member.agent}
      onReset={demo.reset}
      resetDisabled={busy || autoplay.running}
      rulesTitle={`${NAME}: الجدول والقواعد`}
      stage={stage}
      panel={panel}
      rules={<InfoSheet lineBet={lineBet} rounds={rounds} rtp={rtp} rtpBp={rtpBp} k={k} />}
      below={
        <DemoFairness
          demo={real ? server : demo}
          game="reef"
          verify={(seeds, r) => {
            const bet = r.bet as ReefBet;
            const o = playReef(seeds, bet, (r as ServerRound<ReefBet, ReefOutcome>).rtpBp ?? rtpBp);
            return `مواضع البكرات ${o.base.stops.join("، ")}، لفّات مجانية ${o.freeSpins.length} ← العائد ${formatPoints(o.gross)}`;
          }}
        />
      }
    />
  );
}

/** Bubbles rising through the water behind the machine. Fixed positions so the pre-rendered page matches. */
function SeaBubbles() {
  const list = [
    [6, 10, 9, 0],
    [14, 6, 12, 3],
    [22, 14, 10, 6],
    [31, 8, 14, 1.5],
    [44, 5, 11, 8],
    [58, 9, 13, 4],
    [67, 16, 10, 2],
    [76, 7, 15, 7],
    [85, 12, 11, 5],
    [93, 6, 13, 9],
  ];
  return (
    <div className={styles.seaBubbles} aria-hidden="true">
      {list.map(([left, size, dur, delay], i) => (
        <i key={i} style={{ left: `${left}%`, width: size, height: size, animationDuration: `${dur}s`, animationDelay: `-${delay}s` }} />
      ))}
    </div>
  );
}

/** Sand, rocks and swaying kelp along the bottom of the scene. */
function Seabed() {
  return (
    <div className={styles.seabed} aria-hidden="true">
      <svg viewBox="0 0 1200 120" preserveAspectRatio="none">
        <path className={styles.kelp} d="M90 120c-10-30 14-50 0-80s10-40 4-40" stroke="#1fae6f" strokeWidth="9" fill="none" strokeLinecap="round" />
        <path className={styles.kelp} d="M130 120c8-26-12-44 2-70" stroke="#3ecf8e" strokeWidth="7" fill="none" strokeLinecap="round" />
        <path className={styles.kelp} d="M1060 120c-10-30 14-50 0-80s10-40 4-40" stroke="#1fae6f" strokeWidth="9" fill="none" strokeLinecap="round" />
        <path className={styles.kelp} d="M1110 120c8-26-12-44 2-70" stroke="#3ecf8e" strokeWidth="7" fill="none" strokeLinecap="round" />
        <path d="M0 100c120-20 260-6 400-14s300-22 420-8 260 10 380-4v46H0z" fill="#d9b27a" opacity="0.55" />
        <path d="M0 110c160-14 340 0 520-6s360-10 680 0v16H0z" fill="#b98d55" opacity="0.6" />
        <ellipse cx="300" cy="104" rx="40" ry="14" fill="#5e6f86" opacity="0.7" />
        <ellipse cx="900" cy="106" rx="54" ry="16" fill="#4c5c74" opacity="0.7" />
      </svg>
    </div>
  );
}

/** Coral and a little shipwreck beside the machine on wide screens. */
function Decorations() {
  return (
    <>
      <svg className={styles.decoReef} style={{ left: "3%" }} viewBox="0 0 190 260" aria-hidden="true">
        <g fill="#ff7a8a" opacity="0.85">
          <path d="M60 250V170c0-10-14-18-14-34s10-20 10-30M60 190c10-8 24-6 26-24s-6-24 0-34M60 210c-12-6-30-2-34-20" stroke="#ff7a8a" strokeWidth="10" fill="none" strokeLinecap="round" />
        </g>
        <path d="M130 250c0-30 20-40 20-70s-14-36-6-60" stroke="#ffb27a" strokeWidth="8" fill="none" strokeLinecap="round" opacity="0.8" />
        <circle className={styles.bubble} cx="148" cy="120" r="4" fill="none" stroke="#dff6ff" strokeWidth="1.5" />
        <circle className={styles.bubble} cx="56" cy="100" r="3" fill="none" stroke="#dff6ff" strokeWidth="1.5" />
      </svg>
      <svg className={styles.decoReef} style={{ right: "3%" }} viewBox="0 0 190 260" aria-hidden="true">
        <path d="M20 240l20-60h120l12 60z" fill="#5e3018" opacity="0.85" />
        <path d="M86 180V70M86 80l46 30H86" stroke="#a8643a" strokeWidth="6" fill="none" />
        <path d="M88 84l40 26H88z" fill="#e9dcc4" opacity="0.5" />
        <circle cx="60" cy="210" r="7" fill="#04223a" />
        <circle cx="100" cy="210" r="7" fill="#04223a" />
        <circle className={styles.bubble} cx="120" cy="150" r="4" fill="none" stroke="#dff6ff" strokeWidth="1.5" />
      </svg>
    </>
  );
}

function InfoSheet({ lineBet, rounds, rtp, rtpBp, k }: { lineBet: number; rounds: Round[]; rtp: ReturnType<typeof reefExactRtp>; rtpBp: number; k: number }) {
  const [tab, setTab] = useState<"pay" | "lines" | "rules" | "history">("pay");
  const pays: Array<ReefSymbol & keyof typeof REEF_PAYS> = ["pearl", ...REEF_PAY_SYMBOLS];
  return (
    <div className={styles.info}>
      <ReefDefs />
      <div className={styles.tabs} role="tablist">
        {(
          [
            ["pay", "جدول الدفع"],
            ["lines", "الخطوط"],
            ["rules", "القواعد"],
            ["history", "سجلّي"],
          ] as const
        ).map(([key, label]) => (
          <button key={key} type="button" role="tab" aria-selected={tab === key} onClick={() => setTab(key)}>
            {label}
          </button>
        ))}
      </div>

      {tab === "pay" && (
        <>
          <p className="muted">
            ثلاثة رموز متطابقة على خط. المبالغ بالنقاط لرهانك الحالي (رهان الخط = الرهان ÷ <span className="num">{REEF_LINE_COUNT}</span>)، وفي البونص تُضرب
            بالمضاعف.
          </p>
          <div className={styles.payGrid}>
            {pays.map((s) => (
              <div key={s} className={styles.payItem}>
                <ReefSym s={s} className={styles.paySym} />
                <dl>
                  <div>
                    <dt className="num">3</dt>
                    <dd className="num">{formatPoints(reefScalePay(Math.round(REEF_PAYS[s] * lineBet), rtpBp))}</dd>
                  </div>
                </dl>
                <span className={styles.payName}>{REEF_NAMES[s]}</span>
              </div>
            ))}
          </div>
        </>
      )}

      {tab === "lines" && (
        <>
          <p className="muted">
            <span className="num">{REEF_LINE_COUNT}</span> خطوط تلعب دائماً: الصفوف الثلاثة والقطران.
          </p>
          <div className={styles.lineGrid} dir="ltr">
            {REEF_LINES.map((rows, i) => (
              <div key={i} className={styles.mini}>
                <span className="num">{i + 1}</span>
                <div>
                  {Array.from({ length: 9 }, (_, n) => {
                    const row = Math.floor(n / 3);
                    const reel = n % 3;
                    return <i key={n} className={rows[reel] === row ? styles.on : ""} />;
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
            <ReefSym s="pearl" className={styles.introSym} />
            <p>اللؤلؤة WILD تظهر على كل البكرات، وتحل محل أي رمز عدا صندوق الكنز. ثلاث لآلئ على خط تدفع جائزة اللؤلؤة.</p>
          </div>
          <div className={styles.introRow}>
            <ReefSym s="chest" className={styles.introSym} />
            <p>
              ثلاثة صناديق كنز (واحد على كل بكرة) تفتح <span className="num">{REEF_FS.spins}</span> لفّات مجانية، مرة كل{" "}
              <span className="num">{Math.round(rtp.triggerOneIn)}</span> لفّة في المتوسط. يبدأ المضاعف عند{" "}
              <span className="num">×{REEF_FS.startMultiplier}</span>، وبعد كل لفّة مجانية يزيد <span className="num">{REEF_FS.step}</span> عن كل صندوق ظهر
              فيها، حتى <span className="num">×{REEF_FS.maxMultiplier}</span>.
            </p>
          </div>
          <p>
            إعادة التفعيل: ثلاثة صناديق داخل البونص تضيف <span className="num">{REEF_FS.retriggerSpins}</span> لفّات، ما دام مجموع لفّات البونص لا يتجاوز{" "}
            <span className="num">{REEF_FS.maxTotalSpins}</span>. متوسط البونص <span className="num">{rtp.avgFreeSpins.toFixed(1)}</span> لفّة بمضاعف متوسط{" "}
            <span className="num">×{rtp.avgMultiplier.toFixed(1)}</span>.
          </p>
          <p>
            العائد النظري للعبة <span className="num">{(rtp.rtpValue * k * 100).toFixed(2)}%</span> لكل اللاعبين، محسوب بالضبط من البكرات وجدول الدفع وليس
            بالمحاكاة: <span className="num">{(rtp.baseValue * k * 100).toFixed(2)}%</span> من اللفّات العادية و
            <span className="num">{(rtp.freeValue * k * 100).toFixed(2)}%</span> من البونص. نسبة اللفّات الرابحة{" "}
            <span className="num">{(PAR.base_hit_frequency * 100).toFixed(1)}%</span>.
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
                  <th>الرهان</th>
                  <th>العائد</th>
                </tr>
              </thead>
              <tbody>
                {rounds.slice(0, 20).map((r) => (
                  <tr key={`${r.serverSeedHash}:${r.nonce}`}>
                    <td>
                      <span className="num">{r.nonce}</span>
                    </td>
                    <td>{r.outcome.freeSpins.length > 0 ? `لفّة + ${r.outcome.freeSpins.length} مجانية` : "لفّة"}</td>
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
