/** Wallet amounts are stored in centi-points (spec 5.5). Display them as points. */
export function formatPoints(centi: number): string {
  if (!Number.isSafeInteger(centi)) throw new Error("amount must be a safe integer");
  const sign = centi < 0 ? "-" : "";
  const abs = Math.abs(centi);
  const whole = Math.floor(abs / 100).toLocaleString("en-US");
  const frac = abs % 100;
  return frac === 0 ? `${sign}${whole}` : `${sign}${whole}.${String(frac).padStart(2, "0")}`;
}

export const LEDGER_LABELS: Record<string, string> = {
  SIGNUP_GRANT: "منحة التسجيل",
  STAKE_RESERVE: "حجز قيمة الدخول",
  STAKE_CONSUME: "استهلاك قيمة الدخول",
  PAYOUT: "عائد جولة",
  STAKE_RELEASE: "إعادة الحجز",
  RECOVERY_GRANT: "استعادة الرصيد",
  ADMIN_ADJUSTMENT: "تعديل إداري",
  REVERSAL: "قيد عكسي",
};

/** Signed effect of a ledger entry on the available balance (spec 5.2). */
export function availableDelta(type: string, amount: number): number {
  switch (type) {
    case "STAKE_RESERVE":
      return -amount;
    case "STAKE_CONSUME":
      return 0;
    default:
      return amount;
  }
}
