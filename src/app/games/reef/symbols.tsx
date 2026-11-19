/* ROZEFLOW "Bubble Reef" symbols: our own undersea cartoon cast, drawn as SVG (no image files). */
import type { ReefSymbol } from "@/lib/games/reef";

export const REEF_NAMES: Record<ReefSymbol, string> = {
  puffer: "السمكة المنفوخة",
  octo: "الأخطبوط",
  crab: "السلطعون",
  jelly: "قنديل البحر",
  star: "نجمة البحر",
  shell: "الصدفة",
  pearl: "اللؤلؤة WILD",
  chest: "صندوق الكنز",
};

/** Shared gradients, rendered once per page. */
export function ReefDefs() {
  return (
    <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden="true">
      <defs>
        <radialGradient id="rf-bubble" cx="50%" cy="40%" r="60%">
          <stop offset="0" stopColor="#1c5a86" />
          <stop offset="0.75" stopColor="#0c2a4a" />
          <stop offset="1" stopColor="#061a30" />
        </radialGradient>
        <radialGradient id="rf-puffer" cx="40%" cy="35%" r="70%">
          <stop offset="0" stopColor="#fff1a8" />
          <stop offset="0.55" stopColor="#ffc23d" />
          <stop offset="1" stopColor="#e07b12" />
        </radialGradient>
        <radialGradient id="rf-octo" cx="45%" cy="30%" r="70%">
          <stop offset="0" stopColor="#f0d4ff" />
          <stop offset="0.5" stopColor="#b06bff" />
          <stop offset="1" stopColor="#5b2bc4" />
        </radialGradient>
        <radialGradient id="rf-crab" cx="45%" cy="35%" r="70%">
          <stop offset="0" stopColor="#ffc7b0" />
          <stop offset="0.5" stopColor="#ff6a4d" />
          <stop offset="1" stopColor="#b8301e" />
        </radialGradient>
        <radialGradient id="rf-jelly" cx="50%" cy="30%" r="70%">
          <stop offset="0" stopColor="#ffe6f2" />
          <stop offset="0.55" stopColor="#ff8fc8" />
          <stop offset="1" stopColor="#c8478f" />
        </radialGradient>
        <linearGradient id="rf-star" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ffd0a0" />
          <stop offset="0.5" stopColor="#ff8a3d" />
          <stop offset="1" stopColor="#d1521a" />
        </linearGradient>
        <linearGradient id="rf-shell" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff3e6" />
          <stop offset="0.6" stopColor="#ffb8a1" />
          <stop offset="1" stopColor="#e47a7a" />
        </linearGradient>
        <radialGradient id="rf-pearl" cx="38%" cy="32%" r="70%">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="0.45" stopColor="#e9f6ff" />
          <stop offset="0.8" stopColor="#b9d8ff" />
          <stop offset="1" stopColor="#8fa8e8" />
        </radialGradient>
        <linearGradient id="rf-clam" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#7ef0e0" />
          <stop offset="1" stopColor="#1b8f9e" />
        </linearGradient>
        <linearGradient id="rf-gold" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffe89a" />
          <stop offset="0.5" stopColor="#ffbe3d" />
          <stop offset="1" stopColor="#c97a12" />
        </linearGradient>
        <linearGradient id="rf-wood" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#a8643a" />
          <stop offset="1" stopColor="#5e3018" />
        </linearGradient>
        <filter id="rf-glow" x="-30%" y="-30%" width="160%" height="160%">
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

/** A soft bubble behind each sea creature. */
function Bubble({ rim }: { rim: string }) {
  return (
    <>
      <circle cx="50" cy="50" r="44" fill="url(#rf-bubble)" />
      <circle cx="50" cy="50" r="44" fill="none" stroke={rim} strokeWidth="3.5" strokeOpacity="0.85" />
      <path d="M20 36a33 33 0 0 1 22-20" fill="none" stroke="#fff" strokeOpacity="0.28" strokeWidth="4" strokeLinecap="round" />
      <circle cx="74" cy="22" r="2.4" fill="#fff" opacity="0.3" />
    </>
  );
}

/** Cartoon eye: white, pupil looking a little up and to the side, with a highlight. */
function Eye({ x, y, r = 6, look = 1 }: { x: number; y: number; r?: number; look?: number }) {
  return (
    <>
      <circle cx={x} cy={y} r={r} fill="#fff" stroke="#1b1030" strokeOpacity="0.35" strokeWidth="1" />
      <circle cx={x + look * r * 0.25} cy={y - r * 0.1} r={r * 0.5} fill="#1b1030" />
      <circle cx={x + look * r * 0.25 - r * 0.18} cy={y - r * 0.3} r={r * 0.17} fill="#fff" />
    </>
  );
}

export function ReefSym({ s, className }: { s: ReefSymbol; className?: string }) {
  return (
    <svg viewBox="0 0 100 100" className={className} role="img" aria-label={REEF_NAMES[s]}>
      {art(s)}
    </svg>
  );
}

function art(s: ReefSymbol) {
  switch (s) {
    case "puffer":
      // a round pufferfish, puffed up and proud of it
      return (
        <>
          <Bubble rim="url(#rf-gold)" />
          <g className="sx-bounce">
            <path d="M74 50l14-10v20z" fill="#ff9f2e" stroke="#b85c0b" strokeWidth="1.5" strokeLinejoin="round" />
            <g fill="#e07b12">
              {[0, 40, 80, 120, 160, 200, 240, 280, 320].map((a) => (
                <path key={a} d="M47 23l3-7 3 7z" transform={`rotate(${a} 50 50)`} />
              ))}
            </g>
            <circle cx="48" cy="50" r="26" fill="url(#rf-puffer)" stroke="#b85c0b" strokeWidth="1.5" />
            <path d="M30 60c8 8 26 9 36 0" fill="#fff6c9" opacity="0.7" />
            <g fill="#d26a10" opacity="0.5">
              <circle cx="60" cy="40" r="1.6" />
              <circle cx="64" cy="48" r="1.6" />
              <circle cx="58" cy="56" r="1.6" />
            </g>
            <Eye x={38} y={44} r={7} look={-1} />
            <circle cx="30" cy="54" r="3.4" fill="#ff7a8a" opacity="0.55" />
            <ellipse cx="34" cy="58" rx="3.2" ry="2.4" fill="#7a2f05" />
            <path d="M54 58c4 3 9 2 11-1" fill="none" stroke="#b85c0b" strokeWidth="1.6" strokeLinecap="round" />
          </g>
        </>
      );
    case "octo":
      // a purple octopus with a friendly grin and curly arms
      return (
        <>
          <Bubble rim="#c79bff" />
          <g className="sx-wobble">
            <g fill="none" stroke="#8b4fe6" strokeWidth="7" strokeLinecap="round">
              <path d="M32 56c-8 8-10 18-2 22" />
              <path d="M42 60c-3 10-2 18 6 18" />
              <path d="M58 60c3 10 2 18-6 18" />
              <path d="M68 56c8 8 10 18 2 22" />
            </g>
            <g fill="#e8c9ff">
              <circle cx="29" cy="70" r="1.5" />
              <circle cx="44" cy="72" r="1.5" />
              <circle cx="56" cy="72" r="1.5" />
              <circle cx="71" cy="70" r="1.5" />
            </g>
            <path d="M24 46c0-16 12-26 26-26s26 10 26 26c0 10-10 16-26 16S24 56 24 46z" fill="url(#rf-octo)" stroke="#4a1fa0" strokeWidth="1.5" />
            <path d="M34 28c4-4 10-5 14-4" stroke="#fff" strokeOpacity="0.5" strokeWidth="3" fill="none" strokeLinecap="round" />
            <Eye x={41} y={42} r={6.5} />
            <Eye x={59} y={42} r={6.5} />
            <path d="M43 52c4 4 10 4 14 0" fill="none" stroke="#3a1480" strokeWidth="2.2" strokeLinecap="round" />
          </g>
        </>
      );
    case "crab":
      // a coral-red crab waving both claws
      return (
        <>
          <Bubble rim="#ff8f75" />
          <g className="sx-bounce">
            <g stroke="#b8301e" strokeWidth="3.5" strokeLinecap="round">
              <path d="M30 62l-10 8M30 68l-8 10M70 62l10 8M70 68l8 10" />
              <path d="M34 52L22 38M66 52l12-14" />
            </g>
            <path d="M14 30c0-8 8-12 14-8l-4 6 8 2c-2 6-10 9-15 6-2-1-3-3-3-6z" fill="url(#rf-crab)" stroke="#8f2214" strokeWidth="1.3" />
            <path d="M86 30c0-8-8-12-14-8l4 6-8 2c2 6 10 9 15 6 2-1 3-3 3-6z" fill="url(#rf-crab)" stroke="#8f2214" strokeWidth="1.3" />
            <ellipse cx="50" cy="60" rx="24" ry="16" fill="url(#rf-crab)" stroke="#8f2214" strokeWidth="1.5" />
            <path d="M40 34v10M60 34v10" stroke="#b8301e" strokeWidth="3" strokeLinecap="round" />
            <Eye x={40} y={32} r={6} />
            <Eye x={60} y={32} r={6} />
            <path d="M42 64c4 4 12 4 16 0" fill="none" stroke="#6b150a" strokeWidth="2.2" strokeLinecap="round" />
            <circle cx="35" cy="60" r="3" fill="#ffb3a3" opacity="0.6" />
            <circle cx="65" cy="60" r="3" fill="#ffb3a3" opacity="0.6" />
          </g>
        </>
      );
    case "jelly":
      // a pink jellyfish drifting with wavy ribbons
      return (
        <>
          <Bubble rim="#ff9bd0" />
          <g className="sx-shine">
            <g fill="none" stroke="#ff9bd0" strokeWidth="3" strokeLinecap="round" opacity="0.9">
              <path className="sx-wave" d="M36 56c-4 8 4 12 0 20s4 10 2 14" />
              <path className="sx-wave" d="M46 58c-4 8 4 12 0 20" />
              <path className="sx-wave" d="M56 58c4 8-4 12 0 20s-4 8-2 12" />
              <path className="sx-wave" d="M66 56c4 8-4 12 0 18" />
            </g>
            <path d="M24 52c0-18 12-30 26-30s26 12 26 30c-4 4-10 6-13 4-4 3-9 3-13 0-4 3-9 3-13 0-3 2-9 0-13-4z" fill="url(#rf-jelly)" fillOpacity="0.92" stroke="#b03a7c" strokeWidth="1.3" />
            <path d="M33 34c4-6 10-8 16-8" stroke="#fff" strokeOpacity="0.6" strokeWidth="3" fill="none" strokeLinecap="round" />
            <circle cx="42" cy="42" r="3.2" fill="#3a0f2a" />
            <circle cx="58" cy="42" r="3.2" fill="#3a0f2a" />
            <path d="M46 48c2 2 6 2 8 0" fill="none" stroke="#3a0f2a" strokeWidth="2" strokeLinecap="round" />
          </g>
        </>
      );
    case "star":
      // a five-armed sea star with sandy dots
      return (
        <>
          <Bubble rim="#ffb27a" />
          <g className="sx-spin">
            <path
              d="M50 15c3 0 5 12 8 18 6 1 20 2 21 6 1 3-10 10-14 15 2 6 6 19 3 21-3 2-13-6-18-9-5 3-15 11-18 9-3-2 1-15 3-21-4-5-15-12-14-15 1-4 15-5 21-6 3-6 5-18 8-18z"
              fill="url(#rf-star)"
              stroke="#a8400f"
              strokeWidth="1.5"
              strokeLinejoin="round"
            />
            <g fill="#ffe0b8" opacity="0.85">
              <circle cx="50" cy="26" r="1.8" />
              <circle cx="70" cy="40" r="1.8" />
              <circle cx="63" cy="66" r="1.8" />
              <circle cx="37" cy="66" r="1.8" />
              <circle cx="30" cy="40" r="1.8" />
            </g>
            <circle cx="50" cy="48" r="6" fill="#ffcf9a" opacity="0.8" />
          </g>
        </>
      );
    case "shell":
      // a fan-shaped scallop shell
      return (
        <>
          <Bubble rim="#ffc4b0" />
          <g className="sx-shine">
            <path d="M50 78L20 46c0-14 14-24 30-24s30 10 30 24z" fill="url(#rf-shell)" stroke="#b55a5a" strokeWidth="1.6" strokeLinejoin="round" />
            <g stroke="#c96a6a" strokeWidth="1.6" strokeOpacity="0.7" fill="none">
              <path d="M50 78L30 30M50 78L40 24M50 78V22M50 78l10-54M50 78l20-48" />
            </g>
            <path d="M42 78h16l-4 6h-8z" fill="#e47a7a" stroke="#b55a5a" strokeWidth="1.3" />
            <path d="M28 40c4-8 12-12 20-13" stroke="#fff" strokeOpacity="0.6" strokeWidth="3" fill="none" strokeLinecap="round" />
          </g>
        </>
      );
    case "pearl":
      // WILD: an open clam holding a glowing pearl
      return (
        <>
          <circle cx="50" cy="50" r="46" fill="#063349" />
          <circle cx="50" cy="50" r="46" fill="none" stroke="url(#rf-gold)" strokeWidth="4" />
          <path d="M14 46c4-22 20-32 36-32s32 10 36 32c-12-6-24-8-36-8s-24 2-36 8z" fill="url(#rf-clam)" stroke="#0e5e6b" strokeWidth="1.5" />
          <path d="M14 58c12-6 24-8 36-8s24 2 36 8c-4 16-18 24-36 24S18 74 14 58z" fill="url(#rf-clam)" stroke="#0e5e6b" strokeWidth="1.5" />
          <g className="sx-shine" filter="url(#rf-glow)">
            <circle cx="50" cy="48" r="13" fill="url(#rf-pearl)" />
            <circle cx="45" cy="43" r="3.5" fill="#fff" opacity="0.9" />
          </g>
          <rect x="24" y="66" width="52" height="18" rx="6" fill="#06080f" opacity="0.85" />
          <text x="50" y="80" textAnchor="middle" fontSize="14.5" fontWeight="900" fontFamily="var(--font-mono), monospace" fill="#7ef0e0">
            WILD
          </text>
        </>
      );
    case "chest":
      // BONUS: a sunken treasure chest with gold and bubbles
      return (
        <>
          <circle cx="50" cy="50" r="46" fill="#0b2f4f" filter="url(#rf-glow)" />
          <circle cx="50" cy="50" r="46" fill="none" stroke="url(#rf-gold)" strokeWidth="4" />
          <g className="sx-wave">
            <path d="M22 42c0-12 12-18 28-18s28 6 28 18z" fill="url(#rf-wood)" stroke="#3a1a08" strokeWidth="1.5" />
            <path d="M22 42h56v8H22z" fill="#ffd25a" opacity="0.9" />
            <circle cx="36" cy="44" r="4" fill="url(#rf-gold)" />
            <circle cx="50" cy="42" r="4.4" fill="url(#rf-gold)" />
            <circle cx="64" cy="44" r="4" fill="url(#rf-gold)" />
            <rect x="22" y="48" width="56" height="18" rx="2" fill="url(#rf-wood)" stroke="#3a1a08" strokeWidth="1.5" />
            <path d="M22 48h56M36 24v42M64 24v42" stroke="url(#rf-gold)" strokeWidth="3.5" />
            <rect x="45" y="50" width="10" height="10" rx="2" fill="url(#rf-gold)" stroke="#7a4a05" strokeWidth="1" />
          </g>
          <circle className="sx-bubble" cx="30" cy="30" r="3" fill="#cdefff" opacity="0.8" />
          <circle className="sx-bubble" cx="70" cy="26" r="2.4" fill="#cdefff" opacity="0.7" />
          <circle className="sx-bubble" cx="58" cy="18" r="1.8" fill="#cdefff" opacity="0.7" />
          <rect x="18" y="68" width="64" height="18" rx="6" fill="#06080f" opacity="0.85" />
          <text x="50" y="82" textAnchor="middle" fontSize="14.5" fontWeight="900" fontFamily="var(--font-mono), monospace" fill="#ffbe3d">
            BONUS
          </text>
        </>
      );
  }
}
