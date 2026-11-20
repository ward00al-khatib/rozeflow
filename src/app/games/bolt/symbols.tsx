/* ROZEFLOW "Little Bolt" symbols: our own scrapyard-robot cast, drawn as SVG (no image files). */
import type { BoltSymbol } from "@/lib/games/bolt";

export const BOLT_NAMES: Record<BoltSymbol, string> = {
  rocket: "الصاروخ",
  magnet: "المغناطيس",
  bulb: "المصباح",
  gear: "الترس",
  nut: "الصامولة",
  spring: "النابض",
  bot: "بُرغي WILD",
  core: "نواة الطاقة",
};

/** Shared gradients and filters, rendered once per page. */
export function BoltDefs() {
  return (
    <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden="true">
      <defs>
        <linearGradient id="bt-shell" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="0.55" stopColor="#e3e9f3" />
          <stop offset="1" stopColor="#a9b6c9" />
        </linearGradient>
        <linearGradient id="bt-orange" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffc08a" />
          <stop offset="0.5" stopColor="#ff8a3d" />
          <stop offset="1" stopColor="#c9521a" />
        </linearGradient>
        <linearGradient id="bt-visor" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#1a2a4f" />
          <stop offset="1" stopColor="#070d1d" />
        </linearGradient>
        <radialGradient id="bt-core" cx="50%" cy="50%" r="55%">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="0.3" stopColor="#b5f4ff" />
          <stop offset="0.7" stopColor="#3ddcff" />
          <stop offset="1" stopColor="#0b5fa0" />
        </radialGradient>
        <linearGradient id="bt-steel" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#e6edf7" />
          <stop offset="0.5" stopColor="#8fa0b8" />
          <stop offset="1" stopColor="#4d5c74" />
        </linearGradient>
        <linearGradient id="bt-bronze" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ffe0a8" />
          <stop offset="0.5" stopColor="#d99a3d" />
          <stop offset="1" stopColor="#8a5414" />
        </linearGradient>
        <linearGradient id="bt-red" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ff9a8a" />
          <stop offset="0.5" stopColor="#ef3f3f" />
          <stop offset="1" stopColor="#9c1630" />
        </linearGradient>
        <radialGradient id="bt-bulb" cx="45%" cy="38%" r="60%">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="0.35" stopColor="#fff3a6" />
          <stop offset="0.8" stopColor="#ffd23d" />
          <stop offset="1" stopColor="#e09a12" />
        </radialGradient>
        <linearGradient id="bt-green" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#1fae6f" />
          <stop offset="0.5" stopColor="#a7ffd6" />
          <stop offset="1" stopColor="#1fae6f" />
        </linearGradient>
        <radialGradient id="bt-tile" cx="50%" cy="40%" r="65%">
          <stop offset="0" stopColor="#2a3550" />
          <stop offset="1" stopColor="#121a2e" />
        </radialGradient>
        <filter id="bt-glow" x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur stdDeviation="2.4" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
    </svg>
  );
}

/** Bolt's head, used by the WILD symbol and the lobby cover. Eyes blink on their own. */
export function BotHead({ x = 0, y = 0, s = 1 }: { x?: number; y?: number; s?: number }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`}>
      {/* antenna */}
      <path d="M50 22V8" stroke="#8fa0b8" strokeWidth="3" strokeLinecap="round" />
      <circle cx="50" cy="7" r="5.5" fill="#ff8a3d" className="sx-antenna" filter="url(#bt-glow)" />
      {/* screw ears */}
      <circle cx="13" cy="50" r="8" fill="url(#bt-steel)" stroke="#33405a" strokeWidth="1.5" />
      <path d="M9 50h8M13 46v8" stroke="#33405a" strokeWidth="2" strokeLinecap="round" />
      <circle cx="87" cy="50" r="8" fill="url(#bt-steel)" stroke="#33405a" strokeWidth="1.5" />
      <path d="M83 50h8M87 46v8" stroke="#33405a" strokeWidth="2" strokeLinecap="round" />
      {/* head */}
      <rect x="17" y="21" width="66" height="58" rx="22" fill="url(#bt-shell)" stroke="#33405a" strokeWidth="2" />
      <rect x="25" y="31" width="50" height="34" rx="14" fill="url(#bt-visor)" />
      {/* LED eyes */}
      <g className="sx-eyes" fill="#3ddcff" filter="url(#bt-glow)">
        <rect x="34" y="40" width="9" height="15" rx="4.5" />
        <rect x="57" y="40" width="9" height="15" rx="4.5" />
      </g>
      <path d="M44 59q6 4 12 0" stroke="#3ddcff" strokeWidth="2.2" fill="none" strokeLinecap="round" opacity="0.85" />
      <circle cx="29" cy="69" r="3" fill="#ff8fc8" opacity="0.7" />
      <circle cx="71" cy="69" r="3" fill="#ff8fc8" opacity="0.7" />
      <path d="M30 27q20-6 40 0" stroke="#fff" strokeWidth="2.5" fill="none" strokeLinecap="round" opacity="0.8" />
    </g>
  );
}

export function BoltSym({ s, className }: { s: BoltSymbol; className?: string }) {
  return (
    <svg viewBox="0 0 100 100" className={className} aria-label={BOLT_NAMES[s]} role="img">
      {s !== "bot" && s !== "core" && <rect x="6" y="6" width="88" height="88" rx="22" fill="url(#bt-tile)" stroke="rgb(255 255 255 / 0.07)" />}
      {SYMBOLS[s]}
    </svg>
  );
}

const SYMBOLS: Record<BoltSymbol, React.ReactNode> = {
  bot: (
    <g className="sx-bounce">
      <rect x="4" y="4" width="92" height="92" rx="24" fill="#2a1240" stroke="#ff8a3d" strokeWidth="3" />
      <rect x="4" y="4" width="92" height="92" rx="24" fill="url(#bt-orange)" opacity="0.18" />
      <BotHead x={8} y={2} s={0.84} />
      <rect x="24" y="76" width="52" height="17" rx="8.5" fill="url(#bt-orange)" stroke="#7a2d0a" strokeWidth="1.5" />
      <text x="50" y="89" textAnchor="middle" fontSize="13" fontWeight="800" fill="#0b1530" fontFamily="var(--font-mono), monospace">
        WILD
      </text>
    </g>
  ),
  core: (
    <g>
      <g className="sx-wave">
        <circle cx="50" cy="50" r="44" fill="none" stroke="#3ddcff" strokeWidth="2" strokeDasharray="10 8" opacity="0.7" />
      </g>
      <g className="sx-shine">
        <path d="M50 10l34 20v40L50 90 16 70V30z" fill="#0b2346" stroke="#7fe8ff" strokeWidth="3" strokeLinejoin="round" />
        <path d="M50 20l25 15v30L50 80 25 65V35z" fill="url(#bt-core)" filter="url(#bt-glow)" />
        <path d="M54 26L38 54h11l-4 20 17-30H51z" fill="#fff8d6" stroke="#ff8a3d" strokeWidth="2" strokeLinejoin="round" />
      </g>
    </g>
  ),
  rocket: (
    <g className="sx-wobble">
      <path d="M50 76l-7 14h14z" fill="#ffd23d" className="sx-flash" />
      <path d="M50 14c14 10 18 30 14 56H36c-4-26 0-46 14-56z" fill="url(#bt-shell)" stroke="#33405a" strokeWidth="2" />
      <path d="M50 14c7 5 11 11 13 18H37c2-7 6-13 13-18z" fill="url(#bt-red)" />
      <circle cx="50" cy="44" r="8" fill="#3ddcff" stroke="#33405a" strokeWidth="2.5" />
      <circle cx="47.5" cy="41.5" r="2.5" fill="#fff" />
      <path d="M36 56l-12 16 13-3zM64 56l12 16-13-3z" fill="url(#bt-red)" stroke="#6a0f1f" strokeWidth="1.5" strokeLinejoin="round" />
      <rect x="42" y="68" width="16" height="7" rx="2" fill="#4d5c74" />
    </g>
  ),
  magnet: (
    <g className="sx-shine">
      <path d="M28 26v26a22 22 0 0044 0V26H58v26a8 8 0 01-16 0V26z" fill="url(#bt-red)" stroke="#6a0f1f" strokeWidth="2" strokeLinejoin="round" />
      <rect x="28" y="18" width="14" height="12" rx="2" fill="url(#bt-steel)" stroke="#33405a" strokeWidth="1.5" />
      <rect x="58" y="18" width="14" height="12" rx="2" fill="url(#bt-steel)" stroke="#33405a" strokeWidth="1.5" />
      <g stroke="#7fe8ff" strokeWidth="2" fill="none" strokeLinecap="round" opacity="0.85" className="sx-flash">
        <path d="M24 14q-8-6-2-12" />
        <path d="M76 14q8-6 2-12" />
        <path d="M44 12q6-6 12 0" />
      </g>
    </g>
  ),
  bulb: (
    <g className="sx-flash">
      <circle cx="50" cy="40" r="26" fill="#ffd23d" opacity="0.18" />
      <path d="M50 14a24 24 0 00-14 43c4 3 5 7 5 11h18c0-4 1-8 5-11a24 24 0 00-14-43z" fill="url(#bt-bulb)" stroke="#a86a0a" strokeWidth="2" />
      <path d="M43 52l4-12 3 8 3-8 4 12" stroke="#c9521a" strokeWidth="2" fill="none" strokeLinejoin="round" />
      <rect x="40" y="68" width="20" height="6" rx="2" fill="url(#bt-steel)" />
      <rect x="41" y="74" width="18" height="6" rx="2" fill="url(#bt-steel)" />
      <path d="M45 82h10l-2 5h-6z" fill="#4d5c74" />
      <path d="M38 26q4-6 10-7" stroke="#fff" strokeWidth="3" fill="none" strokeLinecap="round" />
    </g>
  ),
  gear: (
    <g className="sx-spin">
      <path
        d="M46 14h8l2 9 7 3 8-5 6 6-5 8 3 7 9 2v8l-9 2-3 7 5 8-6 6-8-5-7 3-2 9h-8l-2-9-7-3-8 5-6-6 5-8-3-7-9-2v-8l9-2 3-7-5-8 6-6 8 5 7-3z"
        fill="url(#bt-steel)"
        stroke="#33405a"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <circle cx="50" cy="50" r="13" fill="#121a2e" stroke="#3ddcff" strokeWidth="2.5" />
      <circle cx="50" cy="50" r="5" fill="#3ddcff" />
    </g>
  ),
  nut: (
    <g className="sx-spin">
      <path d="M50 16l29 17v34L50 84 21 67V33z" fill="url(#bt-bronze)" stroke="#5e3608" strokeWidth="2.5" strokeLinejoin="round" />
      <circle cx="50" cy="50" r="15" fill="#121a2e" stroke="#5e3608" strokeWidth="2.5" />
      <path d="M38 44a14 14 0 018-8" stroke="#ffe0a8" strokeWidth="2" fill="none" strokeLinecap="round" />
      <path d="M30 32l20-11" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" opacity="0.6" />
    </g>
  ),
  spring: (
    <g className="sx-bounce">
      <rect x="30" y="16" width="40" height="7" rx="3" fill="url(#bt-steel)" />
      <path
        d="M36 24L66 31L34 38L66 45L34 52L66 59L34 66L66 73L36 79"
        stroke="#0d5c3a"
        strokeWidth="9"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M36 24L66 31L34 38L66 45L34 52L66 59L34 66L66 73L36 79"
        stroke="url(#bt-green)"
        strokeWidth="5.5"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <rect x="30" y="77" width="40" height="7" rx="3" fill="url(#bt-steel)" />
    </g>
  ),
};
