"use client";
/**
 * Bolt («بُرغي»), the game's own little scrapyard robot: a round TV head with an LED face, screw ears,
 * a glowing antenna, a small orange body with a battery gauge on its chest, and one wheel.
 * Drawn in SVG; every move is CSS. `mood` picks the face and the motion.
 */
import styles from "./bolt.module.css";

export type RobotMood = "idle" | "spin" | "win" | "big" | "charge" | "talk";

export function Robot({ mood, charge, max, say, onPoke, className }: { mood: RobotMood; charge: number; max: number; say?: string | null; onPoke?: () => void; className?: string }) {
  const bars = 5;
  const lit = Math.round((Math.min(charge, max) / max) * bars);
  return (
    <div className={`${styles.robot} ${styles[`mood_${mood}`]} ${className ?? ""}`}>
      {say && (
        <span key={say} className={styles.say}>
          {say}
        </span>
      )}
      <button type="button" className={styles.robotBtn} onClick={onPoke} aria-label="بُرغي">
        <svg viewBox="0 0 200 250" aria-hidden="true">
          <ellipse cx="100" cy="242" rx="46" ry="6" fill="#000" opacity="0.35" className={styles.rShadow} />
          <g className={styles.rWhole}>
            {/* wheel */}
            <g className={styles.rWheel}>
              <circle cx="100" cy="214" r="24" fill="#1b2236" stroke="#0a0f1d" strokeWidth="3" />
              <circle cx="100" cy="214" r="16" fill="url(#bt-steel)" />
              <g className={styles.rSpokes}>
                <path d="M100 200v28M86 214h28M90 204l20 20M110 204l-20 20" stroke="#33405a" strokeWidth="3" strokeLinecap="round" />
              </g>
              <circle cx="100" cy="214" r="5" fill="#ff8a3d" />
            </g>
            <rect x="92" y="180" width="16" height="16" rx="3" fill="url(#bt-steel)" stroke="#33405a" strokeWidth="2" />
            {/* arms */}
            <g className={styles.rArmL}>
              <path d="M58 140q-22 6-26 28" stroke="#8fa0b8" strokeWidth="7" fill="none" strokeLinecap="round" />
              <path d="M24 170a8 8 0 1116 0" stroke="#ff8a3d" strokeWidth="6" fill="none" strokeLinecap="round" />
            </g>
            <g className={styles.rArmR}>
              <path d="M142 140q22 6 26 28" stroke="#8fa0b8" strokeWidth="7" fill="none" strokeLinecap="round" />
              <path d="M160 170a8 8 0 1116 0" stroke="#ff8a3d" strokeWidth="6" fill="none" strokeLinecap="round" />
            </g>
            {/* body */}
            <rect x="56" y="118" width="88" height="66" rx="20" fill="url(#bt-orange)" stroke="#7a2d0a" strokeWidth="2.5" />
            <path d="M66 126q34-8 68 0" stroke="#ffe0c4" strokeWidth="3" fill="none" strokeLinecap="round" opacity="0.7" />
            <rect x="74" y="138" width="52" height="30" rx="7" fill="#0b1530" stroke="#33405a" strokeWidth="2" />
            {Array.from({ length: bars }, (_, i) => (
              <rect
                key={i}
                x={79 + i * 9.4}
                y="143"
                width="7"
                height="20"
                rx="2"
                fill={i < lit ? (lit >= bars ? "#ffd23d" : "#3ddcff") : "#1d2a48"}
                className={i < lit ? styles.rBarOn : undefined}
              />
            ))}
            <circle cx="66" cy="174" r="3" fill="#7a2d0a" />
            <circle cx="134" cy="174" r="3" fill="#7a2d0a" />
            {/* head */}
            <g className={styles.rHead}>
              <path d="M100 28V8" stroke="#8fa0b8" strokeWidth="4" strokeLinecap="round" />
              <circle cx="100" cy="8" r="8" className={styles.rAntenna} filter="url(#bt-glow)" />
              <circle cx="30" cy="72" r="13" fill="url(#bt-steel)" stroke="#33405a" strokeWidth="2" />
              <path d="M24 72h12M30 66v12" stroke="#33405a" strokeWidth="3" strokeLinecap="round" className={styles.rScrew} />
              <circle cx="170" cy="72" r="13" fill="url(#bt-steel)" stroke="#33405a" strokeWidth="2" />
              <path d="M164 72h12M170 66v12" stroke="#33405a" strokeWidth="3" strokeLinecap="round" className={styles.rScrew} />
              <rect x="36" y="26" width="128" height="96" rx="38" fill="url(#bt-shell)" stroke="#33405a" strokeWidth="3" />
              <rect x="50" y="40" width="100" height="62" rx="24" fill="url(#bt-visor)" />
              <rect x="50" y="40" width="100" height="62" rx="24" fill="#3ddcff" opacity="0.06" className={styles.rScan} />
              <g fill="#3ddcff" stroke="#3ddcff" filter="url(#bt-glow)">
                {mood === "win" || mood === "big" ? (
                  <g fill="none" strokeWidth="6" strokeLinecap="round">
                    <path d="M66 74l10-12 10 12" />
                    <path d="M114 74l10-12 10 12" />
                  </g>
                ) : mood === "charge" ? (
                  <g stroke="#0b1530" strokeWidth="1.5" fill="#ffd23d">
                    <path d="M80 54l-12 18h9l-3 14 13-20h-9z" />
                    <path d="M128 54l-12 18h9l-3 14 13-20h-9z" />
                  </g>
                ) : mood === "spin" ? (
                  <g stroke="none" className={styles.rLook}>
                    <rect x="70" y="56" width="16" height="26" rx="8" />
                    <rect x="114" y="56" width="16" height="26" rx="8" />
                  </g>
                ) : (
                  <g stroke="none" className={styles.rBlink}>
                    <rect x="68" y="54" width="18" height="28" rx="9" />
                    <rect x="114" y="54" width="18" height="28" rx="9" />
                  </g>
                )}
                {mood === "talk" || mood === "big" ? (
                  <ellipse cx="100" cy="92" rx="9" ry="5" stroke="none" className={styles.rMouth} />
                ) : (
                  <path d="M88 90q12 8 24 0" fill="none" strokeWidth="3.5" strokeLinecap="round" />
                )}
              </g>
              <circle cx="58" cy="108" r="5" fill="#ff8fc8" opacity={mood === "win" || mood === "big" ? 0.9 : 0.45} />
              <circle cx="142" cy="108" r="5" fill="#ff8fc8" opacity={mood === "win" || mood === "big" ? 0.9 : 0.45} />
              <path d="M58 36q42-12 84 0" stroke="#fff" strokeWidth="4" fill="none" strokeLinecap="round" opacity="0.85" />
            </g>
          </g>
          {(mood === "big" || mood === "charge") && (
            <g className={styles.rSparks} stroke="#ffd23d" strokeWidth="3" strokeLinecap="round">
              <path d="M24 40l-12-6M18 70H4M30 100l-12 8" />
              <path d="M176 40l12-6M182 70h14M170 100l12 8" />
            </g>
          )}
        </svg>
      </button>
    </div>
  );
}
