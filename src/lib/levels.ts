/**
 * Member levels and titles (spec appendix ي), from lifetime points wagered in settled rounds.
 * Thresholds are in centi-points. Levels are cosmetic: they never change odds or payouts.
 */
export interface Level {
  n: number;
  title: string;
  from: number;
}

export const LEVELS: Level[] = [
  { n: 1, title: "مبتدئ", from: 0 },
  { n: 2, title: "مستكشف", from: 1_000_00 },
  { n: 3, title: "لاعب", from: 5_000_00 },
  { n: 4, title: "متمرّس", from: 20_000_00 },
  { n: 5, title: "محترف", from: 50_000_00 },
  { n: 6, title: "خبير", from: 150_000_00 },
  { n: 7, title: "نجم", from: 400_000_00 },
  { n: 8, title: "أسطورة", from: 1_000_000_00 },
];

export interface LevelInfo {
  level: Level;
  next: Level | null;
  /** 0..1 progress to the next level; 1 at the top level. */
  progress: number;
  /** centi-points still to wager for the next level. */
  toNext: number;
}

export function levelOf(wagered: number): LevelInfo {
  const w = Math.max(0, wagered);
  let i = 0;
  while (i + 1 < LEVELS.length && w >= LEVELS[i + 1].from) i++;
  const level = LEVELS[i];
  const next = LEVELS[i + 1] ?? null;
  if (!next) return { level, next, progress: 1, toNext: 0 };
  return { level, next, progress: (w - level.from) / (next.from - level.from), toNext: next.from - w };
}
