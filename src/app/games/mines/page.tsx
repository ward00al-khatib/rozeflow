"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { DemoFairness } from "@/components/DemoFairness";
import { Shell } from "@/components/Shell";
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
import { useMember } from "@/lib/useMember";
import styles from "./mines.module.css";

const fmtMult = (m: number) => (m / MINES_SCALE).toFixed(4).replace(/0+$/, "").replace(/\.$/, "") + "×";

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
  const member = useMember();
  const demo = useDemoSession();
  const [mines, setMines] = useState(3);
  const [stakeText, setStakeText] = useState("10");
  const [error, setError] = useState<string | null>(null);
  const [last, setLast] = useState<DemoRound<MinesBet, MinesOutcome> | null>(null);

  const open = demo.open?.game === "mines" ? (demo.open as OpenRound<MinesBet, MinesState>) : null;
  const playing = open !== null;
  const bet = open?.bet ?? { stake: Math.round(Number(stakeText) * 100), mines };
  const picks = open?.state.picks ?? [];
  const k = picks.length;
  const limit = maxPicks(bet.mines);
  const current = k > 0 ? minesMultiplier(bet.mines, k) : null;
  const next = k < limit ? minesMultiplier(bet.mines, k + 1) : null;

  // Mine tiles are known to this browser only in demo mode; on the server they stay hidden until the round ends.
  const shownOutcome = !playing ? last?.outcome : null;

  function start() {
    setError(null);
    setLast(null);
    try {
      validateMinesBet(bet);
      demo.begin<MinesBet, MinesState>("mines", bet, bet.stake, { picks: [], status: "playing" });
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
      if (s.status === "playing") demo.updateOpen(s);
      else settle(s, open, mineTiles);
    } catch (e) {
      setError(e instanceof Error ? e.message : "تعذّر الاختيار.");
    }
  }

  function cashOut() {
    if (!open) return;
    try {
      const mineTiles = minePositions(demo.openSeeds(), open.bet.mines);
      settle({ ...open.state, status: "cashed" }, open, mineTiles);
    } catch (e) {
      setError(e instanceof Error ? e.message : "تعذّر التحصيل.");
    }
  }

  const mineOptions = useMemo(
    () => Array.from({ length: MINES_CONFIG.rules.mines.max - MINES_CONFIG.rules.mines.min + 1 }, (_, i) => i + 1),
    [],
  );

  const rounds = demo.rounds.filter((r): r is DemoRound<MinesBet, MinesOutcome> => r.game === "mines");

  return (
    <Shell member={member}>
      <div className={styles.page}>
        <div className={styles.titleRow}>
          <h1 className={styles.title}>الألغام</h1>
          <span className={styles.demoBadge}>وضع تجريبي</span>
        </div>
        <p className="muted">
          اكشف خانات آمنة لترفع المضاعف، وحصّل متى شئت. إن كشفت لغماً تنتهي الجولة. مواقع الألغام تُحدَّد من البذور قبل أول اختيار،
          والعائد النظري لأي نقطة توقف <span className="num">99%</span>.
        </p>

        <section className={styles.board}>
          <div className={styles.status} aria-live="polite">
            {playing ? (
              <>
                <span className={styles.statusLabel}>المضاعف الحالي</span>
                <span className={`num ${styles.mult}`}>{current ? fmtMult(current) : "—"}</span>
                {next && (
                  <span className="muted">
                    الخانة التالية: <span className="num">{fmtMult(next)}</span>
                  </span>
                )}
              </>
            ) : shownOutcome && last ? (
              shownOutcome.status === "cashed" ? (
                <span className={styles.win}>
                  حصّلت <span className="num">{fmtMult(shownOutcome.multiplier)}</span> · الصافي{" "}
                  <span className="num">
                    {last.gross >= last.stake ? "+" : "-"}
                    {formatPoints(Math.abs(last.gross - last.stake))}
                  </span>
                </span>
              ) : (
                <span className={styles.loss}>
                  لغم بعد <span className="num">{shownOutcome.picks.length - 1}</span> خانات آمنة{" "}
                  <span className="num">-{formatPoints(last.stake)}</span>
                </span>
              )
            ) : (
              <span className="muted">اختر عدد الألغام وقيمة الدخول، ثم ابدأ.</span>
            )}
          </div>

          <div className={styles.grid} dir="ltr">
            {Array.from({ length: 25 }, (_, t) => {
              const picked = picks.includes(t);
              const isMine = shownOutcome?.mines.includes(t) ?? false;
              const wasPicked = shownOutcome?.picks.includes(t) ?? false;
              let cls = styles.tile;
              let content: React.ReactNode = null;
              if (playing && picked) {
                cls += ` ${styles.safe}`;
                content = <Gem />;
              } else if (shownOutcome) {
                if (isMine) {
                  cls += ` ${styles.mine} ${wasPicked ? styles.hitMine : ""}`;
                  content = <Mine />;
                } else {
                  cls += ` ${wasPicked ? styles.safe : styles.ghost}`;
                  content = <Gem />;
                }
              }
              return (
                <button
                  key={t}
                  type="button"
                  className={cls}
                  disabled={!playing || picked}
                  onClick={() => pick(t)}
                  aria-label={`خانة ${t + 1}`}
                >
                  {content}
                </button>
              );
            })}
          </div>
        </section>

        <section className={styles.controls}>
          {playing ? (
            <>
              <p className="muted">
                قيمة الدخول <span className="num">{formatPoints(bet.stake)}</span> · الألغام <span className="num">{bet.mines}</span> · خانات آمنة
                مكشوفة <span className="num">{k}</span>
              </p>
              <button type="button" className={`btn-primary ${styles.wide}`} onClick={cashOut} disabled={k === 0}>
                {k === 0 ? (
                  "اكشف خانة أولاً"
                ) : (
                  <>
                    حصّل <span className="num">{formatPoints(Math.floor((bet.stake * current!) / MINES_SCALE))}</span>
                  </>
                )}
              </button>
            </>
          ) : (
            <>
              <div className={styles.row}>
                <div className="field">
                  <label htmlFor="mines">عدد الألغام</label>
                  <select id="mines" className="input num" value={mines} onChange={(e) => setMines(Number(e.target.value))}>
                    {mineOptions.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="stake">
                    قيمة الدخول (<span className="num">{MINES_CONFIG.stake_limits.min / 100}</span>–
                    <span className="num">{formatPoints(MINES_CONFIG.stake_limits.max)}</span>)
                  </label>
                  <input
                    id="stake"
                    className="input num"
                    inputMode="decimal"
                    value={stakeText}
                    onChange={(e) => setStakeText(e.target.value.replace(/[^0-9.]/g, ""))}
                  />
                </div>
              </div>
              <p className="muted">
                أول خانة آمنة: <span className="num">{fmtMult(minesMultiplier(mines, 1))}</span> · أقصى ما يمكن:{" "}
                <span className="num">{fmtMult(minesMultiplier(mines, maxPicks(mines)))}</span> بعد{" "}
                <span className="num">{maxPicks(mines)}</span> خانات
              </p>
              <button type="button" className={`btn-primary ${styles.wide}`} onClick={start} disabled={!demo.ready}>
                ابدأ الجولة
              </button>
            </>
          )}
          {error && <p className="error">{error}</p>}

          <div className={styles.balance}>
            <span>الرصيد التجريبي</span>
            <span className="num">{formatPoints(demo.balance)}</span>
            {!playing && (
              <button type="button" className={styles.linkButton} onClick={demo.reset}>
                إعادة إلى <span className="num">1,000</span>
              </button>
            )}
          </div>
        </section>

        {rounds.length > 0 && (
          <section className={styles.controls}>
            <h2 className={styles.h2}>آخر الجولات</h2>
            <div className={styles.recent} dir="ltr">
              {rounds.slice(0, 14).map((r) => (
                <span key={`${r.serverSeedHash}:${r.nonce}`} className={`num ${r.outcome.status === "cashed" ? styles.win : styles.loss}`}>
                  {r.outcome.status === "cashed" ? fmtMult(r.outcome.multiplier) : "0×"}
                </span>
              ))}
            </div>
          </section>
        )}

        <DemoFairness
          demo={demo}
          game="mines"
          verify={(seeds, round) => {
            const r = round as DemoRound<MinesBet, MinesOutcome>;
            const o = replayMines(seeds, r.bet, r.outcome.picks);
            return `الألغام في الخانات ${o.mines.map((t) => t + 1).join("، ")} ← ${o.status === "cashed" ? fmtMult(o.multiplier) : "لغم"}`;
          }}
        />

        <p className="muted">
          <Link href="/">← كل الألعاب</Link>
        </p>
      </div>
    </Shell>
  );
}
