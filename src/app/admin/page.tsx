"use client";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Card, Shell } from "@/components/Shell";
import { formatPoints } from "@/lib/points";
import { siteUrl, supabase } from "@/lib/supabase/client";
import { useMember } from "@/lib/useMember";

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

  useEffect(() => {
    if (member.status === "signed_out") router.replace("/login/");
    if (member.status === "needs_join") router.replace("/join/");
  }, [member.status, router]);

  const isOwner = member.status === "member" && member.profile.role === "owner";

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
    <Shell member={member}>
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
                {m.status !== "active" && <span className="muted"> · {m.status}</span>}
              </span>
              <span className="num muted">{m.wallet_accounts ? formatPoints(m.wallet_accounts.available) : "—"}</span>
            </li>
          ))}
        </ul>
      </Card>
    </Shell>
  );
}
