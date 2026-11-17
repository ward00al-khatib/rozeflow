"use client";
import { useCallback, useEffect, useState } from "react";
import { Card } from "@/components/Shell";
import { supabase } from "@/lib/supabase/client";
import styles from "./admin.module.css";

interface Alert {
  kind: "shared_device" | "many_ips" | "many_devices";
  level: "high" | "medium";
  label?: string;
  names?: string[];
  name?: string;
  count?: number;
  at: string;
}

interface Overview {
  alerts: Alert[];
  owner_sessions: { at: string; last_seen: string; ip: string | null; label: string }[];
  paused: { user_id: string; name: string }[];
}

interface Member {
  user_id: string;
  display_name: string;
  role: string;
  status: string;
}

const ERRORS: Record<string, string> = {
  OWNER_ACCOUNT: "لا يمكن تطبيق هذا على حساب المالك.",
  BAD_STATUS: "حالة غير صالحة.",
  OWNER_ONLY: "هذا لمالك الموقع فقط.",
};

function when(iso: string): string {
  return new Date(iso).toLocaleString("ar-SY-u-nu-latn", { dateStyle: "medium", timeStyle: "short" });
}

function alertText(a: Alert): string {
  if (a.kind === "shared_device") return `جهاز واحد (${a.label}) دخلت منه عدة حسابات: ${(a.names ?? []).join("، ")}.`;
  if (a.kind === "many_ips") return `${a.name} دخل من ${a.count} عناوين مختلفة خلال 24 ساعة.`;
  return `${a.name} أضاف ${a.count} أجهزة جديدة خلال 24 ساعة.`;
}

/** Owner card: alerts, sign-ins to the owner's own account, freezing members and signing them out everywhere. */
export function Security() {
  const [data, setData] = useState<Overview | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    const sb = supabase();
    const [{ data: a }, { data: m }] = await Promise.all([
      sb.rpc("security_alerts"),
      sb.from("profiles").select("user_id, display_name, role, status").order("created_at"),
    ]);
    if (a) setData(a as Overview);
    if (m) setMembers((m as Member[]).filter((x) => x.role !== "owner"));
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function run(fn: string, args: Record<string, unknown>, ok: string) {
    setBusy(true);
    setMsg(null);
    const { error } = await supabase().rpc(fn, args);
    setBusy(false);
    if (error) return setMsg({ ok: false, text: ERRORS[error.message] ?? "لم يُحفظ التغيير. حاول مرة أخرى." });
    setMsg({ ok: true, text: ok });
    void load();
  }

  function freeze(m: Member) {
    const pause = m.status === "active";
    if (pause && !window.confirm(`إيقاف ${m.display_name}؟ لن يستطيع اللعب بالرصيد الحقيقي أو أخذ المكافأة حتى تعيد تفعيله.`)) return;
    void run("set_member_status", { p_user: m.user_id, p_status: pause ? "paused" : "active" },
      pause ? `أُوقف حساب ${m.display_name}.` : `عاد حساب ${m.display_name} للعمل.`);
  }

  function resetDevices(m: Member) {
    if (!window.confirm(`إخراج ${m.display_name} من كل أجهزته؟ سيحتاج كل جهاز موافقتك من جديد.`)) return;
    void run("reset_member_devices", { p_user: m.user_id }, `أُخرج ${m.display_name} من كل أجهزته.`);
  }

  return (
    <Card title={`الأمان${data && data.alerts.length ? ` · ${data.alerts.length} تنبيه` : ""}`}>
      {!data ? (
        <p className="muted">لحظة…</p>
      ) : data.alerts.length === 0 ? (
        <p className="muted">لا تنبيهات الآن.</p>
      ) : (
        <div className={styles.alert} role="alert">
          <b>تنبيهات</b>
          <ul>
            {data.alerts.map((a, i) => (
              <li key={i}>
                {alertText(a)} <small className="muted">{when(a.at)}</small>
              </li>
            ))}
          </ul>
        </div>
      )}

      <h3 className={styles.sub}>دخول إلى حسابك في آخر 7 أيام</h3>
      <p className={`muted ${styles.note}`}>إذا رأيت دخولاً لا تعرفه، غيّر كلمة مرورك فوراً.</p>
      <ul className={styles.plain}>
        {(data?.owner_sessions ?? []).map((s) => (
          <li key={s.at}>
            <bdi>{s.label}</bdi> · <bdi>{when(s.at)}</bdi>
            {s.ip && (
              <>
                {" · "}
                <span className="num" dir="ltr">
                  {s.ip}
                </span>
              </>
            )}
          </li>
        ))}
      </ul>

      <h3 className={styles.sub}>الأعضاء</h3>
      <ul className={styles.games}>
        {members.map((m) => (
          <li key={m.user_id}>
            <div className={styles.gameName}>
              <b>{m.display_name}</b>
              <span className="muted">{m.status === "active" ? "يعمل" : m.status === "paused" ? "موقوف" : m.status}</span>
            </div>
            <div className={styles.gameControls}>
              {(m.status === "active" || m.status === "paused") && (
                <button type="button" className="btn-secondary" disabled={busy} onClick={() => freeze(m)}>
                  {m.status === "active" ? "إيقاف الحساب" : "إعادة التفعيل"}
                </button>
              )}
              <button type="button" className="btn-secondary" disabled={busy} onClick={() => resetDevices(m)}>
                إخراج من كل الأجهزة
              </button>
            </div>
          </li>
        ))}
      </ul>
      {msg && <p className={msg.ok ? "success" : "error"}>{msg.text}</p>}
    </Card>
  );
}
