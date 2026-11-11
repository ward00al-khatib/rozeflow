"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { DemoFairness } from "@/components/DemoFairness";
import {
  AutoFields,
  ModeTabs,
  PlayButton,
  StakeInput,
  useAutoPlay,
  useSpaceKey,
  type AutoSettings,
} from "@/components/game/BetControls";
import { GameFrame, ResultStrip } from "@/components/game/GameFrame";
import { WinBanner } from "@/components/game/WinBanner";
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
import { playSound } from "@/lib/sound";
import styles from "./dice.module.css";

const fmtRoll = (r: number) => (r / 100).toFixed(2);
const fmtMult = (m: number) =>
  (m / MULTIPLIER_SCALE).toFixed(4).replace(/0{1,2}$/, "");
const fmtChance = (wc: number) => (wc / 100).toFixed(2);
const ROLL_MS = 650;
const TURBO_MS = 180;

type Round = DemoRound<DiceBet, DiceOutcome>;

export default function DicePage() {
  const demo = useDemoSession();
  const [direction, setDirection] = useState<DiceDirection>("under");
  const [target, setTarget] = useState(5000);
  const [stakeText, setStakeText] = useState("10");
  const [mode, setMode] = useState<"manual" | "auto">("manual");
  const [auto, setAuto] = useState<AutoSettings>({
    rounds: 10,
    stopProfit: "",
    stopLoss: "",
  });
  const [turbo, setTurbo] = useState(false);
  const [last, setLast] = useState<Round | null>(null);
  const [shown, setShown] = useState<number | null>(null); // the number on screen while rolling
  const [rolling, setRolling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [multText, setMultText] = useState<string | null>(null);
  const [chanceText, setChanceText] = useState<string | null>(null);
  const anim = useRef(0);

  const { min, max } = DICE_CONFIG.stake_limits;
  const bounds = DICE_CONFIG.rules.win_count_bounds;
  const stake = Math.round(Number(stakeText) * 100);
  const wc = winCount(target, direction);
  const multiplier = multiplierFor(
    Math.min(Math.max(wc, bounds.min), bounds.max),
  );
  const potential =
    Number.isSafeInteger(stake) && stake > 0
      ? grossPayout(stake, multiplier)
      : 0;
  const [tMin, tMax] =
    direction === "under"
      ? [bounds.min, bounds.max]
      : [10000 - bounds.max, 10000 - bounds.min];

  useEffect(() => () => cancelAnimationFrame(anim.current), []);

  function setWinCount(next: number) {
    const w = Math.min(Math.max(Math.round(next), bounds.min), bounds.max);
    setTarget(direction === "under" ? w : 10000 - w);
  }

  function flip() {
    playSound("click");
    setTarget(10000 - target); // same chance, other side
    setDirection(direction === "under" ? "over" : "under");
  }

  /** Plays one round; returns the net in centi-points, or null if it could not play. */
  function rollOnce(): number | null {
    setError(null);
    const bet: DiceBet = { stake, target, direction };
    let round: Round;
    try {
      validateBet(bet);
      round = demo.play("dice", bet, stake, (seeds) => {
        const outcome = playDice(seeds, bet);
        return { outcome, gross: outcome.gross };
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "تعذّر اللعب.");
      return null;
    }
    // Spin the number, then land on the real roll.
    setRolling(true);
    setLast(round);
    const dur = turbo ? TURBO_MS : ROLL_MS;
    const t0 = performance.now();
    let lastTick = 0;
    cancelAnimationFrame(anim.current);
    const step = (t: number) => {
      const p = (t - t0) / dur;
      if (p >= 1) {
        setShown(round.outcome.roll);
        setRolling(false);
        if (!round.outcome.win) playSound("lose");
        return;
      }
      if (t - lastTick > 55) {
        lastTick = t;
        setShown(Math.floor(Math.random() * 10000));
        playSound("tick");
      }
      anim.current = requestAnimationFrame(step);
    };
    anim.current = requestAnimationFrame(step);
    return round.gross - round.stake;
  }

  const autoplay = useAutoPlay(rollOnce, rolling, turbo ? 120 : 380);
  const locked = rolling || autoplay.running;
  useSpaceKey(() => !locked && demo.ready && rollOnce(), mode === "manual");

  const rounds = useMemo(
    () => demo.rounds.filter((r): r is Round => r.game === "dice"),
    [demo.rounds],
  );
  const outcome = !rolling ? last?.outcome : undefined;

  const zoneStart = direction === "under" ? 0 : target / 100;
  const markerPos = last ? last.outcome.roll / 100 : null;

  const stage = (
    <>
      <ResultStrip
        items={rounds
          .slice(rolling ? 1 : 0, (rolling ? 1 : 0) + 14)
          .map((r) => ({
            key: `${r.serverSeedHash}:${r.nonce}`,
            label: fmtRoll(r.outcome.roll),
            tone: r.outcome.win
              ? r.outcome.multiplier >= 10 * MULTIPLIER_SCALE
                ? "big"
                : "win"
              : "loss",
          }))}
      />
      <WinBanner
        id={
          !rolling && last && last.outcome.win
            ? `${last.serverSeedHash}:${last.nonce}`
            : null
        }
        net={last ? last.gross - last.stake : 0}
        multiplier={(last?.outcome.multiplier ?? 0) / MULTIPLIER_SCALE}
      />

      <div className={styles.center}>
        <div
          className={`${styles.die} ${rolling ? styles.dieRolling : ""} ${outcome ? (outcome.win ? styles.dieWin : styles.dieLoss) : ""}`}
        >
          <span className={`num ${styles.roll}`}>
            {shown === null ? "50.00" : fmtRoll(shown)}
          </span>
        </div>
        <p className={styles.caption} aria-live="polite">
          {rolling ? (
            "…"
          ) : outcome && last ? (
            outcome.win ? (
              <span className={styles.win}>
                فوز{" "}
                <span className="num">
                  +{formatPoints(last.gross - last.stake)}
                </span>
              </span>
            ) : (
              <span className={styles.loss}>
                لم تفز <span className="num">-{formatPoints(last.stake)}</span>
              </span>
            )
          ) : (
            <span className={styles.hint}>
              اسحب المؤشر لتختار فرصتك، ثم ارمِ
            </span>
          )}
        </p>
      </div>

      <div className={styles.trackWrap}>
        <div className={styles.scale} dir="ltr">
          {[0, 25, 50, 75, 100].map((t) => (
            <span key={t} className="num" style={{ left: `${t}%` }}>
              {t}
            </span>
          ))}
        </div>
        <div className={styles.track} dir="ltr">
          <div className={styles.rail}>
            <div
              className={styles.zone}
              style={{ left: `${zoneStart}%`, width: `${wc / 100}%` }}
            />
          </div>
          {markerPos !== null && (
            <div
              className={`${styles.marker} ${outcome ? (outcome.win ? styles.markerWin : styles.markerLoss) : ""}`}
              style={{
                left: `${markerPos}%`,
                transitionDuration: `${turbo ? TURBO_MS : ROLL_MS}ms`,
              }}
            >
              <span className="num">{fmtRoll(last!.outcome.roll)}</span>
            </div>
          )}
          <input
            className={styles.slider}
            type="range"
            min={tMin}
            max={tMax}
            step={1}
            value={target}
            disabled={locked}
            aria-label="الحد"
            onChange={(e) => {
              setTarget(Number(e.target.value));
              playSound("tick");
            }}
          />
        </div>
      </div>

      <div className={styles.stats}>
        <label className={styles.stat}>
          <span>المضاعف</span>
          <span className={styles.statBox}>
            <input
              className="num"
              inputMode="decimal"
              disabled={locked}
              value={multText ?? fmtMult(multiplier)}
              onFocus={(e) => e.target.select()}
              onChange={(e) =>
                setMultText(e.target.value.replace(/[^0-9.]/g, ""))
              }
              onBlur={() => {
                const m = Number(multText);
                if (m > 0) setWinCount(9900 / m);
                setMultText(null);
              }}
              onKeyDown={(e) =>
                e.key === "Enter" && (e.target as HTMLInputElement).blur()
              }
            />
            <i>×</i>
          </span>
        </label>
        <div className={styles.stat}>
          <span>{direction === "under" ? "أقل من" : "أعلى من"}</span>
          <button
            type="button"
            className={styles.statBox}
            onClick={flip}
            disabled={locked}
            title="اقلب الاتجاه"
          >
            <span className="num">{fmtRoll(target)}</span>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path
                d="M7 4v14M7 18l-3-3M7 18l3-3M17 20V6M17 6l-3 3M17 6l3 3"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>
        <label className={styles.stat}>
          <span>فرصة الفوز</span>
          <span className={styles.statBox}>
            <input
              className="num"
              inputMode="decimal"
              disabled={locked}
              value={chanceText ?? fmtChance(wc)}
              onFocus={(e) => e.target.select()}
              onChange={(e) =>
                setChanceText(e.target.value.replace(/[^0-9.]/g, ""))
              }
              onBlur={() => {
                const c = Number(chanceText);
                if (c > 0) setWinCount(c * 100);
                setChanceText(null);
              }}
              onKeyDown={(e) =>
                e.key === "Enter" && (e.target as HTMLInputElement).blur()
              }
            />
            <i>%</i>
          </span>
        </label>
      </div>
    </>
  );

  const panel = (
    <>
      <ModeTabs mode={mode} onChange={setMode} disabled={autoplay.running} />
      <StakeInput
        value={stakeText}
        onChange={setStakeText}
        min={min}
        max={max}
        balance={demo.balance}
        disabled={autoplay.running}
      />
      <div className={styles.payout}>
        <span>العائد عند الفوز</span>
        <span className="num">{formatPoints(potential)}</span>
      </div>
      {mode === "auto" && (
        <AutoFields
          value={auto}
          onChange={setAuto}
          disabled={autoplay.running}
        />
      )}
      <label className={styles.turbo}>
        <input
          type="checkbox"
          checked={turbo}
          onChange={(e) => setTurbo(e.target.checked)}
        />
        رمي سريع
      </label>
      <div className={styles.playSlot}>
        {mode === "manual" ? (
          <PlayButton
            onClick={() => rollOnce()}
            disabled={!demo.ready || rolling}
          >
            ارمِ النرد
          </PlayButton>
        ) : autoplay.running ? (
          <PlayButton variant="stop" onClick={autoplay.stop}>
            إيقاف{" "}
            {autoplay.left > 0 && (
              <span className="num">({autoplay.left})</span>
            )}
          </PlayButton>
        ) : (
          <PlayButton
            onClick={() => autoplay.start(auto)}
            disabled={!demo.ready || rolling}
          >
            ابدأ اللعب التلقائي
          </PlayButton>
        )}
      </div>
      {autoplay.running || (mode === "auto" && autoplay.net !== 0) ? (
        <p className={styles.autoNet}>
          صافي الجولات التلقائية{" "}
          <span
            className={`num ${autoplay.net >= 0 ? styles.win : styles.loss}`}
          >
            {autoplay.net >= 0 ? "+" : "-"}
            {formatPoints(Math.abs(autoplay.net))}
          </span>
        </p>
      ) : null}
      {error && <p className="error">{error}</p>}
      {mode === "manual" && (
        <p className={styles.keyHint}>اختصار: زر المسافة يرمي النرد</p>
      )}
    </>
  );

  return (
    <GameFrame
      title="النرد"
      balance={demo.balance}
      onReset={demo.reset}
      resetDisabled={locked}
      stage={stage}
      panel={panel}
      rules={
        <>
          <p>
            تُرمى رمية بين <span className="num">0.00</span> و
            <span className="num">99.99</span>. اختر حداً واتجاهاً: «أقل من»
            تفوز إن جاءت الرمية أقل من الحد، و«أعلى من» تفوز إن جاءت مساوية له
            أو أعلى.
          </p>
          <p>
            المضاعف = <span className="num">99 ÷ فرصة الفوز</span>، فالعائد
            النظري <span className="num">99%</span> لأي اختيار. فرصة الفوز من{" "}
            <span className="num">{bounds.min / 100}%</span> إلى{" "}
            <span className="num">{bounds.max / 100}%</span>.
          </p>
          <p>
            يمكنك كتابة المضاعف أو فرصة الفوز مباشرة، أو سحب المؤشر. زر السهمين
            يقلب الاتجاه مع الإبقاء على الفرصة نفسها.
          </p>
          <p>
            كل رمية تُحسب من بذور معلنة مسبقاً، ويمكنك التحقق منها في قسم
            «العدالة» أسفل الصفحة.
          </p>
        </>
      }
      below={
        <>
          <section className={styles.history}>
            <h2>رهاناتي</h2>
            {rounds.length === 0 ? (
              <p className="muted">لا جولات بعد.</p>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>الجولة</th>
                    <th>الشرط</th>
                    <th>الرمية</th>
                    <th>المضاعف</th>
                    <th>الصافي</th>
                  </tr>
                </thead>
                <tbody>
                  {rounds.slice(0, 12).map((r) => (
                    <tr key={`${r.serverSeedHash}:${r.nonce}`}>
                      <td className="num">{r.nonce}</td>
                      <td>
                        {r.bet.direction === "under" ? "أقل من" : "أعلى من"}{" "}
                        <span className="num">{fmtRoll(r.bet.target)}</span>
                      </td>
                      <td className="num">{fmtRoll(r.outcome.roll)}</td>
                      <td>
                        <span className="num">
                          {fmtMult(r.outcome.multiplier)}×
                        </span>
                      </td>
                      <td className={r.outcome.win ? styles.win : styles.loss}>
                        <span className="num">
                          {r.outcome.win ? "+" : "-"}
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
            game="dice"
            verify={(seeds, round) => {
              const o = playDice(seeds, round.bet as DiceBet);
              return `${fmtRoll(o.roll)} (${o.win ? "فوز" : "خسارة"})`;
            }}
          />
        </>
      }
    />
  );
}
