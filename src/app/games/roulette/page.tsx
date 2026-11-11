"use client";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { DemoFairness } from "@/components/DemoFairness";
import { useAutoPlay, useSpaceKey } from "@/components/game/BetControls";
import { BarStatus, ControlBar } from "@/components/game/ControlBar";
import { GameFrame, ResultStrip } from "@/components/game/GameFrame";
import { WinBanner } from "@/components/game/WinBanner";
import ui from "@/components/game/stage.module.css";
import { useDemoSession, type DemoRound } from "@/lib/demo/session";
import {
  ROULETTE_CONFIG,
  betKey,
  isRed,
  playRoulette,
  totalStake,
  validateBets,
  type RouletteBet,
  type RouletteBetKind,
  type RouletteOutcome,
} from "@/lib/games/roulette";
import { formatPoints } from "@/lib/points";
import { playSound } from "@/lib/sound";
import { resultTone } from "@/lib/winTier";
import styles from "./roulette.module.css";

type Spot = { kind: RouletteBetKind; value?: number; label: string };
type Round = DemoRound<RouletteBet[], RouletteOutcome>;

const OUTSIDE: Spot[] = [
  { kind: "low", label: "1–18" },
  { kind: "even", label: "زوجي" },
  { kind: "red", label: "أحمر" },
  { kind: "black", label: "أسود" },
  { kind: "odd", label: "فردي" },
  { kind: "high", label: "19–36" },
];
const DOZENS: Spot[] = [1, 2, 3].map((v) => ({ kind: "dozen", value: v, label: `${(v - 1) * 12 + 1}–${v * 12}` }));
const COLUMNS: Spot[] = [1, 2, 3].map((v) => ({ kind: "column", value: v, label: "2:1" }));

/** Pocket order on a single-zero wheel, clockwise from zero. */
const WHEEL = [0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26];
const LAPS = 5; // copies of the wheel in the strip
const CELL = 56; // px per pocket in the strip
const SPIN_MS = 2600;
const TURBO_MS = 700;

/**
 * Table positions. Wide screens: the classic horizontal layout (12 columns, row 1 = 3, 6, … 36).
 * Phones: the same table turned upright (3 columns, 12 rows), set in the CSS by a media query.
 */
function gridPos(n: number): CSSProperties {
  const col = ((n - 1) % 3) + 1; // 1, 2, 3 across a "street"
  const street = Math.ceil(n / 3); // 1..12
  return { "--hc": street + 1, "--hr": 4 - col, "--vc": col, "--vr": street + 1 } as CSSProperties;
}

function columnPos(v: number): CSSProperties {
  return { "--hc": 14, "--hr": 4 - v, "--vc": v, "--vr": 14 } as CSSProperties;
}

function pocketClass(n: number) {
  return n === 0 ? styles.zero : isRed(n) ? styles.red : styles.black;
}

export default function RoulettePage() {
  const demo = useDemoSession();
  const [chip, setChip] = useState(1000);
  const [bets, setBets] = useState<RouletteBet[]>([]);
  const [last, setLast] = useState<Round | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [spinning, setSpinning] = useState(false);
  const [turbo, setTurbo] = useState(false);
  // Strip position: index of the pocket under the marker, and whether to animate getting there.
  const [wheel, setWheel] = useState({ index: 0, animate: false });
  const timers = useRef<number[]>([]);

  useEffect(() => () => timers.current.forEach((t) => window.clearTimeout(t)), []);

  const amounts = useMemo(() => new Map(bets.map((b) => [betKey(b), b.amount])), [bets]);
  const total = totalStake(bets);
  const shown = spinning ? null : last;
  const lastWins = useMemo(() => {
    if (!shown) return new Set<string>();
    return new Set(shown.bet.filter((_, i) => shown.outcome.wins[i]).map(betKey));
  }, [shown]);

  function place(spot: Spot) {
    if (spinning || autoplay.running) return;
    setError(null);
    playSound("pop");
    setBets((prev) => {
      const k = betKey(spot);
      const i = prev.findIndex((b) => betKey(b) === k);
      if (i === -1) return [...prev, { kind: spot.kind, value: spot.value, amount: chip }];
      return prev.map((b, j) => (j === i ? { ...b, amount: b.amount + chip } : b));
    });
  }

  function spinOnce(): number | null {
    setError(null);
    let round: Round;
    try {
      validateBets(bets);
      round = demo.play("roulette", bets, total, (seeds) => {
        const outcome = playRoulette(seeds, bets);
        return { outcome, gross: outcome.gross };
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "تعذّر اللعب.");
      return null;
    }
    const pos = WHEEL.indexOf(round.outcome.pocket);
    const from = WHEEL.indexOf(last?.outcome.pocket ?? 0);
    const dur = turbo ? TURBO_MS : SPIN_MS;
    setLast(round);
    setSpinning(true);
    playSound("start");
    // Jump (no animation) to the same pocket in the first lap, then roll forward to the result in the last lap.
    setWheel({ index: from, animate: false });
    timers.current.push(
      window.setTimeout(() => setWheel({ index: (LAPS - 1) * WHEEL.length + pos, animate: true }), 30),
      window.setTimeout(() => {
        setSpinning(false);
        setWheel({ index: pos, animate: false });
        if (round.gross === 0) playSound("lose");
      }, dur + 60),
    );
    return round.gross - round.stake;
  }

  const autoplay = useAutoPlay(spinOnce, spinning, turbo ? 200 : 600);
  const locked = spinning || autoplay.running;
  useSpaceKey(() => !locked && demo.ready && bets.length > 0 && spinOnce(), true);

  const rounds = useMemo(() => demo.rounds.filter((r): r is Round => r.game === "roulette"), [demo.rounds]);

  function Cell({ spot, className, pos }: { spot: Spot; className?: string; pos?: CSSProperties }) {
    const k = betKey(spot);
    const amt = amounts.get(k);
    return (
      <button
        type="button"
        className={`${styles.cell} ${className ?? ""} ${lastWins.has(k) ? styles.hit : ""} ${
          shown && spot.kind === "straight" && spot.value === shown.outcome.pocket ? styles.landed : ""
        }`}
        style={pos}
        onClick={() => place(spot)}
        disabled={locked}
        aria-label={`${spot.label}${amt ? `، عليها ${formatPoints(amt)}` : ""}`}
      >
        <span className={/^\d/.test(spot.label) ? "num" : undefined}>{spot.label}</span>
        {amt && <span className={`num ${styles.chipOn}`}>{formatPoints(amt)}</span>}
      </button>
    );
  }

  const stage = (
    <>
      <ResultStrip
        items={rounds.slice(spinning ? 1 : 0, (spinning ? 1 : 0) + 14).map((r) => ({
          key: `${r.serverSeedHash}:${r.nonce}`,
          label: String(r.outcome.pocket),
          tone: resultTone(r.gross, r.stake),
        }))}
      />
      <WinBanner id={shown ? `${shown.serverSeedHash}:${shown.nonce}` : null} gross={shown?.gross ?? 0} stake={shown?.stake ?? 1} />

      <div className={styles.wheel} dir="ltr" aria-live="polite" aria-label={shown ? `الخانة ${shown.outcome.pocket}` : undefined}>
        <div
          className={styles.strip}
          style={{
            transform: `translateX(${-(wheel.index + 0.5) * CELL}px)`,
            transition: wheel.animate ? `transform ${turbo ? TURBO_MS : SPIN_MS}ms cubic-bezier(0.12, 0.8, 0.22, 1)` : "none",
          }}
        >
          {Array.from({ length: LAPS }, (_, lap) =>
            WHEEL.map((n, i) => (
              <span
                key={`${lap}-${i}`}
                className={`num ${styles.slot} ${pocketClass(n)} ${shown && !wheel.animate && lap === 0 && n === shown.outcome.pocket ? styles.slotHit : ""}`}
              >
                {n}
              </span>
            )),
          )}
        </div>
        <span className={styles.marker} aria-hidden="true" />
      </div>

      <div className={styles.tableWrap}>
        <div className={styles.table} dir="ltr">
          <Cell spot={{ kind: "straight", value: 0, label: "0" }} className={`${styles.zero} ${styles.zeroCell}`} />
          {Array.from({ length: 36 }, (_, i) => i + 1).map((n) => (
            <Cell key={n} spot={{ kind: "straight", value: n, label: String(n) }} className={pocketClass(n)} pos={gridPos(n)} />
          ))}
          {COLUMNS.map((s) => (
            <Cell key={betKey(s)} spot={s} className={styles.outside} pos={columnPos(s.value!)} />
          ))}
        </div>
        <div className={styles.dozens} dir="ltr">
          {DOZENS.map((s) => (
            <Cell key={betKey(s)} spot={s} className={styles.outside} />
          ))}
        </div>
        <div className={styles.outsideGrid} dir="ltr">
          {OUTSIDE.map((s) => (
            <Cell key={betKey(s)} spot={s} className={`${styles.outside} ${s.kind === "red" ? styles.red : s.kind === "black" ? styles.black : ""}`} />
          ))}
        </div>
      </div>

      <div className={ui.options}>
        <button type="button" className={ui.small} onClick={() => setBets((b) => b.slice(0, -1))} disabled={locked || !bets.length}>
          تراجع
        </button>
        <button type="button" className={ui.small} onClick={() => setBets([])} disabled={locked || !bets.length}>
          مسح
        </button>
        <button
          type="button"
          className={ui.small}
          onClick={() => {
            playSound("click");
            setBets((b) => b.map((x) => ({ ...x, amount: x.amount * 2 })));
          }}
          disabled={locked || !bets.length || total * 2 > ROULETTE_CONFIG.stake_limits.max}
        >
          ضاعف <span className="num">2×</span>
        </button>
        <span className={ui.group}>
          <span className={ui.groupLabel}>مجموع الرهان</span>
          <span className="num">{formatPoints(total)}</span>
        </span>
      </div>
    </>
  );

  const panel = (
    <ControlBar
      balance={demo.balance}
      status={
        error ? (
          <span className="error">{error}</span>
        ) : (
          <BarStatus win={shown && shown.gross > 0 ? shown.gross : null} hint={bets.length ? "الرهانات تبقى بعد الدوران" : "اختر الفيشة ثم اضغط على الطاولة"} />
        )
      }
      stake={chip}
      onStake={setChip}
      min={ROULETTE_CONFIG.stake_limits.min_per_bet}
      max={10000}
      stakeLabel="الفيشة"
      locked={autoplay.running}
      turbo={turbo}
      onTurbo={() => setTurbo((t) => !t)}
      auto={{
        running: autoplay.running,
        left: autoplay.left,
        net: autoplay.net,
        onStart: autoplay.start,
        onStop: autoplay.stop,
        disabled: !demo.ready || spinning || !bets.length,
      }}
      primary={
        autoplay.running
          ? { kind: "stop", label: "إيقاف", onClick: autoplay.stop }
          : { kind: "play", label: "أدِر العجلة", onClick: () => spinOnce(), disabled: !demo.ready || spinning || !bets.length, busy: spinning }
      }
    />
  );

  return (
    <GameFrame
      title="الروليت"
      onReset={demo.reset}
      resetDisabled={locked}
      stage={stage}
      panel={panel}
      rules={
        <>
          <p>
            عجلة بـ<span className="num">37</span> خانة (<span className="num">0</span>–<span className="num">36</span>) بصفر واحد. اختر قيمة الفيشة من
            الشريط، ثم اضغط على الطاولة لتضع رهاناتك، ثم أدِر العجلة.
          </p>
          <p>
            الرقم المفرد يدفع <span className="num">36×</span>، والعشرات والأعمدة <span className="num">3×</span>، والأحمر والأسود والزوجي والفردي
            والنصفان <span className="num">2×</span> (شاملة قيمة الدخول). كل الأنواع لها العائد النظري نفسه:{" "}
            <span className="num">36/37 ≈ 97.30%</span>.
          </p>
          <p>
            مجموع الرهانات في الجولة بين <span className="num">{ROULETTE_CONFIG.stake_limits.min / 100}</span> و
            <span className="num">{formatPoints(ROULETTE_CONFIG.stake_limits.max)}</span> نقطة. الرهانات تبقى بعد الدوران، واللعب التلقائي يعيدها كما هي.
          </p>
          <p>كل دورة تُحسب من بذور معلنة مسبقاً، ويمكنك التحقق منها في قسم «العدالة» أسفل الصفحة.</p>
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
                    <th>الخانة</th>
                    <th>الرهان</th>
                    <th>الصافي</th>
                  </tr>
                </thead>
                <tbody>
                  {rounds.slice(0, 12).map((r) => (
                    <tr key={`${r.serverSeedHash}:${r.nonce}`}>
                      <td className="num">{r.nonce}</td>
                      <td>
                        <span className={`num ${styles.dot} ${pocketClass(r.outcome.pocket)}`}>{r.outcome.pocket}</span>
                      </td>
                      <td className="num">{formatPoints(r.stake)}</td>
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
            game="roulette"
            verify={(seeds, round) => {
              const o = playRoulette(seeds, round.bet as RouletteBet[]);
              return `الخانة ${o.pocket}، العائد ${formatPoints(o.gross)}`;
            }}
          />
        </>
      }
    />
  );
}
