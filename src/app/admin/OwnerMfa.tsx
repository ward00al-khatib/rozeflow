"use client";
/**
 * Owner two-factor (spec appendix ل). Owner powers on the server need an aal2 session, so the admin page
 * first asks for a code from an authenticator app, or sets one up the first time.
 */
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Card } from "@/components/Shell";
import { supabase } from "@/lib/supabase/client";
import styles from "./admin.module.css";

type Phase =
  | { kind: "loading" }
  | { kind: "ok" }
  | { kind: "challenge"; factorId: string }
  | { kind: "enroll"; factorId: string; qr: string; secret: string }
  | { kind: "error"; text: string };

/** Supabase sends the QR as raw SVG, sometimes behind a "data:image/svg+xml;utf-8," prefix; make it a valid image URL. */
export function qrDataUrl(qr: string): string {
  const svg = qr.startsWith("data:") ? qr.slice(qr.indexOf(",") + 1) : qr;
  if (svg.trimStart().startsWith("<")) return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  return qr; // already encoded (base64 or percent-encoded)
}

export function useOwnerMfa(enabled: boolean) {
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });

  const check = useCallback(async () => {
    const sb = supabase();
    const { data: aal } = await sb.auth.mfa.getAuthenticatorAssuranceLevel();
    if (aal?.currentLevel === "aal2") return setPhase({ kind: "ok" });
    const { data: factors, error } = await sb.auth.mfa.listFactors();
    if (error || !factors) return setPhase({ kind: "error", text: "تعذّر الاتصال بالخادم. أعد تحميل الصفحة." });
    const verified = factors.totp[0];
    if (verified) return setPhase({ kind: "challenge", factorId: verified.id });
    // First time: clear unfinished set-ups, then start a new one.
    for (const f of factors.all.filter((f) => f.status === "unverified")) {
      await sb.auth.mfa.unenroll({ factorId: f.id });
    }
    const { data: enrolled, error: enrollError } = await sb.auth.mfa.enroll({
      factorType: "totp",
      issuer: "ROZEFLOW",
      friendlyName: `ROZEFLOW ${new Date().toISOString().slice(0, 16)}`,
    });
    if (enrollError || !enrolled) return setPhase({ kind: "error", text: "تعذّر بدء الإعداد. أعد تحميل الصفحة." });
    const qr = qrDataUrl(enrolled.totp.qr_code);
    setPhase({ kind: "enroll", factorId: enrolled.id, qr, secret: enrolled.totp.secret });
  }, []);

  useEffect(() => {
    if (!enabled) return;
    check().catch(() => setPhase({ kind: "error", text: "تعذّر الاتصال بالخادم. أعد تحميل الصفحة." }));
  }, [enabled, check]);

  return { ok: phase.kind === "ok", phase, recheck: check, setOk: () => setPhase({ kind: "ok" }) };
}

export function OwnerMfaCard({ mfa }: { mfa: ReturnType<typeof useOwnerMfa> }) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [showSecret, setShowSecret] = useState(false);
  const { phase } = mfa;

  async function verify(e: FormEvent) {
    e.preventDefault();
    if (phase.kind !== "challenge" && phase.kind !== "enroll") return;
    if (!/^\d{6}$/.test(code)) return setErr("الرمز ستة أرقام.");
    setBusy(true);
    setErr(null);
    const { error } = await supabase().auth.mfa.challengeAndVerify({ factorId: phase.factorId, code });
    setBusy(false);
    if (error) {
      setCode("");
      return setErr("الرمز غير صحيح أو انتهى وقته. انتظر الرمز التالي في التطبيق وجرّب مرة أخرى.");
    }
    mfa.setOk();
  }

  if (phase.kind === "loading") return <Card><p className="muted">لحظة…</p></Card>;
  if (phase.kind === "error") return <Card><p className="error">{phase.text}</p></Card>;
  if (phase.kind === "ok") return null;

  const form = (
    <form onSubmit={verify} className={styles.mfaForm}>
      <label htmlFor="mfa-code">الرمز من التطبيق</label>
      <input id="mfa-code" className={`input num ${styles.mfaCode}`} inputMode="numeric" autoComplete="one-time-code"
        maxLength={6} dir="ltr" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} autoFocus />
      <button className="btn-primary" type="submit" disabled={busy || code.length !== 6}>
        {busy ? "لحظة…" : "تحقق"}
      </button>
      {err && <p className="error">{err}</p>}
    </form>
  );

  if (phase.kind === "challenge") {
    return (
      <Card title="التحقق بخطوتين">
        <p className="muted">لوحة التحكم محمية. اكتب الرمز المكوّن من ستة أرقام الظاهر الآن في تطبيق المصادقة على هاتفك.</p>
        {form}
        <p className={`muted ${styles.note}`}>
          فقدت هاتفك؟ احذف عامل التحقق من لوحة Supabase: Authentication ثم Users، اختر حسابك، ثم احذف الـ MFA factor، وبعدها
          أعد الإعداد من هنا.
        </p>
      </Card>
    );
  }

  return (
    <Card title="فعّل التحقق بخطوتين">
      <p className="muted">
        من الآن لا تفتح لوحة التحكم إلا برمز من هاتفك، حتى لو عرف أحد كلمة مرورك. الإعداد مرة واحدة:
      </p>
      <ol className={styles.steps}>
        <li>ثبّت على هاتفك تطبيق Google Authenticator أو Microsoft Authenticator.</li>
        <li>في التطبيق اضغط + ثم «مسح رمز QR»، وامسح هذا الرمز:</li>
      </ol>
      <div className={styles.qr}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={phase.qr} alt="رمز QR لتطبيق المصادقة" width={200} height={200} />
      </div>
      <p className="muted">
        لا تستطيع المسح؟{" "}
        <button type="button" className={styles.linkish} onClick={() => setShowSecret((s) => !s)}>
          اعرض المفتاح لكتابته يدوياً
        </button>
      </p>
      {showSecret && (
        <p className={`num ${styles.secret}`} dir="ltr">
          {phase.secret}
        </p>
      )}
      <ol className={styles.steps} start={3}>
        <li>اكتب الرمز الذي يظهر في التطبيق:</li>
      </ol>
      {form}
    </Card>
  );
}
