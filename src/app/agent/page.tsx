"use client";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Card, Shell } from "@/components/Shell";
import {
  KIND_LABELS,
  agentError,
  fmtWhen,
  newKey,
  parsePlayerNo,
  pointsToCenti,
  type AgentDashboard,
  type SubAgent,
} from "@/lib/agents";
import { formatPoints } from "@/lib/points";
import { supabase } from "@/lib/supabase/client";
import { useMember } from "@/lib/useMember";
import admin from "../admin/admin.module.css";
import { AgentInvites } from "./AgentInvites";
import styles from "./agent.module.css";

type Msg = { ok: boolean; text: string } | null;

const QUICK = [50, 100, 500, 1000];

/** Agent panel: send free points to a player by number; masters also manage sub-agents (spec appendix س). */
export default function AgentPage() {
  const member = useMember();
  const router = useRouter();
  const [dash, setDash] = useState<AgentDashboard | null | undefined>(undefined);

  useEffect(() => {
    if (member.status === "signed_out") router.replace("/login/");
    if (member.status === "needs_join") router.replace("/join/");
  }, [member.status, router]);

  const uid = member.status === "member" ? member.profile.user_id : null;
  const load = useCallback(async () => {
    const { data, error } = await supabase().rpc("agent_dashboard");
    setDash(error ? null : ((data as AgentDashboard | null) ?? null));
  }, []);

  useEffect(() => {
    if (uid) void load();
  }, [uid, load]);

  if (member.status !== "member" || dash === undefined) {
    return <Shell member={member}><p className="muted">لحظة…</p></Shell>;
  }

  if (dash === null) {
    return (
      <Shell member={member}>
        <Card title="الوكالة">
          <p className="muted">هذه الصفحة لوكلاء الموقع، وحسابك ليس وكيلاً. يعيّن المالك الوكلاء من صفحة الإدارة.</p>
        </Card>
      </Shell>
    );
  }

  const canAct = dash.status === "active" && dash.parent_active;

  return (
    <Shell member={member}>
      <Card title={dash.tier === "master" ? "وكيل رئيسي" : `وكيل فرعي${dash.parent_name ? ` لدى ${dash.parent_name}` : ""}`}>
        <div className="muted">الحصة المتبقية للتوزيع</div>
        <div className={`num ${styles.allowance}`}>{formatPoints(dash.allowance)}</div>
        <div className={admin.tiles} style={{ marginTop: 14 }}>
          <div className={admin.tile}>
            <span>وزّعت اليوم</span>
            <b className="num">{formatPoints(dash.gifted_today)}</b>
          </div>
          <div className={admin.tile}>
            <span>وزّعت كل الوقت</span>
            <b className="num">{formatPoints(dash.gifted_total)}</b>
          </div>
          <div className={admin.tile}>
            <span>لاعبون وصلتهم</span>
            <b className="num">{dash.players}</b>
          </div>
        </div>
        {!canAct && (
          <p className="error">
            {dash.status !== "active" ? "وكالتك مجمّدة حالياً، فلا يمكنك الإرسال." : "وكالة الوكيل الرئيسي مجمّدة حالياً، فلا يمكنك الإرسال."}
          </p>
        )}
        <p className={`muted ${styles.rule}`}>
          النقاط مجانية للتسلية فقط. لا تأخذ مقابلها مالاً ولا أي شيء آخر، ولا تَعِد أحداً بتحويلها إلى شيء. من يفعل
          تُسحب وكالته.
        </p>
      </Card>

      {canAct && <SendCard allowance={dash.allowance} onDone={load} />}

      <AgentInvites canAct={canAct} />

      {dash.tier === "master" && <SubsCard subs={dash.subs} canAct={canAct} onDone={load} />}

      <Card title="سجل حركات الحصة">
        {dash.transfers.length === 0 && <p className="muted">لا حركات بعد.</p>}
        <ul className={styles.log}>
          {dash.transfers.map((t) => (
            <li key={t.id}>
              <div>
                <div>
                  {KIND_LABELS[t.kind]}
                  {" · "}
                  {t.other_name}
                  {t.other_no !== null && <span className="num muted">{"\u00a0#"}{t.other_no}</span>}
                </div>
                <div className="muted">
                  {fmtWhen(t.created_at)} · <span className={`num ${styles.ref}`}>{t.ref}</span>
                  {t.note ? ` · ${t.note}` : ""}
                </div>
              </div>
              <div className={styles.amounts}>
                <span className={`num ${t.outgoing ? styles.out : styles.in}`}>
                  {t.outgoing ? "−" : "+"}
                  {formatPoints(t.amount)}
                </span>
                {t.allowance_after !== null && <span className="num muted">{formatPoints(t.allowance_after)}</span>}
              </div>
            </li>
          ))}
        </ul>
      </Card>
    </Shell>
  );
}

function SendCard({ allowance, onDone }: { allowance: number; onDone: () => void }) {
  const [noText, setNoText] = useState("");
  const [found, setFound] = useState<{ no: number; name: string } | null>(null);
  const [ptsText, setPtsText] = useState("");
  const [note, setNote] = useState("");
  const [key, setKey] = useState<string | null>(null); // set while a confirmed send is in flight or being retried
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);

  const playerNo = parsePlayerNo(noText);
  const amount = pointsToCenti(ptsText);

  async function lookup() {
    setMsg(null);
    setFound(null);
    if (playerNo === null) return setMsg({ ok: false, text: "اكتب رقم اللاعب كما يظهر في محفظته." });
    setBusy(true);
    const { data, error } = await supabase().rpc("agent_find_player", { p_player_no: playerNo });
    setBusy(false);
    if (error || !data) return setMsg({ ok: false, text: agentError(error?.message) });
    const d = data as { display_name: string; is_me: boolean };
    if (d.is_me) return setMsg({ ok: false, text: agentError("SELF_SEND") });
    setFound({ no: playerNo, name: d.display_name });
  }

  function review() {
    setMsg(null);
    if (!found || found.no !== playerNo) return setMsg({ ok: false, text: "تحقق من رقم اللاعب أولاً." });
    if (amount === null) return setMsg({ ok: false, text: agentError("BAD_AMOUNT") });
    if (amount > allowance) return setMsg({ ok: false, text: agentError("ALLOWANCE_LOW") });
    setKey(newKey());
  }

  async function send() {
    if (!found || amount === null || !key) return;
    setBusy(true);
    setMsg(null);
    const { data, error } = await supabase().rpc("agent_send", {
      p_player_no: found.no,
      p_amount: amount,
      p_key: key,
      p_note: note.trim() || null,
    });
    setBusy(false);
    // On a network error keep the same key: pressing again cannot send twice.
    if (error || !data) return setMsg({ ok: false, text: agentError(error?.message) });
    const d = data as { ref: string; duplicate: boolean };
    setMsg({ ok: true, text: `وصلت ${formatPoints(amount)} نقطة إلى ${found.name}. الرقم المرجعي ${d.ref}.` });
    setKey(null);
    setPtsText("");
    setNote("");
    onDone();
  }

  return (
    <Card title="إرسال نقاط مجانية للاعب">
      <div className="field">
        <label htmlFor="player-no">رقم اللاعب (يجده في صفحة المحفظة)</label>
        <div className={admin.gameControls}>
          <input id="player-no" className="input num" inputMode="numeric" dir="ltr" style={{ maxWidth: 160 }}
            value={noText} disabled={!!key}
            onChange={(e) => { setNoText(e.target.value.replace(/[^0-9#]/g, "")); setFound(null); }}
            onKeyDown={(e) => { if (e.key === "Enter") void lookup(); }} />
          <button type="button" className="btn-secondary" disabled={busy || !!key || !noText} onClick={lookup}>تحقق</button>
        </div>
      </div>
      {found && found.no === playerNo && (
        <p className={`success ${styles.found}`}>
          اللاعب: <b>{found.name}</b>
        </p>
      )}
      <div className="field">
        <label htmlFor="points">عدد النقاط</label>
        <input id="points" className="input num" inputMode="numeric" dir="ltr" style={{ maxWidth: 160 }}
          value={ptsText} disabled={!!key} onChange={(e) => setPtsText(e.target.value.replace(/[^0-9]/g, ""))} />
      </div>
      <div className={styles.quick}>
        {QUICK.map((q) => (
          <button key={q} type="button" disabled={!!key} onClick={() => setPtsText(String(q))}>
            <span className="num">{q}</span>
          </button>
        ))}
      </div>
      <div className="field">
        <label htmlFor="gift-note">ملاحظة (اختياري، تظهر في السجل)</label>
        <input id="gift-note" className="input" maxLength={200} value={note} disabled={!!key}
          onChange={(e) => setNote(e.target.value)} />
      </div>
      {!key ? (
        <button type="button" className="btn-primary" disabled={busy || !found || !ptsText} onClick={review}>
          متابعة
        </button>
      ) : (
        <div className={styles.confirm}>
          <b>
            إرسال <span className="num">{formatPoints(amount ?? 0)}</span> نقطة مجانية إلى {found?.name}{" "}
            <span className="num muted">#{found?.no}</span>؟
          </b>
          <span className="muted">تُخصم من حصتك وتصل إلى محفظته فوراً، ولا يمكن إرجاعها.</span>
          <div className={admin.gameControls}>
            <button type="button" className="btn-primary" disabled={busy} onClick={send}>
              {busy ? "جارٍ الإرسال…" : "تأكيد الإرسال"}
            </button>
            <button type="button" className="btn-secondary" disabled={busy} onClick={() => { setKey(null); setMsg(null); }}>
              تعديل
            </button>
          </div>
        </div>
      )}
      {msg && <p className={msg.ok ? "success" : "error"}>{msg.text}</p>}
    </Card>
  );
}

function SubsCard({ subs, canAct, onDone }: { subs: SubAgent[]; canAct: boolean; onDone: () => void }) {
  const [noText, setNoText] = useState("");
  const [note, setNote] = useState("");
  const [pass, setPass] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);

  async function run(fn: string, args: Record<string, unknown>, ok: string) {
    setBusy(true);
    setMsg(null);
    const { error } = await supabase().rpc(fn, args);
    setBusy(false);
    if (error) {
      setMsg({ ok: false, text: agentError(error.message) });
      return false;
    }
    setMsg({ ok: true, text: ok });
    onDone();
    return true;
  }

  async function add() {
    const no = parsePlayerNo(noText);
    if (no === null) return setMsg({ ok: false, text: "اكتب رقم العضو." });
    if (await run("agent_add_sub", { p_player_no: no, p_note: note.trim() || null }, "أُضيف الوكيل الفرعي.")) {
      setNoText("");
      setNote("");
    }
  }

  async function passTo(s: SubAgent) {
    const amount = pointsToCenti(pass[s.user_id] ?? "");
    if (amount === null) return setMsg({ ok: false, text: agentError("BAD_AMOUNT") });
    if (!window.confirm(`تمرير ${formatPoints(amount)} نقطة من حصتك إلى ${s.display_name}؟`)) return;
    if (await run("agent_pass", { p_sub: s.user_id, p_amount: amount, p_key: newKey() },
      `مرّرت ${formatPoints(amount)} نقطة إلى ${s.display_name}.`)) {
      setPass((p) => ({ ...p, [s.user_id]: "" }));
    }
  }

  async function reclaim(s: SubAgent) {
    if (!window.confirm(`استرجاع كل الحصة المتبقية لدى ${s.display_name} (${formatPoints(s.allowance)} نقطة)؟`)) return;
    await run("agent_reclaim", { p_sub: s.user_id, p_amount: null, p_key: newKey() }, `استرجعت حصة ${s.display_name}.`);
  }

  async function toggle(s: SubAgent) {
    const next = s.status === "active" ? "frozen" : "active";
    await run("set_agent_status", { p_agent: s.user_id, p_status: next },
      next === "frozen" ? `جُمّدت وكالة ${s.display_name}.` : `${s.display_name} يعمل الآن.`);
  }

  return (
    <Card title={`وكلائي الفرعيون (${subs.length})`}>
      <p className={`muted ${admin.note}`}>
        الوكيل الفرعي يوزّع من حصة تمرّرها له من حصتك. تستطيع استرجاع ما بقي معه أو تجميده في أي وقت.
      </p>
      {canAct && (
        <div className={admin.gameControls} style={{ marginBottom: 12 }}>
          <input className="input num" inputMode="numeric" dir="ltr" placeholder="رقم العضو" aria-label="رقم العضو"
            style={{ maxWidth: 140 }} value={noText} onChange={(e) => setNoText(e.target.value.replace(/[^0-9#]/g, ""))} />
          <input className="input" placeholder="ملاحظة (اختياري)" aria-label="ملاحظة" maxLength={200}
            style={{ maxWidth: 220 }} value={note} onChange={(e) => setNote(e.target.value)} />
          <button type="button" className="btn-secondary" disabled={busy || !noText} onClick={add}>إضافة وكيل فرعي</button>
        </div>
      )}
      {subs.length > 0 && (
        <ul className={admin.games}>
          {subs.map((s) => (
            <li key={s.user_id}>
              <div className={admin.gameName}>
                <b>
                  {s.display_name} <span className="num muted">#{s.player_no}</span>
                </b>
                <span className="muted">
                  {s.status === "active" ? "يعمل" : "مجمّد"} · الحصة <span className="num">{formatPoints(s.allowance)}</span> ·
                  وزّع <span className="num">{formatPoints(s.gifted_total)}</span>
                </span>
              </div>
              {canAct && (
                <div className={admin.gameControls}>
                  {s.status === "active" && (
                    <>
                      <span className={admin.rtpField}>
                        <input className="num" inputMode="numeric" aria-label={`نقاط لـ ${s.display_name}`}
                          value={pass[s.user_id] ?? ""}
                          onChange={(e) => setPass((p) => ({ ...p, [s.user_id]: e.target.value.replace(/[^0-9]/g, "") }))} />
                      </span>
                      <button type="button" className="btn-secondary" disabled={busy || !pass[s.user_id]} onClick={() => passTo(s)}>
                        تمرير
                      </button>
                    </>
                  )}
                  <button type="button" className="btn-secondary" disabled={busy || s.allowance === 0} onClick={() => reclaim(s)}>
                    استرجاع المتبقي
                  </button>
                  <button type="button" className="btn-secondary" disabled={busy} onClick={() => toggle(s)}>
                    {s.status === "active" ? "تجميد" : "إعادة تفعيل"}
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {msg && <p className={msg.ok ? "success" : "error"}>{msg.text}</p>}
    </Card>
  );
}
