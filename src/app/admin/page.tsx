"use client";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { RtpHistory } from "@/components/RtpHistory";
import { Card, Shell } from "@/components/Shell";
import { formatPoints } from "@/lib/points";
import { siteUrl, supabase } from "@/lib/supabase/client";
import { useMember } from "@/lib/useMember";
import { BonusSetting } from "./BonusSetting";
import { Devices } from "./Devices";
import { Security } from "./Security";
import { OwnerMfaCard, useOwnerMfa } from "./OwnerMfa";
import styles from "./admin.module.css";

interface GameRow {
  game_id: string;
  name_ar: string;
  status: "enabled" | "paused" | "disabled";
  on_server: boolean;
  rtp_bp: number | null;
  rtp_fixed?: boolean; // set by the game's structure (roulette), not adjustable
  config_version: number | null;
  rounds: number;
  players: number;
  wagered: number;
  paid: number;
  net: number;
}

interface SiteReport {
  games: GameRow[];
  totals: { rounds: number; players: number; wagered: number; paid: number; net: number };
  points: { members: number; in_wallets: number; granted: number };
}

const PERIODS: { days: number | null; label: string }[] = [
  { days: 1, label: "آخر 24 ساعة" },
  { days: 7, label: "7 أيام" },
  { days: 30, label: "30 يوماً" },
  { days: null, label: "الكل" },
];

/** Paid ÷ wagered as a percentage with two decimals, in integer arithmetic. */
function actualRtp(wagered: number, paid: number): string {
  if (wagered <= 0) return "—";
  const bp = Math.round((paid * 10000) / wagered);
  return `${(bp / 100).toFixed(2)}%`;
}

const ADMIN_ERRORS: Record<string, string> = {
  RTP_OUT_OF_RANGE: "النسبة يجب أن تكون بين 90% و99%.",
  GAME_NOT_ON_SERVER: "هذه اللعبة لم تُربط بالخادم بعد.",
  RTP_FIXED: "عائد هذه اللعبة ثابت ببنيتها ولا يُغيَّر.",
  OWNER_ONLY: "هذا الإجراء للمالك فقط.",
};

interface MemberRow {
  user_id: string;
  display_name: string;
  role: string;
  status: string;
  created_at: string;
  wallet_accounts: { available: number; reserved: number } | null;
}

export default function AdminPage() {
  const member = useMember();
  const router = useRouter();
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [email, setEmail] = useState("");
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [days, setDays] = useState<number | null>(7);
  const [report, setReport] = useState<SiteReport | null>(null);
  const [rtpText, setRtpText] = useState<Record<string, string>>({});
  const [gameMsg, setGameMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [logKey, setLogKey] = useState(0);

  useEffect(() => {
    if (member.status === "signed_out") router.replace("/login/");
    if (member.status === "needs_join") router.replace("/join/");
  }, [member.status, router]);

  const ownerAccount = member.status === "member" && member.profile.role === "owner";
  const mfa = useOwnerMfa(ownerAccount);
  const isOwner = ownerAccount && mfa.ok;

  const loadMembers = useCallback(async () => {
    const { data } = await supabase()
      .from("profiles")
      .select("user_id, display_name, role, status, created_at, wallet_accounts(available, reserved)")
      .order("created_at");
    setMembers((data ?? []) as unknown as MemberRow[]);
  }, []);

  useEffect(() => {
    if (isOwner) void loadMembers();
  }, [isOwner, loadMembers]);

  const loadReport = useCallback(async () => {
    const { data, error } = await supabase().rpc("site_report", { p_days: days });
    if (!error && data) setReport(data as SiteReport);
  }, [days]);

  useEffect(() => {
    if (isOwner) void loadReport();
  }, [isOwner, loadReport]);

  async function saveRtp(g: GameRow) {
    const pct = Number(rtpText[g.game_id]);
    const bp = Math.round(pct * 100);
    if (!Number.isFinite(pct) || bp < 9000 || bp > 9900) {
      return setGameMsg({ ok: false, text: ADMIN_ERRORS.RTP_OUT_OF_RANGE });
    }
    const ok = window.confirm(
      `تغيير عائد ${g.name_ar} إلى ${(bp / 100).toFixed(2)}%؟ يسري فوراً على الجولات الجديدة لكل اللاعبين، ويظهر في سجل التغييرات.`,
    );
    if (!ok) return;
    setBusy(true);
    setGameMsg(null);
    const { error } = await supabase().rpc("set_game_rtp", { p_game_id: g.game_id, p_rtp_bp: bp });
    setBusy(false);
    if (error) return setGameMsg({ ok: false, text: ADMIN_ERRORS[error.message] ?? "لم يُحفظ التغيير. حاول مرة أخرى." });
    setGameMsg({ ok: true, text: `عائد ${g.name_ar} الآن ${(bp / 100).toFixed(2)}%.` });
    setRtpText((t) => ({ ...t, [g.game_id]: "" }));
    setLogKey((k) => k + 1);
    void loadReport();
  }

  async function toggleGame(g: GameRow) {
    setBusy(true);
    setGameMsg(null);
    const next = g.status === "enabled" ? "paused" : "enabled";
    const { error } = await supabase().rpc("set_game_status", { p_game_id: g.game_id, p_status: next });
    setBusy(false);
    if (error) return setGameMsg({ ok: false, text: ADMIN_ERRORS[error.message] ?? "لم يُحفظ التغيير. حاول مرة أخرى." });
    setGameMsg({ ok: true, text: next === "paused" ? `أُوقفت ${g.name_ar} مؤقتاً.` : `${g.name_ar} تعمل الآن.` });
    void loadReport();
  }

  async function claim() {
    setBusy(true);
    const { data, error } = await supabase().rpc("claim_ownership");
    setBusy(false);
    if (error || data !== true) setMsg({ ok: false, text: "يوجد مالك للموقع بالفعل." });
    member.refresh();
  }

  async function invite(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    const { data, error } = await supabase().functions.invoke("invite-member", {
      body: { email: email.trim(), note: note.trim(), redirectTo: siteUrl("/join/") },
    });
    setBusy(false);
    if (error || !data?.ok) {
      return setMsg({ ok: false, text: "لم تُرسل الدعوة. تأكد من البريد، أو أنه ليس عضواً بالفعل." });
    }
    setMsg({ ok: true, text: `أُرسلت الدعوة إلى ${email.trim()}.` });
    setEmail("");
    setNote("");
  }

  if (member.status !== "member") return <Shell member={member}><p className="muted">لحظة…</p></Shell>;

  if (ownerAccount && !mfa.ok) {
    return (
      <Shell member={member}>
        <OwnerMfaCard mfa={mfa} />
      </Shell>
    );
  }

  if (!isOwner) {
    return (
      <Shell member={member}>
        <Card title="الإدارة">
          <p className="muted">
            هذه الصفحة لمالك الموقع. إن كنت أنت المالك وهذا أول دخول لك، فعّل حسابك كمالك. يعمل هذا مرة واحدة فقط، لأول
            عضو يضغطه.
          </p>
          <button className="btn-primary" onClick={claim} disabled={busy}>تفعيل حساب المالك</button>
          {msg && <p className={msg.ok ? "success" : "error"}>{msg.text}</p>}
        </Card>
      </Shell>
    );
  }

  return (
    <Shell member={member} wide>
      <Card title="أرباح الموقع">
        <div className={styles.periods} role="radiogroup" aria-label="الفترة">
          {PERIODS.map((p) => (
            <button key={p.label} type="button" role="radio" aria-checked={days === p.days} onClick={() => setDays(p.days)}>
              {p.label}
            </button>
          ))}
        </div>
        {!report ? (
          <p className="muted">لحظة…</p>
        ) : (
          <>
            <div className={styles.tiles}>
              <div className={styles.tile}>
                <span>صافي الموقع</span>
                <b className={`num ${report.totals.net > 0 ? styles.plus : ""}`}>{formatPoints(report.totals.net)}</b>
              </div>
              <div className={styles.tile}>
                <span>مجموع الرهانات</span>
                <b className="num">{formatPoints(report.totals.wagered)}</b>
              </div>
              <div className={styles.tile}>
                <span>المدفوع للاعبين</span>
                <b className="num">{formatPoints(report.totals.paid)}</b>
              </div>
              <div className={styles.tile}>
                <span>العائد الفعلي</span>
                <b className="num">{actualRtp(report.totals.wagered, report.totals.paid)}</b>
              </div>
              <div className={styles.tile}>
                <span>الجولات</span>
                <b className="num">{report.totals.rounds.toLocaleString("en-US")}</b>
              </div>
              <div className={styles.tile}>
                <span>نقاط في المحافظ</span>
                <b className="num">{formatPoints(report.points.in_wallets)}</b>
              </div>
            </div>
            <div className={styles.scroll}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>اللعبة</th>
                    <th>الجولات</th>
                    <th>اللاعبون</th>
                    <th>الرهانات</th>
                    <th>المدفوع</th>
                    <th>صافي الموقع</th>
                    <th>العائد الفعلي</th>
                    <th>العائد المضبوط</th>
                  </tr>
                </thead>
                <tbody>
                  {report.games.map((g) => (
                    <tr key={g.game_id} className={g.on_server ? undefined : styles.off}>
                      <td>{g.name_ar}</td>
                      <td className="num">{g.rounds.toLocaleString("en-US")}</td>
                      <td className="num">{g.players}</td>
                      <td className="num">{formatPoints(g.wagered)}</td>
                      <td className="num">{formatPoints(g.paid)}</td>
                      <td className={`num ${g.net > 0 ? styles.plus : ""}`}>{formatPoints(g.net)}</td>
                      <td className="num">{actualRtp(g.wagered, g.paid)}</td>
                      <td className="num">{g.rtp_bp ? `${(g.rtp_bp / 100).toFixed(2)}%` : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className={`muted ${styles.note}`}>
              صافي الموقع = الرهانات − المدفوع. العائد الفعلي يقترب من المضبوط كلما زاد عدد الجولات، وقد يبتعد عنه كثيراً
              في الفترات القصيرة، وهذا طبيعي.
            </p>
          </>
        )}
      </Card>

      <Card title="الألعاب ونسبة العائد">
        <p className={`muted ${styles.note}`}>
          النسبة واحدة لكل اللاعبين في اللعبة، من 90% إلى 99%. التغيير يسري فوراً على الجولات الجديدة فقط ويُسجَّل
          علناً.
        </p>
        <ul className={styles.games}>
          {(report?.games ?? []).map((g) => (
            <li key={g.game_id}>
              <div className={styles.gameName}>
                <b>{g.name_ar}</b>
                <span className="muted">
                  {!g.on_server ? "تجريبية حالياً، تُربط بالخادم لاحقاً" : g.status === "enabled" ? "تعمل" : "متوقفة مؤقتاً"}
                  {g.on_server && g.rtp_fixed && g.rtp_bp ? (
                    <>
                      {" · العائد ثابت "}
                      <span className="num">{(g.rtp_bp / 100).toFixed(2)}%</span>
                    </>
                  ) : null}
                </span>
              </div>
              {g.on_server && (
                <div className={styles.gameControls}>
                  {!g.rtp_fixed && (
                  <>
                  <span className={styles.rtpField}>
                    <input
                      className="num"
                      inputMode="decimal"
                      aria-label={`عائد ${g.name_ar}`}
                      placeholder={g.rtp_bp ? (g.rtp_bp / 100).toFixed(2) : ""}
                      value={rtpText[g.game_id] ?? ""}
                      onChange={(e) => setRtpText((t) => ({ ...t, [g.game_id]: e.target.value.replace(/[^0-9.]/g, "") }))}
                    />
                    <i>%</i>
                  </span>
                  <button type="button" className="btn-secondary" disabled={busy || !rtpText[g.game_id]} onClick={() => saveRtp(g)}>
                    حفظ العائد
                  </button>
                  </>
                  )}
                  <button type="button" className="btn-secondary" disabled={busy} onClick={() => toggleGame(g)}>
                    {g.status === "enabled" ? "إيقاف مؤقت" : "تشغيل"}
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
        {gameMsg && <p className={gameMsg.ok ? "success" : "error"}>{gameMsg.text}</p>}
      </Card>

      <Security />

      <Devices />

      <BonusSetting />

      <Card title="سجل تغييرات العائد">
        <RtpHistory reloadKey={logKey} />
      </Card>

      <Card title="دعوة صديق">
        <form onSubmit={invite}>
          <div className="field">
            <label htmlFor="email">بريده الإلكتروني</label>
            <input id="email" className="input" type="email" dir="ltr" required
              value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="note">ملاحظة لك (اختياري، تُحفظ في سجل التدقيق)</label>
            <input id="note" className="input" maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          <button className="btn-primary" type="submit" disabled={busy}>{busy ? "جارٍ الإرسال…" : "إرسال الدعوة"}</button>
          {msg && <p className={msg.ok ? "success" : "error"}>{msg.text}</p>}
        </form>
      </Card>

      <Card title={`الأعضاء (${members.length})`}>
        <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {members.map((m) => (
            <li key={m.user_id} style={{ display: "flex", justifyContent: "space-between", padding: "10px 0", borderTop: "1px solid var(--rule)" }}>
              <span>
                {m.display_name}
                {m.role === "owner" && <span className="muted"> · المالك</span>}
                {m.status !== "active" && <span className="muted"> · {m.status === "paused" ? "موقوف" : m.status}</span>}
              </span>
              <span className="num muted">{m.wallet_accounts ? formatPoints(m.wallet_accounts.available) : "—"}</span>
            </li>
          ))}
        </ul>
      </Card>
    </Shell>
  );
}
