"use client";
import { useCallback, useEffect, useState } from "react";
import { Card } from "@/components/Shell";
import { siteUrl, supabase } from "@/lib/supabase/client";
import styles from "./admin.module.css";

interface LinkRow {
  id: number;
  note: string | null;
  created_at: string;
  expires_at: string;
  used_at: string | null;
  used_by_name: string | null;
  status: "open" | "used" | "revoked" | "expired";
}

const STATUS: Record<LinkRow["status"], string> = {
  open: "صالح",
  used: "استُخدم",
  revoked: "أُلغي",
  expired: "انتهت مدته",
};

const DAYS = [1, 3, 7, 30];

const ERRORS: Record<string, string> = {
  OWNER_ONLY: "هذا لمالك الموقع فقط.",
  BAD_DAYS: "المدة بين يوم و 30 يوماً.",
  TOO_MANY_LINKS: "عندك 50 رابطاً صالحاً. ألغِ بعضها أولاً.",
  LINK_NOT_OPEN: "هذا الرابط لم يعد صالحاً.",
};

function when(iso: string): string {
  return new Date(iso).toLocaleString("ar-SY-u-nu-latn", { dateStyle: "medium", timeStyle: "short" });
}

/** The join link for a code. */
export function inviteUrl(code: string): string {
  return siteUrl(`/join/?code=${encodeURIComponent(code)}`);
}

/** WhatsApp share link with a short Arabic invitation. */
export function whatsappUrl(link: string): string {
  const text = `أدعوك إلى ROZEFLOW، موقع ألعاب بنقاط افتراضية لأصدقائنا فقط. افتح الرابط واختر اسمك وكلمة سرك (الرابط لشخص واحد):\n${link}`;
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}

/** Owner card: one-use invite links shared by hand, so joining needs no email (spec appendix ن). */
export function InviteLinks() {
  const [links, setLinks] = useState<LinkRow[] | null>(null);
  const [note, setNote] = useState("");
  const [days, setDays] = useState(7);
  const [busy, setBusy] = useState(false);
  const [fresh, setFresh] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    const { data } = await supabase().rpc("list_invite_links");
    if (data) setLinks(data as LinkRow[]);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function create() {
    setBusy(true);
    setMsg(null);
    setCopied(false);
    const { data, error } = await supabase().rpc("create_invite_link", { p_note: note.trim() || null, p_days: days });
    setBusy(false);
    if (error || !data) return setMsg({ ok: false, text: ERRORS[error?.message ?? ""] ?? "لم يُنشأ الرابط. حاول مرة أخرى." });
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
    const { error } = await supabase().rpc("revoke_invite_link", { p_id: l.id });
    setBusy(false);
    if (error) return setMsg({ ok: false, text: ERRORS[error.message] ?? "لم يُلغَ الرابط. حاول مرة أخرى." });
    setMsg({ ok: true, text: "أُلغي الرابط." });
    void load();
  }

  const open = (links ?? []).filter((l) => l.status === "open").length;

  return (
    <Card title={`روابط الدعوة${open ? ` · ${open} صالح` : ""}`}>
      <p className={`muted ${styles.note}`}>
        أنشئ رابطاً وأرسله لصديقك على واتساب. يفتحه ويختار اسمه وكلمة سره، دون رسالة بريد. كل رابط لشخص واحد، ويظهر
        كاملاً مرة واحدة فقط هنا.
      </p>
      <div className="field">
        <label htmlFor="link-note">لمن الرابط؟ (اختياري، لك فقط)</label>
        <input id="link-note" className="input" maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
      <div className={styles.gameControls}>
        <span className="muted">صالح لمدة</span>
        <div className={styles.periods} role="radiogroup" aria-label="مدة الرابط">
          {DAYS.map((d) => (
            <button key={d} type="button" role="radio" aria-checked={days === d} onClick={() => setDays(d)}>
              <span className="num">{d}</span> {d === 1 ? "يوم" : d <= 10 ? "أيام" : "يوماً"}
            </button>
          ))}
        </div>
        <button type="button" className="btn-primary" disabled={busy} onClick={create}>
          إنشاء رابط
        </button>
      </div>

      {fresh && (
        <div className={styles.fresh}>
          <b>الرابط جاهز. أرسله الآن، فلن يظهر كاملاً مرة أخرى:</b>
          <input className={`input num ${styles.linkBox}`} dir="ltr" readOnly value={fresh} onFocus={(e) => e.target.select()}
            aria-label="رابط الدعوة" />
          <div className={styles.gameControls}>
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
        <ul className={styles.games}>
          {links.map((l) => (
            <li key={l.id}>
              <div className={styles.gameName}>
                <b>{l.note ?? "رابط بلا ملاحظة"}</b>
                <span className="muted">
                  {STATUS[l.status]}
                  {l.status === "used" && l.used_by_name && <> · انضم {l.used_by_name}</>}
                  {l.status === "open" && <> · حتى {when(l.expires_at)}</>}
                </span>
                <span className="muted">أُنشئ {when(l.created_at)}</span>
              </div>
              {l.status === "open" && (
                <div className={styles.gameControls}>
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
