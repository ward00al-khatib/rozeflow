"use client";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { DemoFairness } from "@/components/DemoFairness";
import { useSpaceKey } from "@/components/game/BetControls";
import { BarStatus, ControlBar, type PrimaryAction } from "@/components/game/ControlBar";
import { GameFrame, ResultStrip } from "@/components/game/GameFrame";
import { WinBanner } from "@/components/game/WinBanner";
import ui from "@/components/game/stage.module.css";
import { RtpHistory } from "@/components/RtpHistory";
import { useDemoSession, type DemoRound, type OpenRound } from "@/lib/demo/session";
import { useServerMines } from "@/lib/server/games";
import { fmtRtp, useLiveConfig } from "@/lib/server/gameConfig";
import type { RoundView, ServerRound } from "@/lib/server/rounds";
import { playsReal, useMember } from "@/lib/useMember";
import {
  MINES_CONFIG,
  MINES_SCALE,
  applyPick,
  maxPicks,
  minePositions,
  minesMultiplier,
  replayMines,
  settleMines,
  validateMinesBet,
  type MinesBet,
  type MinesOutcome,
  type MinesState,
} from "@/lib/games/mines";
import { formatPoints } from "@/lib/points";
import { playSound } from "@/lib/sound";
import { resultTone } from "@/lib/winTier";
import styles from "./mines.module.css";

const fmtMult = (m: number) => (m / MINES_SCALE).toFixed(4).replace(/0+$/, "").replace(/\.$/, "") + "×";
const PRESETS = [1, 3, 5, 10, 20];

type Round = DemoRound<MinesBet, MinesOutcome>;

function Gem() {
  return (
    <svg viewBox="0 0 48 48" aria-hidden="true" className={`${styles.icon} ${styles.gemIcon}`}>
      <defs>
        <linearGradient id="mn-gem" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#c9ffe6" />
          <stop offset="0.45" stopColor="#3ecf8e" />
          <stop offset="1" stopColor="#0e7a4c" />
        </linearGradient>
      </defs>
      <path d="M12 8h24l9 11-21 23L3 19z" fill="url(#mn-gem)" />
      <path d="M12 8h24l-5 11H17z" fill="#eafff4" opacity="0.75" />
      <path d="M3 19h42M17 19l7 23 7-23" stroke="#0a5a37" strokeOpacity="0.45" strokeWidth="1.2" fill="none" />
      <path className={styles.glint} d="M38 4l1.6 4.4L44 10l-4.4 1.6L38 16l-1.6-4.4L32 10l4.4-1.6z" fill="#fff" />
    </svg>
  );
}

function Mine() {
  return (
    <svg viewBox="0 0 48 48" aria-hidden="true" className={styles.icon}>
      <defs>
        <radialGradient id="mn-mine" cx="38%" cy="32%" r="70%">
          <stop offset="0" stopColor="#8f9bb8" />
          <stop offset="0.5" stopColor="#3a4566" />
          <stop offset="1" stopColor="#141a2c" />
        </radialGradient>
      </defs>
      <path d="M24 3v8M24 39v6M3 25h8M37 25h8M9 10l6 6M39 10l-6 6M9 40l6-6M39 40l-6-6" stroke="#5b6788" strokeWidth="4" strokeLinecap="round" />
      <circle cx="24" cy="25" r="14" fill="url(#mn-mine)" stroke="#0a0f1d" strokeWidth="1" />
      <circle cx="19" cy="20" r="3.4" fill="#fff" opacity="0.55" />
      <circle className={styles.fuse} cx="24" cy="25" r="4" fill="#ff8a1f" />
    </svg>
  );
}

export default function MinesPage() {
  const demo = useDemoSession();
  const member = useMember();
  // Members play on the server with the real wallet; visitors play the demo in the browser.
  const real = playsReal(member);
  const server = useServerMines(real ? member.profile.user_id : null);
  const { config, refresh: refreshConfig } = useLiveConfig("mines", MINES_CONFIG);
  const liveRtp = config.payout_model.target_rtp_bp;
  const ready = member.status !== "loading" && (real ? server.ready : demo.ready);
  const [serverOpen, setServerOpen] = useState<RoundView | null>(null); // the open round as the server reports it
  const [waiting, setWaiting] = useState(false);
  const [mines, setMines] = useState(3);
  const [stake, setStake] = useState(1000);
  const [turbo, setTurbo] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [last, setLast] = useState<Round | null>(null);

  const { min: minMines, max: maxMines } = MINES_CONFIG.rules.mines;
  const { min, max } = MINES_CONFIG.stake_limits;
  const open: OpenRound<MinesBet, MinesState> | null = real
    ? serverOpen && {
        game: "mines",
        nonce: Number(serverOpen.nonce),
        serverSeedHash: serverOpen.server_seed_hash,
        clientSeed: serverOpen.client_seed,
        bet: { stake: Number(serverOpen.stake), mines: Number(serverOpen.mines_count) },
        stake: Number(serverOpen.stake),
        state: { picks: (serverOpen.picks as number[]) ?? [], status: "playing" },
        at: 0,
      }
    : demo.open?.game === "mines"
      ? (demo.open as OpenRound<MinesBet, MinesState>)
      : null;
  // An open round keeps the RTP it started with, even if the owner changes it meanwhile.
  const rtpBp = real && serverOpen?.rtp_bp ? serverOpen.rtp_bp : liveRtp;
  const playing = open !== null;
  const bet = open?.bet ?? { stake, mines };
  const picks = open?.state.picks ?? [];
  const k = picks.length;
  const limit = maxPicks(bet.mines, rtpBp);
  const current = k > 0 ? minesMultiplier(bet.mines, k, rtpBp) : null;
  const next = k < limit ? minesMultiplier(bet.mines, k + 1, rtpBp) : null;
  const cashValue = current ? Math.floor((bet.stake * current) / MINES_SCALE) : 0;

  // Mine tiles are known to this browser only in demo mode; on the server they stay hidden until the round ends.
  const shownOutcome = !playing ? last?.outcome : null;

  // A reload in the middle of a real round picks it up again.
  const resume = server.resume;
  useEffect(() => {
    if (real && server.ready) void resume().then(setServerOpen, () => undefined);
  }, [real, server.ready, resume]);

  /** One step of a real round: the server answers with the open round, or with the settled one. */
  function step(rpc: string, args: Record<string, unknown>, keyed: boolean, sound: (r: Round | null) => void) {
    if (waiting) return;
    setWaiting(true);
    setError(null);
    server
      .call(rpc, args, keyed)
      .then(({ view, round }) => {
        sound(round);
        if (round) {
          setServerOpen(null);
          setLast(round);
          refreshConfig();
        } else setServerOpen(view);
      })
      .catch((e) => {
        setError(e instanceof Error ? e.message : "تعذّر الاتصال.");
        // The answer may have been lost on the way: ask the server where the round stands.
        void resume().then(setServerOpen, () => undefined);
      })
      .finally(() => setWaiting(false));
  }

  function start() {
    setError(null);
    setLast(null);
    try {
      validateMinesBet(bet);
      if (real) {
        if (bet.stake > server.balance) throw new Error("رصيدك لا يكفي لهذه الجولة.");
        step("mines_start", { p_stake: bet.stake, p_mines: bet.mines }, true, () => playSound("start"));
        return;
      }
      demo.begin<MinesBet, MinesState>("mines", bet, bet.stake, { picks: [], status: "playing" });
      playSound("start");
    } catch (e) {
      setError(e instanceof Error ? e.message : "تعذّر البدء.");
    }
  }

  function settle(state: MinesState, round: OpenRound<MinesBet, MinesState>, mineTiles: number[]) {
    const outcome = settleMines(state, mineTiles, round.bet, rtpBp);
    demo.finish(outcome, outcome.gross);
    const { state: _s, ...rest } = round;
    void _s;
    setLast({ ...rest, outcome, gross: outcome.gross });
  }

  function pick(tile: number) {
    if (!open) return;
    if (real) {
      if (picks.includes(tile)) return;
      step("mines_pick", { p_tile: tile }, false, (r) =>
        playSound(!r ? "pop" : r.outcome.status === "busted" ? "lose" : "cashout"),
      );
      return;
    }
    setError(null);
    try {
      const mineTiles = minePositions(demo.openSeeds(), open.bet.mines);
      const s = applyPick(open.state, tile, mineTiles, open.bet, rtpBp);
      if (s.status === "busted") playSound("lose");
      else if (s.status === "cashed") playSound("cashout");
      else playSound("pop");
      if (s.status === "playing") demo.updateOpen(s);
      else settle(s, open, mineTiles);
    } catch (e) {
      setError(e instanceof Error ? e.message : "تعذّر الاختيار.");
    }
  }

  function pickRandom() {
    const free = Array.from({ length: 25 }, (_, t) => t).filter((t) => !picks.includes(t));
    if (free.length) pick(free[Math.floor(Math.random() * free.length)]);
  }

  function cashOut() {
    if (!open || k === 0) return;
    if (real) {
      step("mines_cashout", {}, false, () => playSound("cashout"));
      return;
    }
    try {
      const mineTiles = minePositions(demo.openSeeds(), open.bet.mines);
      playSound("cashout");
      settle({ ...open.state, status: "cashed" }, open, mineTiles);
    } catch (e) {
      setError(e instanceof Error ? e.message : "تعذّر التحصيل.");
    }
  }

  const primary: PrimaryAction = !playing
    ? { kind: "play", label: "ابدأ الجولة", onClick: start, disabled: !ready || waiting, busy: waiting }
    : { kind: "cash", label: k === 0 ? "اكشف خانة" : "حصّل", sub: k === 0 ? undefined : formatPoints(cashValue), onClick: cashOut, disabled: k === 0 || waiting };
  useSpaceKey(() => !primary.disabled && primary.onClick(), true);

  const allRounds = real ? server.rounds : demo.rounds;
  const rounds = useMemo(() => allRounds.filter((r): r is Round => r.game === "mines"), [allRounds]);
  const setMinesSafe = (m: number) => {
    playSound("click");
    setMines(Math.min(maxMines, Math.max(minMines, m)));
  };

  const stage = (
    <>
      <ResultStrip
        items={rounds.slice(0, 14).map((r) => ({
          key: `${r.serverSeedHash}:${r.nonce}`,
          label: r.outcome.status === "cashed" ? fmtMult(r.outcome.multiplier) : "0×",
          tone: resultTone(r.gross, r.stake),
        }))}
      />
      <WinBanner id={last ? `${last.serverSeedHash}:${last.nonce}` : null} gross={last?.gross ?? 0} stake={last?.stake ?? 1} />

      <div className={styles.center}>
        <div className={styles.meter} aria-live="polite">
          {playing ? (
            <>
              <span>
                <small>الحالي</small>
                <span className={`num ${styles.mult}`}>{current ? fmtMult(current) : "1×"}</span>
              </span>
              <span>
                <small>الخانة التالية</small>
                <span className="num">{next ? fmtMult(next) : "—"}</span>
              </span>
              <span>
                <small>آمنة مكشوفة</small>
                <span className="num">
                  {k}/{limit}
                </span>
              </span>
            </>
          ) : shownOutcome && last ? (
            shownOutcome.status === "cashed" ? (
              <span className={ui.win}>
                حصّلت <span className="num">{fmtMult(shownOutcome.multiplier)}</span>
              </span>
            ) : (
              <span className={ui.loss}>
                لغم بعد <span className="num">{shownOutcome.picks.length - 1}</span> خانات آمنة
              </span>
            )
          ) : (
            <span className="muted">
              أول خانة <span className="num">{fmtMult(minesMultiplier(mines, 1, rtpBp))}</span> · الأقصى{" "}
              <span className="num">{fmtMult(minesMultiplier(mines, maxPicks(mines, rtpBp), rtpBp))}</span>
            </span>
          )}
        </div>

        <div className={styles.grid} dir="ltr">
          {Array.from({ length: 25 }, (_, t) => {
            const picked = picks.includes(t);
            const isMine = shownOutcome?.mines.includes(t) ?? false;
            const wasPicked = shownOutcome?.picks.includes(t) ?? false;
            let cls = styles.tile;
            let content: ReactNode = null;
            let delay = 0;
            if (playing && picked) {
              cls += ` ${styles.safe} ${styles.flip}`;
              content = <Gem />;
            } else if (shownOutcome) {
              delay = wasPicked || turbo ? 0 : 60 + ((t * 7) % 25) * 22;
              if (isMine) {
                cls += ` ${styles.mine} ${wasPicked ? styles.hitMine : ""} ${styles.flip}`;
                content = <Mine />;
              } else {
                cls += ` ${wasPicked ? styles.safe : styles.ghost} ${styles.flip}`;
                content = <Gem />;
              }
            } else if (playing) {
              cls += ` ${styles.live}`;
            }
            return (
              <button
                key={t}
                type="button"
                className={cls}
                style={delay ? { animationDelay: `${delay}ms` } : undefined}
                disabled={!playing || picked}
                onClick={() => pick(t)}
                aria-label={`خانة ${t + 1}`}
              >
                {content}
              </button>
            );
          })}
        </div>
      </div>

      <div className={ui.options}>
        <div className={ui.group}>
          <span className={ui.groupLabel}>الألغام</span>
          <div className={ui.field}>
            <button type="button" className={styles.step} onClick={() => setMinesSafe(mines - 1)} disabled={playing || mines <= minMines} aria-label="ألغام أقل">
              −
            </button>
            <span className={`num ${styles.count}`}>{bet.mines}</span>
            <button type="button" className={styles.step} onClick={() => setMinesSafe(mines + 1)} disabled={playing || mines >= maxMines} aria-label="ألغام أكثر">
              +
            </button>
          </div>
          <div className={ui.seg} role="radiogroup" aria-label="عدد سريع">
            {PRESETS.map((m) => (
              <button key={m} type="button" role="radio" aria-checked={mines === m} disabled={playing} onClick={() => setMinesSafe(m)}>
                <span className="num">{m}</span>
              </button>
            ))}
          </div>
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
        ) : playing ? (
          <BarStatus win={cashValue || null} label="قيمة التحصيل" hint="اكشف خانة آمنة" />
        ) : (
          <BarStatus
            win={last && last.gross > 0 ? last.gross : null}
            hint={
              <>
                <span className="num">{mines}</span> ألغام · <span className="num">{25 - mines}</span> خانة آمنة
              </>
            }
          />
        )
      }
      stake={bet.stake}
      onStake={setStake}
      min={min}
      max={max}
      locked={playing}
      extra={
        <button type="button" className={ui.small} onClick={pickRandom} disabled={!playing} title="اكشف خانة عشوائية">
          عشوائي
        </button>
      }
      turbo={turbo}
      onTurbo={() => setTurbo((t) => !t)}
      auto={{
        running: false,
        left: 0,
        net: 0,
        onStart: () => {},
        onStop: () => {},
        unavailable: "اللعب التلقائي غير متاح هنا لأن كل خانة تختارها بنفسك",
      }}
      primary={primary}
    />
  );

  return (
    <GameFrame
      title="الألغام"
      music="mines"
      tint="#3ecf8e"
      real={real}
      device={member.status === "member" ? member.device : undefined}
      agent={member.status === "member" && member.agent}
      onReset={demo.reset}
      resetDisabled={playing}
      stage={stage}
      panel={panel}
      rules={
        <>
          <p>
            في اللوحة <span className="num">25</span> خانة، بينها عدد الألغام الذي تختاره (من <span className="num">{minMines}</span> إلى{" "}
            <span className="num">{maxMines}</span>). كل خانة آمنة تكشفها ترفع المضاعف، ويمكنك التحصيل في أي وقت. إن كشفت لغماً تنتهي الجولة.
          </p>
          <p>
            المضاعف محسوب من الاحتمال الحقيقي للوصول إلى تلك الخانة، والعائد النظري لأي نقطة توقف <span className="num">{fmtRtp(liveRtp)}%</span> لكل اللاعبين. أعلى
            مضاعف <span className="num">1,000×</span>.
          </p>
          <p>زر «عشوائي» يكشف خانة لم تُكشف بعد. مواقع الألغام تُحدَّد من البذور قبل أول اختيار ويمكنك التحقق منها بعد الجولة.</p>
          <RtpHistory gameId="mines" />
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
                    <th>الألغام</th>
                    <th>النتيجة</th>
                    <th>الصافي</th>
                  </tr>
                </thead>
                <tbody>
                  {rounds.slice(0, 12).map((r) => (
                    <tr key={`${r.serverSeedHash}:${r.nonce}`}>
                      <td className="num">{r.nonce}</td>
                      <td className="num">{r.bet.mines}</td>
                      <td>{r.outcome.status === "cashed" ? <span className="num">{fmtMult(r.outcome.multiplier)}</span> : "لغم"}</td>
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
            game="mines"
            verify={(seeds, round) => {
              const r = round as Round;
              const o = replayMines(seeds, r.bet, r.outcome.picks, (r as ServerRound<MinesBet, MinesOutcome>).rtpBp ?? liveRtp);
              return `الألغام في الخانات ${o.mines.map((t) => t + 1).join("، ")} ← ${o.status === "cashed" ? fmtMult(o.multiplier) : "لغم"}`;
            }}
          />
        </>
      }
    />
  );
}
