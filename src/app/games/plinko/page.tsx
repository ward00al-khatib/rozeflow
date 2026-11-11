"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { DemoFairness } from "@/components/DemoFairness";
import { useAutoPlay, useSpaceKey } from "@/components/game/BetControls";
import { BarStatus, ControlBar } from "@/components/game/ControlBar";
import { GameFrame, ResultStrip } from "@/components/game/GameFrame";
import { WinBanner } from "@/components/game/WinBanner";
import ui from "@/components/game/stage.module.css";
import { useDemoSession, type DemoRound } from "@/lib/demo/session";
import {
  PLINKO_CONFIG,
  PLINKO_SCALE,
  playPlinko,
  plinkoTable,
  validatePlinkoBet,
  type PlinkoBet,
  type PlinkoOutcome,
  type PlinkoRisk,
  type PlinkoRows,
} from "@/lib/games/plinko";
import { formatPoints } from "@/lib/points";
import { playSound } from "@/lib/sound";
import { resultTone } from "@/lib/winTier";
import styles from "./plinko.module.css";

const RISK_LABEL: Record<PlinkoRisk, string> = { low: "منخفضة", medium: "متوسطة", high: "عالية" };
const STEP_MS = 90;
const TURBO_STEP_MS = 30;

type Round = DemoRound<PlinkoBet, PlinkoOutcome>;

/** Short label for a slot (fits 17 slots on a phone): whole numbers from 10x, one decimal from 1x, ".03" style below 1x. Full value in the tooltip. */
function shortMult(m: number) {
  const x = m / PLINKO_SCALE;
  if (x >= 10) return String(Math.floor(x));
  if (x >= 1) return (Math.floor(x * 10) / 10).toString();
  return (Math.floor(x * 100) / 100).toFixed(2).slice(1); // ".03"
}

const fullMult = (m: number) => (m / PLINKO_SCALE).toFixed(4).replace(/0+$/, "").replace(/\.$/, "");

function slotTone(m: number) {
  if (m >= 3 * PLINKO_SCALE) return styles.hot;
  if (m >= PLINKO_SCALE) return styles.warm;
  return styles.cold;
}

export default function PlinkoPage() {
  const demo = useDemoSession();
  const [rows, setRows] = useState<PlinkoRows>(12);
  const [risk, setRisk] = useState<PlinkoRisk>("medium");
  const [stake, setStake] = useState(1000);
  const [turbo, setTurbo] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [drop, setDrop] = useState<{ round: Round; step: number } | null>(null);
  const timer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (timer.current) window.clearInterval(timer.current);
    },
    [],
  );

  const { min, max } = PLINKO_CONFIG.stake_limits;
  const table = plinkoTable(risk, rows);
  const dropping = drop !== null && drop.step < drop.round.bet.rows;

  function dropOnce(): number | null {
    setError(null);
    const bet: PlinkoBet = { stake, rows, risk };
    let round: Round;
    try {
      validatePlinkoBet(bet);
      round = demo.play("plinko", bet, stake, (seeds) => {
        const outcome = playPlinko(seeds, bet);
        return { outcome, gross: outcome.gross };
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "تعذّر اللعب.");
      return null;
    }
    playSound("start");
    if (timer.current) window.clearInterval(timer.current);
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      setDrop({ round, step: bet.rows });
    } else {
      setDrop({ round, step: 0 });
      timer.current = window.setInterval(
        () => {
          setDrop((d) => {
            if (!d) return d;
            if (d.step >= d.round.bet.rows) {
              window.clearInterval(timer.current!);
              return d;
            }
            const next = d.step + 1;
            playSound("tick");
            if (next >= d.round.bet.rows && d.round.gross < d.round.stake) playSound("lose");
            return { ...d, step: next };
          });
        },
        turbo ? TURBO_STEP_MS : STEP_MS,
      );
    }
    return round.gross - round.stake;
  }

  const autoplay = useAutoPlay(dropOnce, dropping, turbo ? 120 : 380);
  const locked = dropping || autoplay.running;
  useSpaceKey(() => !locked && demo.ready && dropOnce(), true);

  // Board geometry (SVG units). Row i has i + 3 pegs; slots sit under the last row.
  const shownRows = drop && dropping ? drop.round.bet.rows : rows;
  const shownTable = drop && dropping ? plinkoTable(drop.round.bet.risk, drop.round.bet.rows) : table;
  const W = 400;
  const gap = W / (shownRows + 2);
  const rowH = 300 / (shownRows + 1);
  const pegX = (row: number, j: number) => W / 2 + (j - (row + 2) / 2) * gap;
  const pegY = (row: number) => 24 + row * rowH;

  let ball: { x: number; y: number } | null = null;
  if (drop && drop.round.bet.rows === shownRows) {
    const { path } = drop.round.outcome;
    const rights = path.slice(0, drop.step).reduce((a, b) => a + b, 0);
    // after `step` bounces the ball sits between pegs of row `step`
    ball = { x: W / 2 + (rights - drop.step / 2) * gap, y: pegY(drop.step) - rowH / 2 };
  }
  const landed = drop && !dropping ? drop.round : null;

  const rounds = useMemo(() => demo.rounds.filter((r): r is Round => r.game === "plinko"), [demo.rounds]);
  const top = Math.max(...table);

  const stage = (
    <>
      <ResultStrip
        items={rounds.slice(dropping ? 1 : 0, (dropping ? 1 : 0) + 14).map((r) => ({
          key: `${r.serverSeedHash}:${r.nonce}`,
          label: `${shortMult(r.outcome.multiplier)}×`,
          tone: resultTone(r.gross, r.stake),
        }))}
      />
      <WinBanner id={landed ? `${landed.serverSeedHash}:${landed.nonce}` : null} gross={landed?.gross ?? 0} stake={landed?.stake ?? 1} />

      <div className={styles.board}>
        <svg viewBox={`0 0 ${W} 330`} className={styles.svg} role="img" aria-label="لوحة بلينكو">
          {Array.from({ length: shownRows }, (_, row) =>
            Array.from({ length: row + 3 }, (_, j) => (
              <circle key={`${row}-${j}`} cx={pegX(row, j)} cy={pegY(row)} r={Math.max(2, gap / 9)} className={styles.peg} />
            )),
          )}
          {ball && (
            <circle
              cx={ball.x}
              cy={ball.y}
              r={Math.max(5, gap / 4)}
              className={styles.ball}
              style={{ transitionDuration: `${turbo ? TURBO_STEP_MS : STEP_MS}ms` }}
            />
          )}
        </svg>
        <div
          className={styles.slots}
          dir="ltr"
          style={{
            gridTemplateColumns: `repeat(${shownRows + 1}, 1fr)`,
            width: `${((shownRows + 1) / (shownRows + 2)) * 100}%`,
          }}
        >
          {shownTable.map((m, k) => (
            <span
              key={k}
              title={`${fullMult(m)}×`}
              className={`num ${styles.slot} ${slotTone(m)} ${landed && landed.outcome.slot === k ? styles.landed : ""}`}
            >
              {shortMult(m)}
            </span>
          ))}
        </div>
      </div>

      <div className={ui.options}>
        <div className={ui.group}>
          <span className={ui.groupLabel}>الصفوف</span>
          <div className={ui.seg} role="radiogroup" aria-label="الصفوف">
            {(PLINKO_CONFIG.rules.rows as PlinkoRows[]).map((n) => (
              <button
                key={n}
                type="button"
                role="radio"
                aria-checked={rows === n}
                disabled={locked}
                onClick={() => {
                  playSound("click");
                  setRows(n);
                }}
              >
                <span className="num">{n}</span>
              </button>
            ))}
          </div>
        </div>
        <div className={ui.group}>
          <span className={ui.groupLabel}>المخاطرة</span>
          <div className={ui.seg} role="radiogroup" aria-label="المخاطرة">
            {(PLINKO_CONFIG.rules.risks as PlinkoRisk[]).map((r) => (
              <button
                key={r}
                type="button"
                role="radio"
                aria-checked={risk === r}
                disabled={locked}
                onClick={() => {
                  playSound("click");
                  setRisk(r);
                }}
              >
                {RISK_LABEL[r]}
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
        ) : (
          <BarStatus
            win={landed && landed.gross > 0 ? landed.gross : null}
            hint={
              <>
                أعلى خانة <span className="num">{fullMult(top)}×</span>
              </>
            }
          />
        )
      }
      stake={stake}
      onStake={setStake}
      min={min}
      max={max}
      locked={autoplay.running}
      turbo={turbo}
      onTurbo={() => setTurbo((t) => !t)}
      auto={{
        running: autoplay.running,
        left: autoplay.left,
        net: autoplay.net,
        onStart: autoplay.start,
        onStop: autoplay.stop,
        disabled: !demo.ready || dropping,
      }}
      primary={
        autoplay.running
          ? { kind: "stop", label: "إيقاف", onClick: autoplay.stop }
          : { kind: "play", label: "أسقط الكرة", onClick: () => dropOnce(), disabled: !demo.ready || dropping, busy: dropping }
      }
    />
  );

  return (
    <GameFrame
      title="بلينكو"
      onReset={demo.reset}
      resetDisabled={locked}
      stage={stage}
      panel={panel}
      rules={
        <>
          <p>
            ترتد الكرة يميناً أو يساراً عند كل صف باحتمال متساوٍ، والخانة التي تستقر فيها تحدد المضاعف. الخانات الطرفية أندر
            وأعلى.
          </p>
          <p>
            اختر عدد الصفوف (<span className="num">8</span> أو <span className="num">12</span> أو <span className="num">16</span>)
            والمخاطرة. كل جدول عائده النظري <span className="num">99%</span>، والمخاطرة الأعلى تعني فرقاً أكبر بين الخانات.
          </p>
          <p>اللعب التلقائي يُسقط كرات متتالية بنفس الإعدادات، ويتوقف عند الحدود التي تضعها.</p>
          <p>كل كرة تُحسب من بذور معلنة مسبقاً، ويمكنك التحقق منها في قسم «العدالة» أسفل الصفحة.</p>
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
                    <th>الإعداد</th>
                    <th>المضاعف</th>
                    <th>الصافي</th>
                  </tr>
                </thead>
                <tbody>
                  {rounds.slice(0, 12).map((r) => (
                    <tr key={`${r.serverSeedHash}:${r.nonce}`}>
                      <td className="num">{r.nonce}</td>
                      <td>
                        <span className="num">{r.bet.rows}</span> صفاً · {RISK_LABEL[r.bet.risk]}
                      </td>
                      <td>
                        <span className="num">{fullMult(r.outcome.multiplier)}×</span>
                      </td>
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
            game="plinko"
            verify={(seeds, round) => {
              const o = playPlinko(seeds, round.bet as PlinkoBet);
              return `المسار ${o.path.map((x) => (x ? "يمين" : "يسار")).join("، ")} ← الخانة ${o.slot}`;
            }}
          />
        </>
      }
    />
  );
}
