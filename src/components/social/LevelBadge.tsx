import { levelOf } from "@/lib/levels";
import { formatPoints } from "@/lib/points";
import styles from "./social.module.css";

/** Level chip; with `progress`, also a bar toward the next level. */
export function LevelBadge({ wagered, progress }: { wagered: number; progress?: boolean }) {
  const info = levelOf(wagered);
  return (
    <span className={styles.levelWrap}>
      <span className={styles.level} data-level={info.level.n}>
        <span className={`num ${styles.levelN}`}>{info.level.n}</span>
        {info.level.title}
      </span>
      {progress && (
        <span className={styles.levelProgress}>
          <span className={styles.bar} aria-hidden="true">
            <span style={{ width: `${Math.round(info.progress * 100)}%` }} />
          </span>
          <small className="muted">
            {info.next ? (
              <>
                باقٍ <span className="num">{formatPoints(info.toNext)}</span> نقطة رهانات إلى «{info.next.title}»
              </>
            ) : (
              "أعلى مستوى"
            )}
          </small>
        </span>
      )}
    </span>
  );
}
