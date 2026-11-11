"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { DemoFairness } from "@/components/DemoFairness";
import { Shell } from "@/components/Shell";
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
import { useMember } from "@/lib/useMember";
import styles from "./roulette.module.css";

const CHIPS = [100, 500, 1000, 5000, 10000]; // centi-points: 1, 5, 10, 50, 100 points

type Spot = { kind: RouletteBetKind; value?: number; label: string };

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

/**
 * Table positions. Wide screens: the classic horizontal layout (12 columns, row 1 = 3, 6, … 36).
 * Phones: the same table turned upright (3 columns, 12 rows), set in the CSS by a media query.
 */
function gridPos(n: number): React.CSSProperties {
  const col = ((n - 1) % 3) + 1; // 1, 2, 3 across a "street"
  const street = Math.ceil(n / 3); // 1..12
  return { "--hc": street + 1, "--hr": 4 - col, "--vc": col, "--vr": street + 1 } as React.CSSProperties;
}

function columnPos(v: number): React.CSSProperties {
  return { "--hc": 14, "--hr": 4 - v, "--vc": v, "--vr": 14 } as React.CSSProperties;
}

function pocketClass(n: number) {
  return n === 0 ? styles.zero : isRed(n) ? styles.red : styles.black;
}

export default function RoulettePage() {
  const member = useMember();
  const demo = useDemoSession();
  const [chip, setChip] = useState(1000);
  const [bets, setBets] = useState<RouletteBet[]>([]);
  const [last, setLast] = useState<DemoRound<RouletteBet[], RouletteOutcome> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [spinning, setSpinning] = useState(false);

  const amounts = useMemo(() => new Map(bets.map((b) => [betKey(b), b.amount])), [bets]);
  const total = totalStake(bets);
  const lastWins = useMemo(() => {
    if (!last) return new Set<string>();
    return new Set(last.bet.filter((_, i) => last.outcome.wins[i]).map(betKey));
  }, [last]);

  function place(spot: Spot) {
    setError(null);
    setBets((prev) => {
      const k = betKey(spot);
      const i = prev.findIndex((b) => betKey(b) === k);
      if (i === -1) return [...prev, { kind: spot.kind, value: spot.value, amount: chip }];
      return prev.map((b, j) => (j === i ? { ...b, amount: b.amount + chip } : b));
    });
  }

  function spin() {
    setError(null);
    try {
      validateBets(bets);
      const round = demo.play("roulette", bets, total, (seeds) => {
        const outcome = playRoulette(seeds, bets);
        return { outcome, gross: outcome.gross };
      });
      setSpinning(true);
      setLast(round);
      window.setTimeout(() => setSpinning(false), 600);
    } catch (e) {
      setError(e instanceof Error ? e.message : "تعذّر اللعب.");
    }
  }

  const rounds = demo.rounds.filter((r): r is DemoRound<RouletteBet[], RouletteOutcome> => r.game === "roulette");

  function Cell({ spot, className, pos }: { spot: Spot; className?: string; pos?: React.CSSProperties }) {
    const k = betKey(spot);
    const amt = amounts.get(k);
    return (
      <button
        type="button"
        className={`${styles.cell} ${className ?? ""} ${lastWins.has(k) && !spinning ? styles.hit : ""}`}
        style={pos}
        onClick={() => place(spot)}
        aria-label={`${spot.label}${amt ? `، عليها ${formatPoints(amt)}` : ""}`}
      >
        <span className={/^\d/.test(spot.label) ? "num" : undefined}>{spot.label}</span>
        {amt && <span className={`num ${styles.chipOn}`}>{formatPoints(amt)}</span>}
      </button>
    );
  }

  const pocket = last?.outcome.pocket;

  return (
    <Shell member={member}>
      <div className={styles.page}>
        <div className={styles.titleRow}>
          <h1 className={styles.title}>الروليت</h1>
          <span className={styles.demoBadge}>وضع تجريبي</span>
        </div>
        <p className="muted">
          عجلة بـ<span className="num">37</span> خانة (0–36). كل أنواع الرهان لها العائد النظري نفسه:{" "}
          <span className="num">36/37 ≈ 97.30%</span>.
        </p>

        <section className={styles.result} aria-live="polite">
          <span className={`num ${styles.pocket} ${pocket !== undefined ? pocketClass(pocket) : ""} ${spinning ? styles.spinning : ""}`}>
            {pocket ?? "–"}
          </span>
          {last && !spinning && (
            <span className={last.gross > last.stake ? styles.win : styles.loss}>
              {last.gross > 0 ? (
                <>
                  العائد <span className="num">{formatPoints(last.gross)}</span> · الصافي{" "}
                  <span className="num">
                    {last.gross >= last.stake ? "+" : "-"}
                    {formatPoints(Math.abs(last.gross - last.stake))}
                  </span>
                </>
              ) : (
                <>
                  لم يربح أي رهان <span className="num">-{formatPoints(last.stake)}</span>
                </>
              )}
            </span>
          )}
          <div className={styles.recent} dir="ltr">
            {rounds.slice(0, 12).map((r) => (
              <span key={`${r.serverSeedHash}:${r.nonce}`} className={`num ${pocketClass(r.outcome.pocket)}`}>
                {r.outcome.pocket}
              </span>
            ))}
          </div>
        </section>

        <section className={styles.tableWrap}>
          <div className={styles.chips} role="radiogroup" aria-label="قيمة الفيشة">
            {CHIPS.map((c) => (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={chip === c}
                className={`num ${styles.chip}`}
                onClick={() => setChip(c)}
              >
                {formatPoints(c)}
              </button>
            ))}
          </div>

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

          <div className={styles.actions}>
            <button type="button" className="btn-secondary" onClick={() => setBets((b) => b.slice(0, -1))} disabled={!bets.length}>
              تراجع
            </button>
            <button type="button" className="btn-secondary" onClick={() => setBets([])} disabled={!bets.length}>
              مسح
            </button>
            <span className={styles.total}>
              المجموع <span className="num">{formatPoints(total)}</span>
            </span>
          </div>
          <p className="muted">
            المجموع بين <span className="num">{ROULETTE_CONFIG.stake_limits.min / 100}</span> و
            <span className="num">{formatPoints(ROULETTE_CONFIG.stake_limits.max)}</span> نقطة. الرهانات تبقى بعد الدوران لتعيدها بضغطة.
          </p>

          <button type="button" className={`btn-primary ${styles.spinButton}`} onClick={spin} disabled={!demo.ready || spinning || !bets.length}>
            أدِر العجلة
          </button>
          {error && <p className="error">{error}</p>}

          <div className={styles.balance}>
            <span>الرصيد التجريبي</span>
            <span className="num">{formatPoints(demo.balance)}</span>
            <button type="button" className={styles.linkButton} onClick={demo.reset}>
              إعادة إلى <span className="num">1,000</span>
            </button>
          </div>
        </section>

        <DemoFairness
          demo={demo}
          game="roulette"
          verify={(seeds, round) => {
            const o = playRoulette(seeds, round.bet as RouletteBet[]);
            return `الخانة ${o.pocket}، العائد ${formatPoints(o.gross)}`;
          }}
        />

        <p className="muted">
          <Link href="/">← كل الألعاب</Link>
        </p>
      </div>
    </Shell>
  );
}
