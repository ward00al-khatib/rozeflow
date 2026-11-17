"use client";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { Card, Shell } from "@/components/Shell";
import { supabase } from "@/lib/supabase/client";
import { useMember } from "@/lib/useMember";
import { TERMS } from "@/lib/terms";
import { loginEmail, normalizeUsername, USERNAME_RE, usernameOf } from "@/lib/username";

const INVITE_ERRORS: Record<string, string> = {
  INVITE_INVALID: "رابط الدعوة لم يعد صالحاً. اطلب رابطاً جديداً.",
  username_taken: "اسم المستخدم هذا مأخوذ. اختر اسماً آخر.",
  bad_username: "اسم المستخدم من 3 إلى 20 حرفاً: أحرف إنجليزية صغيرة أو أرقام أو _ فقط.",
  weak_password: "كلمة السر يجب أن تكون 10 أحرف على الأقل.",
};

/** The error code the join function returned, if any. */
async function inviteError(err: unknown): Promise<string> {
  try {
    const res = (err as { context?: Response })?.context;
    const body = res ? ((await res.json()) as { error?: string }) : null;
    return body?.error ?? "";
  } catch {
    return "";
  }
}

export default function JoinPage() {
  const member = useMember();
  const router = useRouter();
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [age, setAge] = useState(false);
  const [terms, setTerms] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [username, setUsername] = useState("");
  // Invite link shared by the owner (spec appendix ن): ?code=… ; null = no code, undefined = not read yet.
  const [code, setCode] = useState<string | null | undefined>(undefined);
  const [codeOk, setCodeOk] = useState<boolean | null>(null);

  useEffect(() => {
    if (member.status === "member") router.replace("/wallet/");
  }, [member.status, router]);

  useEffect(() => {
    const c = new URLSearchParams(window.location.search).get("code");
    setCode(c);
    if (c) {
      void supabase()
        .rpc("check_invite_code", { p_code: c })
        .then(({ data }) => setCodeOk(data === true));
    }
  }, []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (password.length < 10) return setError("كلمة السر يجب أن تكون 10 أحرف على الأقل.");
    if (member.status === "signed_out" && !USERNAME_RE.test(normalizeUsername(username))) {
      return setError(INVITE_ERRORS.bad_username);
    }
    setBusy(true);
    setError(null);
    const sb = supabase();
    if (member.status === "signed_out" && code) {
      const { data, error: fnError } = await sb.functions.invoke("join-with-invite", {
        body: { code, username: normalizeUsername(username), password },
      });
      if (fnError || !data?.ok) {
        setBusy(false);
        const why = await inviteError(fnError);
        if (why === "INVITE_INVALID") setCodeOk(false);
        return setError(INVITE_ERRORS[why] ?? "تعذّر إنشاء الحساب. حاول مرة أخرى بعد قليل.");
      }
      const { error: signInError } = await sb.auth.signInWithPassword({ email: loginEmail(username), password });
      if (signInError) {
        setBusy(false);
        return setError("أُنشئ حسابك، لكن تعذّر الدخول. ادخل من صفحة الدخول باسم المستخدم وكلمة السر.");
      }
    } else {
      const { error: pwError } = await sb.auth.updateUser({ password });
      // An account created in the dashboard with a password may re-enter that same password here.
      if (pwError && pwError.code !== "same_password") {
        setBusy(false);
        return setError("تعذّر حفظ كلمة السر. قد يكون رابط الدعوة منتهياً، فاطلب دعوة جديدة.");
      }
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

  const withCode = member.status === "signed_out";
  if (withCode && (!code || codeOk === false)) {
    return (
      <Shell member={member}>
        <Card title="الانضمام">
          <p>
            {code
              ? "رابط الدعوة هذا لم يعد صالحاً: استُخدم من قبل، أو ألغاه المالك، أو انتهت مدته. اطلب رابطاً جديداً."
              : "افتح هذه الصفحة من رابط الدعوة الذي وصلك. الرابط صالح لمرة واحدة."}
          </p>
        </Card>
      </Shell>
    );
  }
  if (withCode && codeOk === null) return <Shell member={member}><p className="muted">لحظة…</p></Shell>;

  return (
    <Shell member={member}>
      <Card title="أهلاً بك في ROZEFLOW">
        <p className="muted">
          {member.status === "needs_join" && (
            <>
              الدعوة لـ <span className="num">{usernameOf(member.session.user.email) ?? member.session.user.email}</span>.{" "}
            </>
          )}
          اختر اسماً يظهر لأصدقائك، وكلمة سر للدخول لاحقاً.
        </p>
        <form onSubmit={onSubmit}>
          {withCode && (
            <div className="field">
              <label htmlFor="username">اسم المستخدم للدخول (3 إلى 20: أحرف إنجليزية، أرقام، _)</label>
              <input id="username" className="input" dir="ltr" autoComplete="username" autoCapitalize="none"
                spellCheck={false} required minLength={3} maxLength={20} pattern="[A-Za-z0-9_]{3,20}"
                value={username} onChange={(e) => setUsername(e.target.value.replace(/[^A-Za-z0-9_]/g, ""))} />
            </div>
          )}
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
