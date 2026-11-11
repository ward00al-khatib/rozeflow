"use client";
import { useMemo, useState, type ReactNode } from "react";
import { DemoFairness } from "@/components/DemoFairness";
import { useSpaceKey } from "@/components/game/BetControls";
import { BarStatus, ControlBar, type PrimaryAction } from "@/components/game/ControlBar";
import { GameFrame, ResultStrip } from "@/components/game/GameFrame";
import { WinBanner } from "@/components/game/WinBanner";
import ui from "@/components/game/stage.module.css";
import { useDemoSession, type DemoRound, type OpenRound } from "@/lib/demo/session";
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
    <svg viewBox="0 0 24 24" aria-hidden="true" className={styles.icon}>
      <path d="M6 4h12l4 6-10 11L2 10z" fill="currentColor" opacity="0.9" />
      <path d="M2 10h20M8.5 4 12 21 15.5 4" stroke="var(--sheet)" strokeWidth="1" fill="none" opacity="0.6" />
    </svg>
  );
}

function Mine() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={styles.icon}>
      <circle cx="12" cy="13" r="7" fill="currentColor" />
      <path d="M12 2v4M12 20v2M3 13H1M23 13h-2M5.5 6.5 4 5M18.5 6.5 20 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export default function MinesPage() {
  const demo = useDemoSession();
  const [mines, setMines] = useState(3);
  const [stake, setStake] = useState(1000);
  const [turbo, setTurbo] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [last, setLast] = useState<Round | null>(null);

  const { min: minMines, max: maxMines } = MINES_CONFIG.rules.mines;
  const { min, max } = MINES_CONFIG.stake_limits;
  const open = demo.open?.game === "mines" ? (demo.open as OpenRound<MinesBet, MinesState>) : null;
  const playing = open !== null;
  const bet = open?.bet ?? { stake, mines };
  const picks = open?.state.picks ?? [];
  const k = picks.length;
  const limit = maxPicks(bet.mines);
  const current = k > 0 ? minesMultiplier(bet.mines, k) : null;
  const next = k < limit ? minesMultiplier(bet.mines, k + 1) : null;
  const cashValue = current ? Math.floor((bet.stake * current) / MINES_SCALE) : 0;

  // Mine tiles are known to this browser only in demo mode; on the server they stay hidden until the round ends.
  const shownOutcome = !playing ? last?.outcome : null;

  function start() {
    setError(null);
    setLast(null);
    try {
      validateMinesBet(bet);
      demo.begin<MinesBet, MinesState>("mines", bet, bet.stake, { picks: [], status: "playing" });
      playSound("start");
    } catch (e) {
      setError(e instanceof Error ? e.message : "تعذّر البدء.");
    }
  }

  function settle(state: MinesState, round: OpenRound<MinesBet, MinesState>, mineTiles: number[]) {
    const outcome = settleMines(state, mineTiles, round.bet);
    demo.finish(outcome, outcome.gross);
    const { state: _s, ...rest } = round;
    void _s;
    setLast({ ...rest, outcome, gross: outcome.gross });
  }

  function pick(tile: number) {
    if (!open) return;
    setError(null);
    try {
      const mineTiles = minePositions(demo.openSeeds(), open.bet.mines);
      const s = applyPick(open.state, tile, mineTiles, open.bet);
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
    try {
      const mineTiles = minePositions(demo.openSeeds(), open.bet.mines);
      playSound("cashout");
      settle({ ...open.state, status: "cashed" }, open, mineTiles);
    } catch (e) {
      setError(e instanceof Error ? e.message : "تعذّر التحصيل.");
    }
  }

  const primary: PrimaryAction = !playing
    ? { kind: "play", label: "ابدأ الجولة", onClick: start, disabled: !demo.ready }
    : { kind: "cash", label: k === 0 ? "اكشف خانة" : "حصّل", sub: k === 0 ? undefined : formatPoints(cashValue), onClick: cashOut, disabled: k === 0 };
  useSpaceKey(() => !primary.disabled && primary.onClick(), true);

  const rounds = useMemo(() => demo.rounds.filter((r): r is Round => r.game === "mines"), [demo.rounds]);
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
              أول خانة <span className="num">{fmtMult(minesMultiplier(mines, 1))}</span> · الأقصى{" "}
              <span className="num">{fmtMult(minesMultiplier(mines, maxPicks(mines)))}</span>
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
      balance={demo.balance}
      status={
        error ? (
          <span className="error">{error}</span>
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
            المضاعف محسوب من الاحتمال الحقيقي للوصول إلى تلك الخانة، والعائد النظري لأي نقطة توقف <span className="num">99%</span>. أعلى
            مضاعف <span className="num">1,000×</span>.
          </p>
          <p>زر «عشوائي» يكشف خانة لم تُكشف بعد. مواقع الألغام تُحدَّد من البذور قبل أول اختيار ويمكنك التحقق منها بعد الجولة.</p>
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
            demo={demo}
            game="mines"
            verify={(seeds, round) => {
              const r = round as Round;
              const o = replayMines(seeds, r.bet, r.outcome.picks);
              return `الألغام في الخانات ${o.mines.map((t) => t + 1).join("، ")} ← ${o.status === "cashed" ? fmtMult(o.multiplier) : "لغم"}`;
            }}
          />
        </>
      }
    />
  );
}
