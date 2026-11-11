/** Win size labels shared by all games, by gross ÷ stake. */
export type WinTier = "none" | "small" | "medium" | "big" | "epic";

export const WIN_TIER_LABEL: Record<Exclude<WinTier, "none">, string> = {
  small: "فوز",
  medium: "فوز كبير",
  big: "فوز ضخم",
  epic: "فوز أسطوري",
};

/** Thresholds in multiples of the stake: small above 1×, medium from 5×, big from 20×, epic from 100×. */
export function winTier(gross: number, stake: number): WinTier {
  if (stake <= 0 || gross <= stake) return "none";
  const x = gross / stake;
  if (x >= 100) return "epic";
  if (x >= 20) return "big";
  if (x >= 5) return "medium";
  return "small";
}

/** Tone for a history chip: the win tier, or "loss" when the round paid back less than the stake. */
export function resultTone(gross: number, stake: number): WinTier | "loss" {
  const t = winTier(gross, stake);
  return t === "none" ? "loss" : t;
}
