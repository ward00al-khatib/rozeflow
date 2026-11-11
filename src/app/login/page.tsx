"use client";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { Card, Shell } from "@/components/Shell";
import { supabase } from "@/lib/supabase/client";
import { useMember } from "@/lib/useMember";

export default function LoginPage() {
  const member = useMember();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (member.status === "member") router.replace("/wallet/");
    if (member.status === "needs_join") router.replace("/join/");
  }, [member.status, router]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await supabase().auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (error) setError("البريد أو كلمة السر غير صحيحة.");
  }

  return (
    <Shell member={member}>
      <Card title="الدخول">
        <form onSubmit={onSubmit}>
          <div className="field">
            <label htmlFor="email">البريد الإلكتروني</label>
            <input id="email" className="input" type="email" dir="ltr" autoComplete="email" required
              value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="password">كلمة السر</label>
            <input id="password" className="input" type="password" dir="ltr" autoComplete="current-password" required
              value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          <button className="btn-primary" type="submit" disabled={busy}>
            {busy ? "جارٍ الدخول…" : "دخول"}
          </button>
          {error && <p className="error">{error}</p>}
        </form>
        <p className="muted">الموقع بالدعوة فقط. إن لم تصلك دعوة، اطلبها من صاحب الموقع.</p>
      </Card>
    </Shell>
  );
}
