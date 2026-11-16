"use client";
import { formatPoints } from "@/lib/points";
import { playSound } from "@/lib/sound";
import { useDailyBonus } from "@/lib/social";
import styles from "./social.module.css";

/** Daily bonus card: one claim per day (Damascus time); the amount grows over a 7-day streak. */
export function DailyBonus({ userId, onClaimed }: { userId: string; onClaimed?: () => void }) {
  const { state, busy, msg, claim } = useDailyBonus(userId);
  if (!state || !state.enabled) return null;
  const shown = state.claimed_today ? state.streak : state.streak + 1;
  return (
    <section className={styles.panel}>
      <div className={styles.panelHead}>
        <h2>المكافأة اليومية</h2>
        <span className="muted">
          أيام السلسلة: <span className="num">{state.streak}</span>
        </span>
      </div>
      <ol className={styles.streak} aria-label="أيام السلسلة">
        {Array.from({ length: 7 }, (_, i) => (
          <li key={i} data-done={i < Math.min(state.streak, 7) ? "" : undefined}
            data-today={!state.claimed_today && i === Math.min(shown, 7) - 1 ? "" : undefined}>
            <span className="num">{i + 1}</span>
          </li>
        ))}
      </ol>
      {state.claimed_today ? (
        <p className="muted">
          أخذت مكافأة اليوم. مكافأة الغد <span className="num">{formatPoints(state.next_amount)}</span> نقطة إذا عدت قبل
          منتصف الليل التالي.
        </p>
      ) : (
        <button
          type="button"
          className="btn-primary"
          disabled={busy}
          onClick={async () => {
            if (await claim()) {
              playSound("win");
              onClaimed?.();
            }
          }}
        >
          خذ <span className="num">{formatPoints(state.next_amount)}</span> نقطة
        </button>
      )}
      {msg && <p className={msg.ok ? "success" : "error"}>{msg.text}</p>}
    </section>
  );
}
