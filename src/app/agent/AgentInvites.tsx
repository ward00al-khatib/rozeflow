"use client";
import { useCallback, useEffect, useState } from "react";
import { Card } from "@/components/Shell";
import { agentError, fmtWhen } from "@/lib/agents";
import { supabase } from "@/lib/supabase/client";
import { inviteUrl, whatsappUrl } from "../admin/InviteLinks";
import admin from "../admin/admin.module.css";

interface LinkRow {
  id: number;
  note: string | null;
  created_at: string;
  expires_at: string;
  used_by_name: string | null;
  used_by_no: number | null;
  status: "open" | "used" | "revoked" | "expired";
}

const STATUS: Record<LinkRow["status"], string> = {
  open: "صالح",
  used: "انضم",
  revoked: "أُلغي",
  expired: "انتهت مدته",
};

const DAYS = [1, 3, 7];

const ERRORS: Record<string, string> = {
  BAD_DAYS: "المدة من يوم إلى 7 أيام.",
  TOO_MANY_LINKS: "عندك 10 روابط صالحة. ألغِ بعضها أو انتظر استخدامها.",
  RATE_LIMITED: "صنعت 20 رابطاً خلال يوم. حاول غداً.",
  LINK_NOT_OPEN: "هذا الرابط لم يعد صالحاً.",
};

/** Agent card: one-use invite links for new players; the friend picks their own username and password. */
export function AgentInvites({ canAct }: { canAct: boolean }) {
  const [links, setLinks] = useState<LinkRow[] | null>(null);
  const [note, setNote] = useState("");
  const [days, setDays] = useState(3);
  const [busy, setBusy] = useState(false);
  const [fresh, setFresh] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    const { data } = await supabase().rpc("agent_list_invite_links");
    if (data) setLinks(data as LinkRow[]);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function create() {
    setBusy(true);
    setMsg(null);
    setCopied(false);
    const { data, error } = await supabase().rpc("agent_create_invite_link", { p_note: note.trim() || null, p_days: days });
    setBusy(false);
    if (error || !data) return setMsg({ ok: false, text: ERRORS[error?.message ?? ""] ?? agentError(error?.message) });
    setFresh(inviteUrl((data as { code: string }).code));
    setNote("");
    void load();
  }

  async function copy() {
    if (!fresh) return;
    try {
      await navigator.clipboard.writeText(fresh);
      setCopied(true);
    } catch {
      setMsg({ ok: false, text: "لم يُنسخ تلقائياً. حدّد الرابط وانسخه يدوياً." });
    }
  }

  async function revoke(l: LinkRow) {
    setBusy(true);
    setMsg(null);
    const { error } = await supabase().rpc("agent_revoke_invite_link", { p_id: l.id });
    setBusy(false);
    if (error) return setMsg({ ok: false, text: ERRORS[error.message] ?? agentError(error.message) });
    setMsg({ ok: true, text: "أُلغي الرابط." });
    void load();
  }

  return (
    <Card title="إدخال لاعب جديد">
      <p className={`muted ${admin.note}`}>
        اصنع رابط دعوة وأرسله لصديقك على واتساب. يفتحه ويختار اسم المستخدم وكلمة السر بنفسه، ثم يظهر رقمه هنا فترسل له
        النقاط. كل رابط لشخص واحد، ويظهر كاملاً مرة واحدة فقط.
      </p>
      {canAct && (
        <>
          <div className="field">
            <label htmlFor="agent-link-note">لمن الرابط؟ (اختياري، لك فقط)</label>
            <input id="agent-link-note" className="input" maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          <div className={admin.gameControls}>
            <span className="muted">صالح لمدة</span>
            <div className={admin.periods} role="radiogroup" aria-label="مدة الرابط">
              {DAYS.map((d) => (
                <button key={d} type="button" role="radio" aria-checked={days === d} onClick={() => setDays(d)}>
                  <span className="num">{d}</span> {d === 1 ? "يوم" : "أيام"}
                </button>
              ))}
            </div>
            <button type="button" className="btn-primary" disabled={busy} onClick={create}>
              إنشاء رابط
            </button>
          </div>
        </>
      )}

      {fresh && (
        <div className={admin.fresh}>
          <b>الرابط جاهز. أرسله الآن، فلن يظهر كاملاً مرة أخرى:</b>
          <input className={`input num ${admin.linkBox}`} dir="ltr" readOnly value={fresh} onFocus={(e) => e.target.select()}
            aria-label="رابط الدعوة" />
          <div className={admin.gameControls}>
            <a className="btn-primary" href={whatsappUrl(fresh)} target="_blank" rel="noopener noreferrer">
              إرسال عبر واتساب
            </a>
            <button type="button" className="btn-secondary" onClick={copy}>
              {copied ? "نُسخ ✓" : "نسخ الرابط"}
            </button>
          </div>
        </div>
      )}

      {links && links.length > 0 && (
        <ul className={admin.games}>
          {links.map((l) => (
            <li key={l.id}>
              <div className={admin.gameName}>
                <b>{l.note ?? "رابط بلا ملاحظة"}</b>
                <span className="muted">
                  {STATUS[l.status]}
                  {l.status === "used" && l.used_by_name && (
                    <>
                      {" "}
                      {l.used_by_name}
                      {l.used_by_no !== null && <span className="num">{" #"}{l.used_by_no}</span>}
                    </>
                  )}
                  {l.status === "open" && <> · حتى {fmtWhen(l.expires_at)}</>}
                </span>
              </div>
              {l.status === "open" && (
                <div className={admin.gameControls}>
                  <button type="button" className="btn-secondary" disabled={busy} onClick={() => revoke(l)}>
                    إلغاء
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
