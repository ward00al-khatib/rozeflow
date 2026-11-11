/* ROZEFLOW "Night Lab" slot symbols, drawn as SVG (no image files). */
import type { SlotSymbol } from "@/lib/games/slots";

export const SYMBOL_NAMES: Record<SlotSymbol, string> = {
  atom: "الذرّة",
  crystal: "البلّورة",
  flask: "الدورق",
  planet: "الكوكب",
  bolt: "الصاعقة",
  ring: "الحلقة",
  tri: "المثلث",
  square: "المربع",
  diamond: "المعيّن",
  wild: "WILD",
  scatter: "البونص",
};

/** Shared gradients, rendered once per page. */
export function SymbolDefs() {
  return (
    <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden="true">
      <defs>
        <radialGradient id="sx-plate" cx="50%" cy="35%" r="70%">
          <stop offset="0" stopColor="#1d2742" />
          <stop offset="1" stopColor="#0a0f1d" />
        </radialGradient>
        <linearGradient id="sx-gold" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffe08a" />
          <stop offset="0.5" stopColor="#ffae3d" />
          <stop offset="1" stopColor="#d9731a" />
        </linearGradient>
        <linearGradient id="sx-cyan" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#b5f4ff" />
          <stop offset="0.5" stopColor="#3ddcff" />
          <stop offset="1" stopColor="#0f86c9" />
        </linearGradient>
        <linearGradient id="sx-violet" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#e3c8ff" />
          <stop offset="0.45" stopColor="#a66bff" />
          <stop offset="1" stopColor="#5b2bc4" />
        </linearGradient>
        <linearGradient id="sx-green" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#a7ffd6" />
          <stop offset="1" stopColor="#1fae6f" />
        </linearGradient>
        <linearGradient id="sx-orange" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ffd2a1" />
          <stop offset="0.5" stopColor="#ff8a1f" />
          <stop offset="1" stopColor="#b84c0b" />
        </linearGradient>
        <linearGradient id="sx-rose" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ffc2d4" />
          <stop offset="1" stopColor="#e2557f" />
        </linearGradient>
        <linearGradient id="sx-steel" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#dfe6f3" />
          <stop offset="1" stopColor="#7d8aa6" />
        </linearGradient>
        <radialGradient id="sx-flow" cx="50%" cy="50%" r="50%">
          <stop offset="0" stopColor="#e9fbff" />
          <stop offset="0.35" stopColor="#3ddcff" />
          <stop offset="1" stopColor="#0b3b66" />
        </radialGradient>
        <filter id="sx-glow" x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="2.2" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
    </svg>
  );
}

function Plate({ rim }: { rim: string }) {
  return (
    <>
      <circle cx="50" cy="50" r="44" fill="url(#sx-plate)" />
      <circle cx="50" cy="50" r="44" fill="none" stroke={rim} strokeWidth="5" />
      <circle cx="50" cy="50" r="38.5" fill="none" stroke="#ffffff" strokeOpacity="0.07" strokeWidth="1.5" />
      <path d="M18 38a34 34 0 0 1 64 0" fill="none" stroke="#fff" strokeOpacity="0.08" strokeWidth="6" strokeLinecap="round" />
    </>
  );
}

export function Symbol({ s, className }: { s: SlotSymbol; className?: string }) {
  return (
    <svg viewBox="0 0 100 100" className={className} role="img" aria-label={SYMBOL_NAMES[s]}>
      {art(s)}
    </svg>
  );
}

function art(s: SlotSymbol) {
  switch (s) {
    case "atom":
      return (
        <>
          <Plate rim="url(#sx-gold)" />
          <g className="sx-spin" fill="none" stroke="url(#sx-cyan)" strokeWidth="4" filter="url(#sx-glow)">
            <ellipse cx="50" cy="50" rx="30" ry="11" />
            <ellipse cx="50" cy="50" rx="30" ry="11" transform="rotate(60 50 50)" />
            <ellipse cx="50" cy="50" rx="30" ry="11" transform="rotate(-60 50 50)" />
          </g>
          <circle cx="50" cy="50" r="8.5" fill="url(#sx-orange)" />
          <circle cx="47.5" cy="47.5" r="2.6" fill="#fff" opacity="0.8" />
          <circle cx="80" cy="50" r="3.4" fill="#e9fbff" />
          <circle cx="35" cy="24" r="3.4" fill="#e9fbff" />
        </>
      );
    case "crystal":
      return (
        <>
          <Plate rim="url(#sx-violet)" />
          <g className="sx-shine" filter="url(#sx-glow)">
            <path d="M50 16l20 18-20 50-20-50z" fill="url(#sx-violet)" />
            <path d="M50 16l20 18H30z" fill="#efe0ff" opacity="0.75" />
            <path d="M50 34v50M30 34l20 50M70 34L50 84" stroke="#2a0f63" strokeOpacity="0.35" strokeWidth="1.4" />
            <path d="M24 46l9-6 6 16-9 14z" fill="url(#sx-cyan)" opacity="0.85" />
            <path d="M76 46l-9-6-6 16 9 14z" fill="url(#sx-cyan)" opacity="0.85" />
          </g>
        </>
      );
    case "flask":
      return (
        <>
          <Plate rim="url(#sx-green)" />
          <path d="M42 20h16v4h-3v16l17 30a6 6 0 0 1-5 9H33a6 6 0 0 1-5-9l17-30V24h-3z" fill="#cfe9ff" fillOpacity="0.16" stroke="#dff3ff" strokeWidth="2.5" />
          <path d="M33.5 60h33l6.5 11a4 4 0 0 1-3.5 6H30.5a4 4 0 0 1-3.5-6z" fill="url(#sx-green)" filter="url(#sx-glow)" />
          <circle className="sx-bubble" cx="44" cy="68" r="3" fill="#eafff4" opacity="0.8" />
          <circle className="sx-bubble" cx="55" cy="64" r="2" fill="#eafff4" opacity="0.7" />
          <circle className="sx-bubble" cx="52" cy="50" r="2.4" fill="#a7ffd6" opacity="0.8" />
          <circle className="sx-bubble" cx="48" cy="40" r="1.6" fill="#a7ffd6" opacity="0.6" />
        </>
      );
    case "planet":
      return (
        <>
          <Plate rim="url(#sx-orange)" />
          <circle cx="50" cy="50" r="20" fill="url(#sx-orange)" />
          <path d="M33 44c10 3 24 3 34-2M31 54c12 4 26 4 38-1" stroke="#7a2f05" strokeOpacity="0.35" strokeWidth="3" fill="none" />
          <g className="sx-wobble">
            <ellipse cx="50" cy="52" rx="36" ry="9" fill="none" stroke="url(#sx-cyan)" strokeWidth="4" transform="rotate(-14 50 52)" />
          </g>
          <circle cx="43" cy="42" r="4" fill="#fff" opacity="0.35" />
        </>
      );
    case "bolt":
      return (
        <>
          <Plate rim="url(#sx-cyan)" />
          <path className="sx-flash" d="M56 14L28 56h18l-6 30 32-44H54z" fill="url(#sx-gold)" stroke="#7a3b05" strokeWidth="2" strokeLinejoin="round" filter="url(#sx-glow)" />
          <path d="M53 22L37 50h9" stroke="#fff" strokeOpacity="0.6" strokeWidth="2.5" fill="none" strokeLinecap="round" />
        </>
      );
    case "ring":
      return (
        <g className="sx-bounce" filter="url(#sx-glow)">
          <circle cx="50" cy="50" r="25" fill="none" stroke="url(#sx-cyan)" strokeWidth="13" />
          <path d="M31 40a22 22 0 0 1 22-17" stroke="#fff" strokeOpacity="0.55" strokeWidth="4" fill="none" strokeLinecap="round" />
        </g>
      );
    case "tri":
      return (
        <g className="sx-bounce" filter="url(#sx-glow)">
          <path d="M50 18l32 58H18z" fill="url(#sx-rose)" stroke="#ffe3eb" strokeOpacity="0.5" strokeWidth="2" strokeLinejoin="round" />
          <path d="M50 30l-18 33" stroke="#fff" strokeOpacity="0.45" strokeWidth="4" strokeLinecap="round" />
        </g>
      );
    case "square":
      return (
        <g className="sx-bounce" filter="url(#sx-glow)">
          <rect x="24" y="24" width="52" height="52" rx="10" fill="url(#sx-green)" stroke="#e0fff0" strokeOpacity="0.5" strokeWidth="2" />
          <path d="M32 40v-6a4 4 0 0 1 4-4h8" stroke="#fff" strokeOpacity="0.55" strokeWidth="4" fill="none" strokeLinecap="round" />
        </g>
      );
    case "diamond":
      return (
        <g className="sx-bounce" filter="url(#sx-glow)">
          <path d="M50 16l32 34-32 34-32-34z" fill="url(#sx-steel)" stroke="#fff" strokeOpacity="0.5" strokeWidth="2" strokeLinejoin="round" />
          <path d="M50 26L30 48" stroke="#fff" strokeOpacity="0.6" strokeWidth="4" strokeLinecap="round" />
        </g>
      );
    case "wild":
      return (
        <>
          <path d="M50 4l40 23v46L50 96 10 73V27z" fill="#2b1606" stroke="url(#sx-gold)" strokeWidth="5" />
          <path className="sx-flash" d="M50 13l32 18.5v37L50 87 18 68.5v-37z" fill="url(#sx-orange)" opacity="0.92" />
          <text x="50" y="59" textAnchor="middle" fontSize="23" fontWeight="900" fontFamily="var(--font-mono), monospace" fill="#06080f" letterSpacing="-0.5">
            WILD
          </text>
          <path d="M28 33l22-12 22 12" stroke="#fff" strokeOpacity="0.45" strokeWidth="3" fill="none" strokeLinecap="round" />
        </>
      );
    case "scatter":
      return (
        <>
          <circle cx="50" cy="50" r="44" fill="url(#sx-flow)" filter="url(#sx-glow)" />
          <g className="sx-wave" fill="none" stroke="#e9fbff" strokeWidth="3" strokeLinecap="round" opacity="0.85">
            <path d="M22 44c10-14 24-14 34-4s22 10 26-2" />
            <path d="M18 58c12-12 26-10 36 0s22 10 28 0" opacity="0.6" />
          </g>
          <rect x="17" y="64" width="66" height="22" rx="7" fill="#06080f" opacity="0.85" />
          <text x="50" y="80.5" textAnchor="middle" fontSize="15" fontWeight="900" fontFamily="var(--font-mono), monospace" fill="#ffae5c">
            BONUS
          </text>
        </>
      );
  }
}
