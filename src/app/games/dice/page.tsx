"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Shell } from "@/components/Shell";
import { DemoFairness } from "@/components/DemoFairness";
import { useDemoSession, type DemoRound } from "@/lib/demo/session";
import {
  DICE_CONFIG,
  MULTIPLIER_SCALE,
  grossPayout,
  multiplierFor,
  playDice,
  validateBet,
  winCount,
  type DiceBet,
  type DiceDirection,
  type DiceOutcome,
} from "@/lib/games/dice";
import { formatPoints } from "@/lib/points";
import { useMember } from "@/lib/useMember";
import styles from "./dice.module.css";

const fmtRoll = (r: number) => (r / 100).toFixed(2).padStart(5, "0");
const fmtMult = (m: number) => (m / MULTIPLIER_SCALE).toFixed(4).replace(/0{1,2}$/, "");
const fmtChance = (wc: number) => (wc / 100).toFixed(2);

export default function DicePage() {
  const member = useMember();
  const demo = useDemoSession();
  const [direction, setDirection] = useState<DiceDirection>("under");
  const [target, setTarget] = useState(5000);
  const [stakeText, setStakeText] = useState("10");
  const [last, setLast] = useState<DemoRound<DiceBet, DiceOutcome> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rolling, setRolling] = useState(false);

  const { min, max } = DICE_CONFIG.stake_limits;
  const bounds = DICE_CONFIG.rules.win_count_bounds;
  const stake = Math.round(Number(stakeText) * 100);
  const wc = winCount(target, direction);
  const multiplier = multiplierFor(Math.min(Math.max(wc, bounds.min), bounds.max));
  const potential = Number.isSafeInteger(stake) && stake > 0 ? grossPayout(stake, multiplier) : 0;

  // Allowed target range for the chosen direction.
  const [tMin, tMax] =
    direction === "under" ? [bounds.min, bounds.max] : [10000 - bounds.max, 10000 - bounds.min];

  function setDir(d: DiceDirection) {
    // Keep the same win chance when flipping direction.
    setTarget(10000 - target);
    setDirection(d);
  }

  function setStakePoints(centi: number) {
    const c = Math.min(Math.max(centi, min), max, Math.max(demo.balance, min));
    setStakeText(String(c / 100));
  }

  function roll() {
    setError(null);
    const bet: DiceBet = { stake, target, direction };
    try {
      validateBet(bet);
      const round = demo.play("dice", bet, stake, (seeds) => {
        const outcome = playDice(seeds, bet);
        return { outcome, gross: outcome.gross };
      });
      setRolling(true);
      setLast(round);
      window.setTimeout(() => setRolling(false), 450);
    } catch (e) {
      setError(e instanceof Error ? e.message : "تعذّر اللعب.");
    }
  }

  const diceRounds = useMemo(
    () => demo.rounds.filter((r): r is DemoRound<DiceBet, DiceOutcome> => r.game === "dice"),
    [demo.rounds],
  );

  const outcome = last?.outcome;
  // Win zone on the 0–100 track.
  const zoneStart = direction === "under" ? 0 : target / 100;
  const zoneWidth = wc / 100;

  return (
    <Shell member={member}>
      <div className={styles.page}>
        <div className={styles.titleRow}>
          <h1 className={styles.title}>النرد</h1>
          <span className={styles.demoBadge}>وضع تجريبي</span>
        </div>
        <p className="muted">
          النقاط هنا تجريبية وتبقى في متصفحك فقط، والرصيد الحقيقي لا يتأثر. القواعد والعدالة هي نفسها التي ستعمل على الخادم.
        </p>

        <section className={styles.board} aria-live="polite">
          <div className={styles.rollBox}>
            <span className={styles.rollLabel}>الرمية</span>
            <span
              className={`num ${styles.roll} ${rolling ? styles.rolling : ""} ${
                outcome ? (outcome.win ? styles.win : styles.loss) : ""
              }`}
            >
              {outcome ? fmtRoll(outcome.roll) : "--.--"}
            </span>
            {last && outcome && (
              <span className={`${styles.resultLine} ${outcome.win ? styles.win : styles.loss}`}>
                {outcome.win ? (
                  <>
                    فوز <span className="num">+{formatPoints(outcome.gross - last.stake)}</span>
                  </>
                ) : (
                  <>
                    لم تفز <span className="num">-{formatPoints(last.stake)}</span>
                  </>
                )}
              </span>
            )}
          </div>

          <div className={styles.track} dir="ltr">
            <div className={styles.zone} style={{ left: `${zoneStart}%`, width: `${zoneWidth}%` }} />
            {outcome && (
              <div
                className={`${styles.marker} ${outcome.win ? styles.markerWin : ""}`}
                style={{ left: `${outcome.roll / 100}%` }}
              />
            )}
            <div className={styles.ticks}>
              {[0, 25, 50, 75, 100].map((t) => (
                <span key={t} className="num">
                  {t}
                </span>
              ))}
            </div>
          </div>

          <input
            className={styles.slider}
            type="range"
            dir="ltr"
            min={tMin}
            max={tMax}
            step={1}
            value={target}
            aria-label="الحد"
            onChange={(e) => setTarget(Number(e.target.value))}
          />
        </section>

        <section className={styles.controls}>
          <div className={styles.toggle} role="group" aria-label="الاتجاه">
            <button type="button" aria-pressed={direction === "under"} onClick={() => direction !== "under" && setDir("under")}>
              أقل من <span className="num">{fmtRoll(direction === "under" ? target : 10000 - target)}</span>
            </button>
            <button type="button" aria-pressed={direction === "over"} onClick={() => direction !== "over" && setDir("over")}>
              أعلى من <span className="num">{fmtRoll(direction === "over" ? target : 10000 - target)}</span>
            </button>
          </div>

          <dl className={styles.stats}>
            <div>
              <dt>فرصة الفوز</dt>
              <dd className="num">{fmtChance(wc)}%</dd>
            </div>
            <div>
              <dt>المضاعف</dt>
              <dd className="num">{fmtMult(multiplier)}×</dd>
            </div>
            <div>
              <dt>العائد عند الفوز</dt>
              <dd className="num">{formatPoints(potential)}</dd>
            </div>
          </dl>

          <div className="field">
            <label htmlFor="stake">
              قيمة الدخول (من <span className="num">{min / 100}</span> إلى <span className="num">{formatPoints(max)}</span> نقطة)
            </label>
            <div className={styles.stakeRow}>
              <input
                id="stake"
                className="input num"
                inputMode="decimal"
                value={stakeText}
                onChange={(e) => setStakeText(e.target.value.replace(/[^0-9.]/g, ""))}
              />
              <button type="button" className="btn-secondary" onClick={() => setStakePoints(Math.floor(stake / 2))}>
                ½
              </button>
              <button type="button" className="btn-secondary" onClick={() => setStakePoints(stake * 2)}>
                <span className="num">×2</span>
              </button>
            </div>
          </div>

          <button type="button" className={`btn-primary ${styles.rollButton}`} onClick={roll} disabled={!demo.ready || rolling}>
            ارمِ النرد
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

        <section className={styles.history}>
          <h2>آخر الجولات</h2>
          {diceRounds.length === 0 ? (
            <p className="muted">لا جولات بعد.</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>nonce</th>
                  <th>الشرط</th>
                  <th>الرمية</th>
                  <th>الصافي</th>
                </tr>
              </thead>
              <tbody>
                {diceRounds.slice(0, 12).map((r) => (
                  <tr key={`${r.serverSeedHash}:${r.nonce}`}>
                    <td className="num">{r.nonce}</td>
                    <td>
                      {r.bet.direction === "under" ? "أقل من" : "أعلى من"} <span className="num">{fmtRoll(r.bet.target)}</span>
                    </td>
                    <td className="num">{fmtRoll(r.outcome.roll)}</td>
                    <td className={`num ${r.outcome.win ? styles.win : styles.loss}`}>
                      {r.outcome.win ? "+" : "-"}
                      {formatPoints(Math.abs(r.gross - r.stake))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <DemoFairness demo={demo} verify={(seeds, round) => {
          const o = playDice(seeds, round.bet as DiceBet);
          return `${fmtRoll(o.roll)} (${o.win ? "فوز" : "خسارة"})`;
        }} game="dice" />

        <p className="muted">
          <Link href="/">← كل الألعاب</Link>
        </p>
      </div>
    </Shell>
  );
}
