/** Agents who hand out free points (spec appendix س). Points have no price and cannot be withdrawn. */

export type TransferKind = "GRANT" | "REVOKE" | "PASS" | "RECLAIM" | "GIFT" | "CANCEL";

export interface AgentTransfer {
  id: number;
  ref: string;
  kind: TransferKind;
  amount: number;
  created_at: string;
  note: string | null;
  allowance_after: number | null;
  outgoing: boolean;
  other_name: string;
  other_no: number | null;
  cancelled?: boolean;
  can_cancel?: boolean;
}

export interface SubAgent {
  user_id: string;
  display_name: string;
  player_no: number;
  status: "active" | "frozen";
  allowance: number;
  gifted_total: number;
}

export interface AgentDashboard {
  tier: "master" | "sub";
  status: "active" | "frozen";
  parent_active: boolean;
  parent_name: string | null;
  allowance: number;
  gifted_today: number;
  gifted_total: number;
  players: number;
  subs: SubAgent[];
  transfers: AgentTransfer[];
}

export interface OwnerAgentRow {
  user_id: string;
  display_name: string;
  player_no: number;
  parent_id: string | null;
  parent_name: string | null;
  status: "active" | "frozen" | "closed";
  allowance: number;
  note: string | null;
  created_at: string;
  granted: number;
  gifted: number;
  players: number;
  last_gift_at: string | null;
}

export interface OwnerTransferRow {
  id: number;
  ref: string;
  kind: TransferKind;
  amount: number;
  created_at: string;
  note: string | null;
  actor_name: string;
  from_name: string | null;
  from_no: number | null;
  to_name: string | null;
  to_no: number | null;
}

export interface AgentOverview {
  totals: { granted: number; revoked: number; gifted: number; cancelled?: number; players: number };
  outstanding: number;
  agents: OwnerAgentRow[];
  transfers: OwnerTransferRow[];
}

export const KIND_LABELS: Record<TransferKind, string> = {
  GRANT: "منح من الإدارة",
  REVOKE: "استرجاع إلى الإدارة",
  PASS: "تمرير لوكيل فرعي",
  RECLAIM: "استرجاع من وكيل فرعي",
  GIFT: "هدية للاعب",
  CANCEL: "إلغاء هدية",
};

export const STATUS_LABELS: Record<OwnerAgentRow["status"], string> = {
  active: "يعمل",
  frozen: "مجمّد",
  closed: "منتهية وكالته",
};

export const AGENT_ERRORS: Record<string, string> = {
  BAD_AMOUNT: "اكتب عدد نقاط صحيحاً، من 1 إلى 1,000,000.",
  BAD_KEY: "حدث خطأ في الطلب. حدّث الصفحة وحاول مرة أخرى.",
  KEY_REUSED: "هذا الطلب أُرسل من قبل بقيم أخرى. حدّث الصفحة وحاول مرة أخرى.",
  ALLOWANCE_LOW: "الحصة المتبقية لا تكفي.",
  PLAYER_NOT_FOUND: "لا يوجد عضو فعّال بهذا الرقم.",
  SELF_SEND: "لا يمكن الإرسال إلى نفسك.",
  NOT_AGENT: "هذا الحساب ليس وكيلاً.",
  AGENT_FROZEN: "الوكالة مجمّدة حالياً.",
  AGENT_CLOSED: "انتهت هذه الوكالة.",
  ALREADY_AGENT: "هذا العضو وكيل بالفعل.",
  OWNER_ACCOUNT: "حساب المالك لا يكون وكيلاً.",
  MASTER_ONLY: "هذا للوكيل الرئيسي فقط.",
  NOT_MASTER: "اختر وكيلاً رئيسياً فعّالاً.",
  NOT_YOUR_SUB: "هذا ليس من وكلائك الفرعيين.",
  TOO_MANY_SUBS: "وصلت إلى 50 وكيلاً فرعياً.",
  HAS_SUBS: "أنهِ وكالات الوكلاء الفرعيين أولاً.",
  NOTHING_TO_RECLAIM: "لا توجد حصة متبقية لاسترجاعها.",
  RATE_LIMITED: "عمليات كثيرة خلال دقيقة. انتظر قليلاً.",
  OWNER_ONLY: "هذا لمالك الموقع فقط.",
  PLAYER_IS_AGENT: "هذا الحساب وكيل، والوكلاء لا يلعبون فلا يستقبلون نقاطاً.",
  GIFT_NOT_FOUND: "لا توجد هدية منك بهذا الرقم المرجعي.",
  CANCEL_TOO_LATE: "مضت أكثر من 10 دقائق على الهدية، فلا يمكن إلغاؤها.",
  POINTS_USED: "اللاعب لعب بعد الهدية أو لم يعد رصيده يكفي، فلا يمكن إلغاؤها.",
  AGENT_NO_PLAY: "حساب الوكيل لا يلعب.",
  DEVICE_NOT_APPROVED: "هذا الجهاز ينتظر موافقة المالك.",
  DEVICE_BLOCKED: "هذا الجهاز موقوف.",
  DEVICE_UNKNOWN: "حدّث الصفحة ثم حاول مرة أخرى.",
  ACCOUNT_NOT_ACTIVE: "حسابك موقوف حالياً.",
};

export function agentError(message: string | undefined, fallback = "لم تتم العملية. حاول مرة أخرى."): string {
  return (message && AGENT_ERRORS[message]) || fallback;
}

/** Whole points typed by a person → centi-points, or null when not a whole number from 1 to 1,000,000. */
export function pointsToCenti(text: string): number | null {
  const t = text.trim();
  if (!/^[0-9]{1,7}$/.test(t)) return null;
  const n = Number(t);
  if (n < 1 || n > 1_000_000) return null;
  return n * 100;
}

/** A player number as typed (digits only), or null. */
export function parsePlayerNo(text: string): number | null {
  const t = text.trim().replace(/^#/, "");
  if (!/^[0-9]{1,12}$/.test(t)) return null;
  return Number(t);
}

/** One key per intended movement: retrying the same request never moves points twice. */
export function newKey(): string {
  return crypto.randomUUID();
}

export const fmtWhen = (iso: string) =>
  new Date(iso).toLocaleString("ar-SY-u-nu-latn", { dateStyle: "medium", timeStyle: "short" });
