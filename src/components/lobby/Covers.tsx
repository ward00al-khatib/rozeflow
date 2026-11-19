/* Animated cover art for the games on the home page. Drawn as SVG and moved with CSS only. */
import type { ReactNode } from "react";
import styles from "./Covers.module.css";

export type GameId = "slots" | "reef" | "crash" | "dice" | "roulette" | "plinko" | "mines";

/** `wide` widens the scene to 640×200 (centred on the usual 320×200), for a banner card. */
function Frame({ id, from, to, children, wide }: { id: string; from: string; to: string; children: ReactNode; wide?: boolean }) {
  return (
    <svg viewBox={wide ? "-160 0 640 200" : "0 0 320 200"} className={styles.cover} preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <defs>
        <linearGradient id={`cv-bg-${id}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={from} />
          <stop offset="1" stopColor={to} />
        </linearGradient>
        <radialGradient id={`cv-light-${id}`} cx="50%" cy="0%" r="90%">
          <stop offset="0" stopColor="#fff" stopOpacity="0.22" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="cv-gold" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffe08a" />
          <stop offset="0.55" stopColor="#ffae3d" />
          <stop offset="1" stopColor="#d9731a" />
        </linearGradient>
        <linearGradient id="cv-cyan" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#b5f4ff" />
          <stop offset="0.5" stopColor="#3ddcff" />
          <stop offset="1" stopColor="#0f86c9" />
        </linearGradient>
        <linearGradient id="cv-green" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#a7ffd6" />
          <stop offset="1" stopColor="#1fae6f" />
        </linearGradient>
        <filter id="cv-glow" x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur stdDeviation="3" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      <rect x="-160" width="640" height="200" fill={`url(#cv-bg-${id})`} />
      <rect x="-160" width="640" height="200" fill={`url(#cv-light-${id})`} />
      {children}
    </svg>
  );
}

function Stars({ pts }: { pts: [number, number, number][] }) {
  return (
    <g fill="#fff">
      {pts.map(([x, y, r], i) => (
        <circle key={i} cx={x} cy={y} r={r} className={styles.twinkle} style={{ animationDelay: `${-i * 0.55}s` }} />
      ))}
    </g>
  );
}

function Slots() {
  const reel = (x: number, cls: string, items: ReactNode[]) => (
    <g>
      <rect x={x} y="38" width="62" height="124" rx="10" fill="#080c18" stroke="#3a4a70" strokeWidth="2" />
      <svg x={x} y="38" width="62" height="124" viewBox="0 0 62 124">
        <g className={`${styles.reel} ${cls}`}>
          {[...items, ...items].map((it, i) => (
            <g key={i} transform={`translate(31 ${31 + i * 62})`}>
              {it}
            </g>
          ))}
        </g>
      </svg>
    </g>
  );
  const atom = (
    <g>
      <g fill="none" stroke="url(#cv-cyan)" strokeWidth="3">
        <ellipse rx="22" ry="8" />
        <ellipse rx="22" ry="8" transform="rotate(60)" />
        <ellipse rx="22" ry="8" transform="rotate(-60)" />
      </g>
      <circle r="6" fill="#ff8a1f" />
    </g>
  );
  const bolt = <path d="M5 -24L-14 4h12l-4 20 20-30H7z" fill="url(#cv-gold)" stroke="#7a3b05" strokeWidth="1.5" strokeLinejoin="round" />;
  const gem = (
    <g>
      <path d="M0 -22l15 13-15 33-15-33z" fill="#a66bff" />
      <path d="M0 -22l15 13h-30z" fill="#efe0ff" opacity="0.8" />
    </g>
  );
  const seven = (
    <text y="15" textAnchor="middle" fontSize="42" fontWeight="900" fontFamily="var(--font-mono), monospace" fill="url(#cv-gold)" stroke="#7a3b05" strokeWidth="1.2">
      7
    </text>
  );
  return (
    <Frame id="slots" from="#2a1454" to="#0a0f22">
      <Stars pts={[[24, 22, 1.4], [296, 30, 1.2], [282, 172, 1.6], [34, 168, 1.2], [160, 16, 1.3]]} />
      <rect x="44" y="26" width="232" height="148" rx="18" fill="#141c33" stroke="url(#cv-gold)" strokeWidth="3" />
      {reel(56, styles.reelA, [seven, atom, gem, bolt])}
      {reel(129, styles.reelB, [atom, bolt, seven, gem])}
      {reel(202, styles.reelC, [gem, seven, bolt, atom])}
      <rect x="50" y="86" width="220" height="28" rx="6" fill="none" stroke="#3ddcff" strokeWidth="2" className={styles.pulse} filter="url(#cv-glow)" />
    </Frame>
  );
}

/** Bubble Reef: a 3×3 machine under the sea, with our own fish, chest and pearl, and rising bubbles. */
function Reef({ wide }: { wide?: boolean }) {
  const reel = (x: number, cls: string, items: ReactNode[]) => (
    <g>
      <rect x={x} y="44" width="58" height="116" rx="10" fill="#04223a" stroke="#ffb27a" strokeWidth="2" />
      <svg x={x} y="44" width="58" height="116" viewBox="0 0 58 116">
        <g className={`${styles.reel} ${styles.reefReel} ${cls}`}>
          {[...items, ...items].map((it, i) => (
            <g key={i} transform={`translate(29 ${29 + i * 58})`}>
              {it}
            </g>
          ))}
        </g>
      </svg>
    </g>
  );
  const puffer = (
    <g>
      <path d="M16 0l8 -6v12z" fill="#ff9f2e" />
      <circle r="16" fill="#ffc23d" stroke="#b85c0b" strokeWidth="1.2" />
      <circle cx="-6" cy="-4" r="4.5" fill="#fff" />
      <circle cx="-7" cy="-4" r="2.2" fill="#1b1030" />
      <ellipse cx="-10" cy="6" rx="2.4" ry="1.8" fill="#7a2f05" />
    </g>
  );
  const chest = (
    <g>
      <path d="M-18 -2c0-9 8-14 18-14s18 5 18 14z" fill="#8a4a24" />
      <rect x="-18" y="-2" width="36" height="16" rx="2" fill="#6b3518" />
      <path d="M-18 -2h36M-8 -16v30M8 -16v30" stroke="url(#cv-gold)" strokeWidth="3" />
      <rect x="-4" y="0" width="8" height="8" rx="1.5" fill="url(#cv-gold)" />
    </g>
  );
  const pearl = (
    <g>
      <path d="M-20 -2c3-12 12-17 20-17s17 5 20 17c-7-3-13-4-20-4s-13 1-20 4z" fill="#3fcfc0" />
      <path d="M-20 4c7-3 13-4 20-4s13 1 20 4c-3 9-10 13-20 13s-17-4-20-13z" fill="#1b8f9e" />
      <circle cy="-2" r="8" fill="#eef7ff" filter="url(#cv-glow)" />
    </g>
  );
  const star = (
    <path d="M0 -19l5 11 12 1-9 8 3 12-11-6-11 6 3-12-9-8 12-1z" fill="#ff8a3d" stroke="#a8400f" strokeWidth="1.2" strokeLinejoin="round" />
  );
  return (
    <Frame id="reef" from="#0f6c9a" to="#061a33" wide={wide}>
      <g fill="none" stroke="#dff6ff" strokeOpacity="0.6" strokeWidth="1.4">
        {[
          [24, 150, 4, 0],
          [36, 120, 3, 1.2],
          [292, 160, 5, 0.6],
          [280, 110, 3, 2],
          [300, 70, 2.5, 1.6],
          [18, 80, 2.5, 2.4],
        ].map(([x, y, r, d], i) => (
          <circle key={i} cx={x} cy={y} r={r} className={styles.rise} style={{ animationDelay: `-${d}s` }} />
        ))}
      </g>
      <path d="M-160 186c80-12 160-2 240-8s120-10 200-4 120 8 200 0v26h-640z" fill="#d9b27a" opacity="0.6" />
      <g fill="none" stroke="#dff6ff" strokeOpacity="0.6" strokeWidth="1.4">
        {[
          [-120, 150, 4, 0.4],
          [-60, 120, 3, 1.8],
          [380, 140, 4, 1],
          [440, 100, 3, 2.6],
        ].map(([x, y, r, d], i) => (
          <circle key={i} cx={x} cy={y} r={r} className={styles.rise} style={{ animationDelay: `-${d}s` }} />
        ))}
      </g>
      <path d="M-130 196c-8-24 10-40 0-66s8-30 2-40" stroke="#3ecf8e" strokeWidth="6" fill="none" strokeLinecap="round" />
      <path d="M-100 196c6-20-8-34 2-56" stroke="#1fae6f" strokeWidth="5" fill="none" strokeLinecap="round" />
      <path d="M-40 196V150c0-8-10-14-10-26M-40 166c8-6 18-4 20-18M-40 178c-10-4-22 0-26-14" stroke="#ff7a8a" strokeWidth="7" fill="none" strokeLinecap="round" opacity="0.85" />
      <g transform="translate(-80 70)">
        <path d="M14 0l9-6v12z" fill="#ff9f2e" />
        <circle r="14" fill="#ffc23d" stroke="#b85c0b" strokeWidth="1.2" />
        <circle cx="-5" cy="-3" r="4" fill="#fff" />
        <circle cx="-6" cy="-3" r="2" fill="#1b1030" />
      </g>
      <path d="M380 196c0-20 14-28 14-50s-10-26-4-44" stroke="#ffb27a" strokeWidth="6" fill="none" strokeLinecap="round" opacity="0.8" />
      <path d="M440 196c-8-24 10-40 0-66" stroke="#3ecf8e" strokeWidth="6" fill="none" strokeLinecap="round" />
      <path d="M396 60l5 11 12 1-9 8 3 12-11-6-11 6 3-12-9-8 12-1z" fill="#ff8a3d" stroke="#a8400f" strokeWidth="1.2" strokeLinejoin="round" />
      <path d="M22 196c-6-18 8-30 0-50" stroke="#3ecf8e" strokeWidth="5" fill="none" strokeLinecap="round" />
      <path d="M300 196c6-18-8-30 0-50" stroke="#1fae6f" strokeWidth="5" fill="none" strokeLinecap="round" />
      <rect x="56" y="32" width="208" height="140" rx="22" fill="#a8341f" stroke="#ffb27a" strokeWidth="3" />
      {reel(68, styles.reelA, [puffer, star, chest, pearl])}
      {reel(131, styles.reelB, [chest, pearl, puffer, star])}
      {reel(194, styles.reelC, [pearl, puffer, star, chest])}
      <rect x="62" y="88" width="196" height="28" rx="6" fill="none" stroke="#7ef0e0" strokeWidth="2" className={styles.pulse} filter="url(#cv-glow)" />
    </Frame>
  );
}

function Crash() {
  return (
    <Frame id="crash" from="#3a1d0a" to="#080b18">
      <Stars pts={[[40, 30, 1.3], [110, 54, 1], [200, 26, 1.4], [270, 60, 1.1], [150, 90, 1], [60, 110, 1.2]]} />
      <g stroke="#fff" strokeOpacity="0.07">
        <path d="M0 150h320M0 110h320M0 70h320M80 0v200M160 0v200M240 0v200" />
      </g>
      <path d="M20 176C120 170 200 140 262 44L262 176z" fill="#ff8a1f" opacity="0.16" className={styles.fadeLoop} />
      <path d="M20 176C120 170 200 140 262 44" fill="none" stroke="#ff8a1f" strokeWidth="4" strokeLinecap="round" pathLength="100" className={styles.trace} filter="url(#cv-glow)" />
      <g className={styles.rocket}>
        <g transform="rotate(32)">
          <path d="M0 -20c8 6 10 18 8 30h-16c-2-12 0-24 8-30z" fill="#eef2f8" />
          <circle cy="-4" r="3.6" fill="#3ddcff" />
          <path d="M-8 6l-7 9 7-2zM8 6l7 9-7-2z" fill="#ff8a1f" />
          <path d="M-4 11h8l-4 14z" fill="#ffd27a" className={styles.flame} />
        </g>
      </g>
      <text x="26" y="52" fontSize="30" fontWeight="700" fontFamily="var(--font-mono), monospace" fill="#3ddcff" filter="url(#cv-glow)">
        2.47×
      </text>
    </Frame>
  );
}

function Dice() {
  const pip = (x: number, y: number) => <circle cx={x} cy={y} r="5" fill="#06080f" />;
  return (
    <Frame id="dice" from="#0d3350" to="#080b18">
      <Stars pts={[[36, 30, 1.2], [290, 40, 1.3], [250, 22, 1], [60, 80, 1.1]]} />
      <g className={styles.tumble}>
        <rect x="-38" y="-38" width="76" height="76" rx="16" fill="url(#cv-cyan)" stroke="#e9fbff" strokeOpacity="0.6" strokeWidth="2" />
        {pip(-18, -18)}
        {pip(18, -18)}
        {pip(0, 0)}
        {pip(-18, 18)}
        {pip(18, 18)}
      </g>
      <g className={styles.tumbleB}>
        <rect x="-26" y="-26" width="52" height="52" rx="12" fill="url(#cv-gold)" stroke="#fff" strokeOpacity="0.5" strokeWidth="2" />
        <circle cx="-11" cy="-11" r="4" fill="#06080f" />
        <circle cx="11" cy="11" r="4" fill="#06080f" />
      </g>
      <rect x="40" y="160" width="240" height="10" rx="5" fill="#1b2236" />
      <rect x="40" y="160" width="130" height="10" rx="5" fill="url(#cv-green)" />
      <g className={styles.slide}>
        <rect x="-7" y="152" width="14" height="26" rx="5" fill="#eef2f8" />
      </g>
    </Frame>
  );
}

function Roulette() {
  const seg = Array.from({ length: 18 }, (_, i) => i);
  return (
    <Frame id="roulette" from="#4a1226" to="#090b18">
      <Stars pts={[[28, 28, 1.2], [292, 26, 1.3], [300, 170, 1.1], [22, 176, 1.2]]} />
      <g transform="translate(160 104)">
        <circle r="84" fill="#141c33" stroke="url(#cv-gold)" strokeWidth="5" />
        <g className={styles.wheel}>
          {seg.map((i) => (
            <path key={i} d="M0 0L-13.2 -75A76 76 0 0 1 13.2 -75z" transform={`rotate(${i * 20})`} fill={i === 0 ? "#23795c" : i % 2 ? "#b9405a" : "#1b2236"} stroke="#0a0f1d" strokeWidth="1" />
          ))}
          <circle r="46" fill="#0c1120" stroke="url(#cv-gold)" strokeWidth="3" />
          <path d="M0 -40V40M-40 0H40" stroke="url(#cv-gold)" strokeWidth="5" strokeLinecap="round" />
          <circle r="9" fill="url(#cv-gold)" />
        </g>
        <g className={styles.ball}>
          <circle cy="-62" r="6" fill="#fff" filter="url(#cv-glow)" />
        </g>
      </g>
    </Frame>
  );
}

function Plinko() {
  const pegs: [number, number][] = [];
  for (let row = 0; row < 6; row++) for (let j = 0; j <= row + 2; j++) pegs.push([160 + (j - (row + 2) / 2) * 30, 30 + row * 22]);
  const mult = ["9", "3", "1.2", ".5", ".5", "1.2", "3", "9"];
  return (
    <Frame id="plinko" from="#123a3a" to="#080b18">
      <g fill="#c9d4ea">
        {pegs.map(([x, y], i) => (
          <circle key={i} cx={x} cy={y} r="3.2" />
        ))}
      </g>
      {mult.map((m, k) => {
        const hot = k === 0 || k === 7;
        const warm = k === 1 || k === 6;
        return (
          <g key={k} transform={`translate(${55 + k * 30} 168)`} className={k === 6 ? styles.slotHit : undefined}>
            <rect x="-13" y="0" width="26" height="18" rx="5" fill={hot ? "#ff8a1f" : warm ? "#b8651c" : "#1b2236"} />
            <text y="13" textAnchor="middle" fontSize="10" fontWeight="700" fontFamily="var(--font-mono), monospace" fill={hot || warm ? "#06080f" : "#8290a8"}>
              {m}
            </text>
          </g>
        );
      })}
      <circle r="7" fill="#3ddcff" filter="url(#cv-glow)" className={styles.drop} />
    </Frame>
  );
}

function Mines() {
  const tiles = Array.from({ length: 15 }, (_, i) => i);
  const gems = new Set([1, 4, 7, 11, 13]);
  return (
    <Frame id="mines" from="#0f3a2a" to="#080b18">
      <g transform="translate(62 22)">
        {tiles.map((i) => {
          const x = (i % 5) * 40;
          const y = Math.floor(i / 5) * 40;
          const gem = gems.has(i);
          const mine = i === 8;
          return (
            <g key={i} transform={`translate(${x} ${y})`}>
              <rect width="34" height="34" rx="8" fill={gem ? "#12382a" : mine ? "#3a1d0a" : "#1b2440"} stroke={gem ? "#3ecf8e" : mine ? "#ff8a1f" : "#2c3960"} strokeWidth="1.5" />
              {gem && (
                <g transform="translate(17 17)" className={styles.gem} style={{ animationDelay: `${-(i % 4) * 0.7}s` }}>
                  <path d="M-7 -8h14l5 6-12 12-12-12z" fill="url(#cv-green)" />
                  <path d="M-7 -8h14l-7 4z" fill="#eafff4" opacity="0.8" />
                </g>
              )}
              {mine && (
                <g transform="translate(17 18)" className={styles.mine}>
                  <circle r="8" fill="#eef2f8" />
                  <path d="M0 -13v4M0 9v4M-13 0h4M9 0h4M-9 -9l3 3M9 -9l-3 3" stroke="#eef2f8" strokeWidth="2.4" strokeLinecap="round" />
                  <circle cx="-3" cy="-3" r="2" fill="#ff8a1f" />
                </g>
              )}
            </g>
          );
        })}
      </g>
      <text x="160" y="176" textAnchor="middle" fontSize="22" fontWeight="700" fontFamily="var(--font-mono), monospace" fill="#3ecf8e" filter="url(#cv-glow)" className={styles.pulse}>
        ×3.61
      </text>
    </Frame>
  );
}

const COVERS: Record<GameId, (p: { wide?: boolean }) => ReactNode> = { slots: Slots, reef: Reef, crash: Crash, dice: Dice, roulette: Roulette, plinko: Plinko, mines: Mines };

export function GameCover({ game, wide }: { game: GameId; wide?: boolean }) {
  const C = COVERS[game];
  return <C wide={wide} />;
}
