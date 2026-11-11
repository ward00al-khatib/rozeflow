"use client";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { Card, Shell } from "@/components/Shell";
import { supabase } from "@/lib/supabase/client";
import { useMember } from "@/lib/useMember";
import { TERMS } from "@/lib/terms";

export default function JoinPage() {
  const member = useMember();
  const router = useRouter();
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [age, setAge] = useState(false);
  const [terms, setTerms] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (member.status === "member") router.replace("/wallet/");
  }, [member.status, router]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (password.length < 10) return setError("كلمة السر يجب أن تكون 10 أحرف على الأقل.");
    setBusy(true);
    setError(null);
    const sb = supabase();
    const { error: pwError } = await sb.auth.updateUser({ password });
    // An account created in the dashboard with a password may re-enter that same password here.
    if (pwError && pwError.code !== "same_password") {
      setBusy(false);
      return setError("تعذّر حفظ كلمة السر. قد يكون رابط الدعوة منتهياً، فاطلب دعوة جديدة.");
    }
    const { error: joinError } = await sb.rpc("complete_join", {
      p_display_name: name,
      p_age_confirmed: age,
      p_terms_accepted: terms,
    });
    setBusy(false);
    if (joinError) return setError("تعذّر إكمال الانضمام. تأكد من الاسم (2 إلى 32 حرفاً) ثم حاول مرة أخرى.");
    member.refresh();
  }

  if (member.status === "loading") return <Shell member={member}><p className="muted">لحظة…</p></Shell>;

  if (member.status === "signed_out") {
    return (
      <Shell member={member}>
        <Card title="الانضمام">
          <p>افتح هذه الصفحة من رابط الدعوة الذي وصلك بالبريد. الرابط صالح لمرة واحدة.</p>
        </Card>
      </Shell>
    );
  }

  return (
    <Shell member={member}>
      <Card title="أهلاً بك في ROZEFLOW">
        <p className="muted">
          الدعوة لـ <span className="num">{member.status !== "member" ? member.session.user.email : ""}</span>. اختر اسماً
          يظهر لأصدقائك، وكلمة سر للدخول لاحقاً.
        </p>
        <form onSubmit={onSubmit}>
          <div className="field">
            <label htmlFor="name">الاسم الظاهر</label>
            <input id="name" className="input" minLength={2} maxLength={32} required
              value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="password">كلمة السر (10 أحرف على الأقل)</label>
            <input id="password" className="input" type="password" dir="ltr" autoComplete="new-password" required
              value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>

          <details className="muted" style={{ marginBottom: 12 }}>
            <summary>شروط الاستخدام</summary>
            <ol>{TERMS.map((t) => <li key={t}>{t}</li>)}</ol>
          </details>

          <label className="check">
            <input type="checkbox" checked={age} onChange={(e) => setAge(e.target.checked)} />
            <span>عمري 18 سنة أو أكثر.</span>
          </label>
          <label className="check">
            <input type="checkbox" checked={terms} onChange={(e) => setTerms(e.target.checked)} />
            <span>قرأت شروط الاستخدام وأوافق عليها.</span>
          </label>

          <button className="btn-primary" type="submit" disabled={busy || !age || !terms}>
            {busy ? "جارٍ الانضمام…" : "انضمام"}
          </button>
          {error && <p className="error">{error}</p>}
        </form>
      </Card>
    </Shell>
  );
}
