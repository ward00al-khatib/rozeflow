"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DemoFairness } from "@/components/DemoFairness";
import { useAutoPlay, useSpaceKey } from "@/components/game/BetControls";
import { BarStatus, ControlBar } from "@/components/game/ControlBar";
import { GameFrame, ResultStrip } from "@/components/game/GameFrame";
import { WinBanner } from "@/components/game/WinBanner";
import { useServerBolt } from "@/lib/server/games";
import { useLiveConfig } from "@/lib/server/gameConfig";
import type { ServerRound } from "@/lib/server/rounds";
import { playsReal, useMember } from "@/lib/useMember";
import { useDemoSession, type DemoRound } from "@/lib/demo/session";
import {
  BOLT_CONFIG,
  BOLT_FS,
  BOLT_LINES,
  BOLT_LINE_COUNT,
  BOLT_PAYS,
  BOLT_PAY_SYMBOLS,
  boltExactRtp,
  boltScalePay,
  boltSpinsFor,
  boltWindow,
  playBolt,
  validateBoltStake,
  type BoltBet,
  type BoltOutcome,
  type BoltSpin,
  type BoltSymbol,
} from "@/lib/games/bolt";
import { formatPoints } from "@/lib/points";
import { playSound } from "@/lib/sound";
import { resultTone } from "@/lib/winTier";
import { LINE_COLORS, Reels } from "./Reels";
import { Robot, type RobotMood } from "./Robot";
import { boltSfx } from "./sfx";
import { BOLT_NAMES, BoltDefs, BoltSym } from "./symbols";
import styles from "./bolt.module.css";

type Round = DemoRound<BoltBet, BoltOutcome>;
type Phase = "idle" | "spinning" | "fsIntro" | "fsSpinning" | "fsOutro";

const START = boltWindow([0, 8, 16, 24, 4]);
const INTRO_KEY = "rozeflow:bolt:intro-seen";
const PAR = BOLT_CONFIG.payout_model.par;
const NAME = "بُرغي الصغير";
const CHATTER = ["بيب بوب!", "أنا بُرغي!", "هيا نلفّ!", "أحب الخردة اللامعة", "بطاريتي جاهزة ⚡", "ابحث عن نواة الطاقة!", "بييييب؟", "صديقي الإنسان 🤖"];

export default function BoltPage() {
  const demo = useDemoSession();
  const member = useMember();
  // Members play on the server with the real wallet; visitors play the demo in the browser.
  const real = playsReal(member);
  const server = useServerBolt(real ? member.profile.user_id : null);
  const { config, refresh: refreshConfig } = useLiveConfig("bolt", BOLT_CONFIG);
  const rtpBp = config.payout_model.target_rtp_bp;
  const ready = member.status !== "loading" && (real ? server.ready : demo.ready);
  const [waiting, setWaiting] = useState(false); // sent to the server, answer not here yet
  const rtp = useMemo(() => boltExactRtp(), []);
  const k = rtpBp / 10000 / rtp.rtpValue; // owner-set RTP over the paytable's own
  const [stake, setStake] = useState(1000);
  const [turbo, setTurbo] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [grid, setGrid] = useState<BoltSymbol[][]>(START);
  const [prev, setPrev] = useState<BoltSymbol[][]>(START);
  const [spinKey, setSpinKey] = useState(0);
  const [round, setRound] = useState<Round | null>(null);
  const [current, setCurrent] = useState<BoltSpin | null>(null); // spin on screen once landed
  const [fsIndex, setFsIndex] = useState(-1);
  const [fsWin, setFsWin] = useState(0);
  const [lastWin, setLastWin] = useState(0);
  const [pending, setPending] = useState(0); // gross not yet shown in the balance
  const [activeLine, setActiveLine] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [intro, setIntro] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);
  const [toast, setToast] = useState<{ key: number; text: React.ReactNode } | null>(null);
  const [quickStop, setQuickStop] = useState(0);
  const [mood, setMood] = useState<RobotMood>("idle");
  const [say, setSay] = useState<string | null>(null);
  const [flash, setFlash] = useState(0); // bump for a white power flash over the scene
  const [shake, setShake] = useState(false); // the machine shakes on a huge win
  const timers = useRef<number[]>([]);
  const sayTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    try {
      if (localStorage.getItem(INTRO_KEY) !== "1") setIntro(true);
    } catch {
      setIntro(true);
    }
    const t = timers.current;
    return () => {
      t.forEach((x) => window.clearTimeout(x));
      window.clearTimeout(sayTimer.current);
    };
  }, []);

  const later = (fn: () => void, ms: number) => timers.current.push(window.setTimeout(fn, ms));
  const lineBet = stake / BOLT_LINE_COUNT;
  const busy = phase !== "idle" || waiting;

  function speak(text: string, ms = 1800) {
    setSay(text);
    window.clearTimeout(sayTimer.current);
    sayTimer.current = window.setTimeout(() => setSay(null), ms);
  }

  function poke() {
    boltSfx("talk");
    speak(CHATTER[Math.floor(Math.random() * CHATTER.length)]);
    if (!busy) {
      setMood("talk");
      later(() => setMood((m) => (m === "talk" ? "idle" : m)), 900);
    }
  }

  /** Puts a spin on the reels; the rest happens in `landed`. */
  function show(spin: BoltSpin, from: BoltSymbol[][]) {
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
    const bet: BoltBet = { stake };
    try {
      validateBoltStake(stake);
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
        demo.play("bolt", bet, stake, (seeds) => {
          const outcome = playBolt(seeds, bet, rtpBp);
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
    setMood("spin");
    playSound("start");
    setPhase("spinning");
    show(r.outcome.base, grid);
    return r.gross - r.stake;
  }

  function startFree(r: Round, i: number, from: BoltSymbol[][]) {
    setPhase("fsSpinning");
    setFsIndex(i);
    setMood("spin");
    show(r.outcome.freeSpins[i], from);
  }

  function finish(r: Round) {
    setPhase("idle");
    setPending(0);
    setBanner(`${r.serverSeedHash}:${r.nonce}`); // the banner picks the win size, if any
    if (r.gross === 0) {
      playSound("lose");
      setMood("idle");
    } else if (r.gross >= r.stake * 20) {
      setMood("big");
      setShake(true);
      later(() => setShake(false), 900);
      setFlash((n) => n + 1);
      boltSfx("bigWin");
      speak("واااو! ربح ضخم!", 2400);
    } else {
      setMood("win");
      if (r.gross >= r.stake * 5) speak("رائع! 🎉");
    }
    later(() => setMood((m) => (m === "win" || m === "big" ? "idle" : m)), 2600);
  }

  const landed = useCallback(() => {
    if (!round) return;
    const o = round.outcome;
    if (phase === "spinning") {
      const base = o.base;
      setCurrent(base);
      setLastWin(o.baseGross);
      if (base.lineWins.length > 0) {
        boltSfx("line");
        setMood("win");
      }
      if (o.freeSpins.length > 0) {
        setMood("charge");
        speak("نواة طاقة! شحن كامل ⚡", 2600);
        later(() => {
          setPhase("fsIntro");
          setFlash((n) => n + 1);
          boltSfx("bonus");
        }, turbo ? 700 : 1300);
        later(() => startFree(round, 0, base.window), turbo ? 2600 : 4000);
      } else {
        later(() => finish(round), turbo ? 150 : 450);
      }
      return;
    }
    if (phase === "fsSpinning") {
      const spin = o.freeSpins[fsIndex];
      setCurrent(spin);
      const win = boltScalePay(spin.units * lineBet * spin.multiplier, rtpBp);
      if (win > 0) {
        boltSfx("line");
        playSound("win");
        setMood("win");
      }
      setFsWin((w) => w + win);
      let pause = turbo ? 450 : win > 0 ? 1300 : 650;
      if (spin.added > 0) {
        boltSfx("retrigger");
        setFlash((n) => n + 1);
        setToast({
          key: Date.now(),
          text: (
            <>
              <bdi className="num">+{spin.added}</bdi> لفّات إضافية!
            </>
          ),
        });
        speak("طاقة إضافية!");
        pause += turbo ? 600 : 1200;
      } else if (spin.wilds > 0 && spin.multiplier < BOLT_FS.maxMultiplier) {
        boltSfx("charge", spin.wilds);
        setMood("charge");
        const next = Math.min(spin.multiplier + BOLT_FS.step * spin.wilds, BOLT_FS.maxMultiplier);
        setToast({
          key: Date.now(),
          text: (
            <>
              ⚡ شحن <bdi className="num">+{next - spin.multiplier}</bdi> · المضاعف <bdi className="num">×{next}</bdi>
            </>
          ),
        });
        pause += turbo ? 250 : 600;
      }
      const next = fsIndex + 1;
      if (next < o.freeSpins.length) later(() => startFree(round, next, spin.window), pause);
      else
        later(() => {
          setPhase("fsOutro");
          boltSfx("end");
          if (o.freeGross >= round.stake * 10) playSound("bigWin");
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
  const rounds = useMemo(() => allRounds.filter((r): r is Round => r.game === "bolt" && "freeSpins" in (r.outcome as object)), [allRounds]);
  const inFree = phase === "fsIntro" || phase === "fsSpinning" || phase === "fsOutro";
  const wins = current ? current.lineWins.map((w) => ({ line: w.line })) : [];
  const fsSpins = round?.outcome.freeSpins ?? [];
  const fsStart = round ? boltSpinsFor(round.outcome.base.cores) : 0;
  // Spins awarded so far: the first batch, plus every retrigger already shown.
  const fsAwarded = fsStart + fsSpins.slice(0, current && fsIndex >= 0 && current === fsSpins[fsIndex] ? fsIndex + 1 : Math.max(fsIndex, 0)).reduce((s, f) => s + f.added, 0);
  const fsSpin = inFree && fsIndex >= 0 ? fsSpins[fsIndex] : null;
  // Multiplier on screen: the current spin's, and after it lands, the next one's.
  const fsMult = fsSpin
    ? current === fsSpin
      ? Math.min(fsSpin.multiplier + BOLT_FS.step * fsSpin.wilds, BOLT_FS.maxMultiplier)
      : fsSpin.multiplier
    : BOLT_FS.startMultiplier;

  const stage = (
    <div className={`${styles.scene} ${inFree ? styles.sceneFree : ""}`}>
      <BoltDefs />
      <Scrapyard free={inFree} />
      {flash > 0 && <div key={flash} className={styles.flash} aria-hidden="true" />}
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
        <span className={styles.gameName}>
          <span className={styles.nameBolt}>⚙</span> {NAME}
        </span>
        {inFree ? (
          <span className={styles.fsBar}>
            لفّة مجانية{" "}
            <span className="num">
              {Math.max(fsIndex + 1, 0)}/{fsAwarded}
            </span>
            <Battery mult={fsMult} />
          </span>
        ) : (
          <span className={styles.tagline}>
            <span className="num">5×3</span> · <span className="num">{BOLT_LINE_COUNT}</span> خطوط · كل روبوت يشحن المضاعف في البونص
          </span>
        )}
      </div>
      {intro && (
        <div className={`${styles.overlay} ${styles.sceneOverlay}`}>
          <div className={styles.intro}>
            <Robot mood="talk" charge={BOLT_FS.maxMultiplier} max={BOLT_FS.maxMultiplier} className={styles.introBot} />
            <span className={styles.introName}>{NAME}</span>
            <div className={styles.introCards}>
              <div>
                <span>المضاعف</span>
                <strong className="num">حتى ×{BOLT_FS.maxMultiplier}</strong>
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
              <BoltSym s="bot" className={styles.introSym} />
              <p>بُرغي WILD يحل محل أي رمز عدا نواة الطاقة. الخطوط تدفع من اليسار لثلاثة رموز أو أكثر.</p>
            </div>
            <div className={styles.introRow}>
              <BoltSym s="core" className={styles.introSym} />
              <p>
                ثلاث نوى طاقة أو أكثر تفتح <span className="num">{boltSpinsFor(3)}</span> أو <span className="num">{boltSpinsFor(4)}</span> أو{" "}
                <span className="num">{boltSpinsFor(5)}</span> لفّة مجانية. في البونص كل روبوت يشحن المضاعف <span className="num">+{BOLT_FS.step}</span>.
              </p>
            </div>
            <button
              type="button"
              className={styles.introGo}
              onClick={() => {
                setIntro(false);
                boltSfx("talk");
                speak("أهلاً! أنا بُرغي 🤖");
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
      <div className={styles.stageRow}>
        <Robot mood={mood} charge={inFree ? fsMult : 0} max={BOLT_FS.maxMultiplier} say={say} onPoke={poke} className={styles.heroSide} />
        <div className={`${styles.machine} ${shake ? styles.shake : ""} ${inFree ? styles.machineFree : ""}`}>
          <span className={styles.lamps} aria-hidden="true">
            {Array.from({ length: 9 }, (_, i) => (
              <i key={i} style={{ animationDelay: `${i * 0.12}s` }} />
            ))}
          </span>
          <Reels
            window={grid}
            previous={prev}
            spinKey={spinKey}
            quickStop={quickStop}
            turbo={turbo}
            onStopped={landed}
            wins={wins}
            activeLine={activeLine}
            dim={!!current && (current.lineWins.length > 0 || (inFree ? current.cores >= BOLT_FS.retrigger : current.cores >= BOLT_FS.trigger))}
            coreHit={!!current && (inFree ? current.cores >= BOLT_FS.retrigger : current.cores >= BOLT_FS.trigger)}
            charging={phase === "fsSpinning" && !!current && current.multiplier < BOLT_FS.maxMultiplier}
          />
          {current && current.lineWins.length > 0 && phase !== "fsIntro" && phase !== "fsOutro" && (
            <div className={styles.lineAmounts} dir="ltr">
              {current.lineWins
                .filter((w) => activeLine === null || w.line === activeLine)
                .slice(0, activeLine === null ? 3 : 1)
                .map((w) => (
                  <span key={w.line} className="num" style={{ borderColor: LINE_COLORS[w.line % LINE_COLORS.length] }}>
                    {formatPoints(boltScalePay(w.units * lineBet * current.multiplier, rtpBp))}
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
              <div className={`${styles.fsCard} ${styles.surge}`}>
                <BoltSym s="core" className={styles.fsIcon} />
                <strong>شحن البطارية!</strong>
                <span className={`num ${styles.fsBig}`}>{fsStart}</span>
                <span>لفّات مجانية. كل روبوت يظهر يشحن المضاعف +1 حتى ×{BOLT_FS.maxMultiplier}، وثلاث نوى طاقة تعطيك لفّات إضافية.</span>
              </div>
            </div>
          )}
          {phase === "fsOutro" && round && (
            <div className={styles.overlay}>
              <div className={styles.fsCard}>
                <strong>انتهى الشحن</strong>
                <span className={`num ${styles.fsBig}`}>{formatPoints(round.outcome.freeGross)}</span>
                <span className="muted">
                  من <span className="num">{fsSpins.length}</span> لفّة مجانية
                </span>
              </div>
            </div>
          )}
          <WinBanner id={banner} gross={round?.gross ?? 0} stake={round?.stake ?? 1} />
        </div>
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
      min={BOLT_CONFIG.stake_limits.min}
      max={BOLT_CONFIG.stake_limits.max}
      multipleOf={BOLT_CONFIG.stake_limits.multiple_of}
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
      music="bolt"
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
          game="bolt"
          verify={(seeds, r) => {
            const bet = r.bet as BoltBet;
            const o = playBolt(seeds, bet, (r as ServerRound<BoltBet, BoltOutcome>).rtpBp ?? rtpBp);
            return `مواضع البكرات ${o.base.stops.join("، ")}، لفّات مجانية ${o.freeSpins.length} ← العائد ${formatPoints(o.gross)}`;
          }}
        />
      }
    />
  );
}

/** The free-spin multiplier as a battery that fills one cell per charge, up to the maximum. */
function Battery({ mult }: { mult: number }) {
  const cells = BOLT_FS.maxMultiplier;
  return (
    <span className={styles.battery} aria-label={`المضاعف ×${mult}`}>
      <span className={styles.batteryBody}>
        {Array.from({ length: cells }, (_, i) => (
          <i key={i} className={i < mult ? (mult >= cells ? styles.cellFull : styles.cellOn) : undefined} />
        ))}
      </span>
      <span key={mult} className={`num ${styles.batteryMult}`}>
        ×{mult}
      </span>
    </span>
  );
}

/**
 * The scrapyard at dusk behind the machine: a big sky, twinkling stars, piles of scrap with a crane,
 * a conveyor belt, drifting sparks and a little drone. Fixed positions so the pre-rendered page matches.
 */
function Scrapyard({ free }: { free: boolean }) {
  const stars = [
    [6, 8, 1.5, 0],
    [14, 22, 1, 1.2],
    [23, 6, 1.2, 2.1],
    [35, 16, 1, 0.6],
    [47, 5, 1.4, 1.8],
    [58, 19, 1, 2.6],
    [66, 9, 1.6, 0.3],
    [77, 24, 1, 1.4],
    [86, 7, 1.3, 2.2],
    [94, 17, 1, 0.9],
    [41, 28, 1, 3],
    [71, 30, 1.2, 1.1],
  ];
  const sparks = [
    [8, 0, 9],
    [19, 3, 11],
    [31, 6, 10],
    [52, 1.5, 12],
    [63, 4.5, 9.5],
    [74, 7, 11],
    [88, 2.5, 10],
    [96, 5.5, 12],
  ];
  return (
    <div className={`${styles.yard} ${free ? styles.yardFree : ""}`} aria-hidden="true">
      <div className={styles.sky} />
      {stars.map(([x, y, r, d], i) => (
        <i key={i} className={styles.star} style={{ left: `${x}%`, top: `${y}%`, width: r * 2, height: r * 2, animationDelay: `-${d}s` }} />
      ))}
      <div className={styles.moon} />
      <svg className={styles.drone} viewBox="0 0 60 30">
        <path d="M8 8h16M36 8h16" stroke="#8fa0b8" strokeWidth="2.5" strokeLinecap="round" className={styles.prop} />
        <path d="M16 8v6M44 8v6" stroke="#8fa0b8" strokeWidth="2" />
        <rect x="14" y="12" width="32" height="12" rx="6" fill="#e3e9f3" />
        <circle cx="30" cy="18" r="3.5" fill="#3ddcff" />
        <circle cx="30" cy="27" r="2" fill="#ff8a3d" className={styles.blinkDot} />
      </svg>
      <svg className={styles.piles} viewBox="0 0 1200 260" preserveAspectRatio="none">
        <path d="M0 260V170l60-30 50 20 40-50 70 40 40-20 60 50 50-30 40 30v80z" fill="#2a1d3d" />
        <path d="M900 260v-90l50-40 60 30 40-60 50 50 50-10 50 40v80z" fill="#2a1d3d" />
        <path d="M0 260v-50l90-20 70 18 80-30 90 40 70-14 120 24 100-30 80 20 110-26 90 30 90-16 80 22 90-12 70 20v64z" fill="#1c1430" />
        {/* crane */}
        <g stroke="#3b2c55" strokeWidth="6" fill="none">
          <path d="M1040 200V60h-160" />
          <path d="M1040 90l-40-30M1010 60l30 30" strokeWidth="3" />
        </g>
        <g className={styles.craneHook}>
          <path d="M900 60v50" stroke="#3b2c55" strokeWidth="3" />
          <rect x="884" y="108" width="32" height="22" rx="3" fill="#4a3a66" />
        </g>
        {/* lamp post */}
        <path d="M150 210V120h20" stroke="#3b2c55" strokeWidth="5" fill="none" />
        <circle cx="172" cy="124" r="6" fill="#ffd23d" className={styles.lamp} />
      </svg>
      <div className={styles.belt}>
        <span />
      </div>
      {sparks.map(([x, d, dur], i) => (
        <i key={i} className={styles.mote} style={{ left: `${x}%`, animationDelay: `-${d}s`, animationDuration: `${dur}s` }} />
      ))}
    </div>
  );
}

function InfoSheet({ lineBet, rounds, rtp, rtpBp, k }: { lineBet: number; rounds: Round[]; rtp: ReturnType<typeof boltExactRtp>; rtpBp: number; k: number }) {
  const [tab, setTab] = useState<"pay" | "lines" | "rules" | "history">("pay");
  const pays: Array<BoltSymbol & keyof typeof BOLT_PAYS> = ["bot", ...BOLT_PAY_SYMBOLS];
  return (
    <div className={styles.info}>
      <BoltDefs />
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
            رموز متتالية من اليسار على خط. المبالغ بالنقاط لرهانك الحالي (رهان الخط = الرهان ÷ <span className="num">{BOLT_LINE_COUNT}</span>)، وفي البونص
            تُضرب بالمضاعف.
          </p>
          <div className={styles.payGrid}>
            {pays.map((s) => (
              <div key={s} className={styles.payItem}>
                <BoltSym s={s} className={styles.paySym} />
                <dl>
                  {[5, 4, 3].map((n) => (
                    <div key={n}>
                      <dt className="num">{n}</dt>
                      <dd className="num">{formatPoints(boltScalePay(Math.round(BOLT_PAYS[s][n - 3] * lineBet), rtpBp))}</dd>
                    </div>
                  ))}
                </dl>
                <span className={styles.payName}>{BOLT_NAMES[s]}</span>
              </div>
            ))}
          </div>
        </>
      )}

      {tab === "lines" && (
        <>
          <p className="muted">
            <span className="num">{BOLT_LINE_COUNT}</span> خطوط تلعب دائماً، وتُقرأ من البكرة اليسرى.
          </p>
          <div className={styles.lineGrid} dir="ltr">
            {BOLT_LINES.map((rows, i) => (
              <div key={i} className={styles.mini}>
                <span className="num">{i + 1}</span>
                <div>
                  {Array.from({ length: 15 }, (_, n) => {
                    const row = Math.floor(n / 5);
                    const reel = n % 5;
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
            <BoltSym s="bot" className={styles.introSym} />
            <p>
              بُرغي WILD يظهر على كل البكرات ويحل محل أي رمز عدا نواة الطاقة. صفّ من الروبوتات من اليسار يدفع جائزة الروبوت، ويُحسب للخط الأعلى من الجائزتين.
            </p>
          </div>
          <div className={styles.introRow}>
            <BoltSym s="core" className={styles.introSym} />
            <p>
              ثلاث نوى طاقة أو أكثر في أي مكان تفتح البونص: <span className="num">3</span> ← <span className="num">{boltSpinsFor(3)}</span> لفّات،{" "}
              <span className="num">4</span> ← <span className="num">{boltSpinsFor(4)}</span>، <span className="num">5</span> ←{" "}
              <span className="num">{boltSpinsFor(5)}</span>، مرة كل <span className="num">{Math.round(rtp.triggerOneIn)}</span> لفّة في المتوسط.
            </p>
          </div>
          <p>
            المضاعف يبدأ <span className="num">×{BOLT_FS.startMultiplier}</span>، وبعد كل لفّة مجانية يزيد <span className="num">{BOLT_FS.step}</span> عن كل روبوت
            ظهر فيها، حتى <span className="num">×{BOLT_FS.maxMultiplier}</span>. ثلاث نوى داخل البونص تضيف <span className="num">{BOLT_FS.retriggerSpins}</span>{" "}
            لفّات ما دام المجموع لا يتجاوز <span className="num">{BOLT_FS.maxTotalSpins}</span>. متوسط البونص{" "}
            <span className="num">{rtp.avgFreeSpins.toFixed(1)}</span> لفّة بمضاعف متوسط <span className="num">×{rtp.avgMultiplier.toFixed(1)}</span>.
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
