"use client";
import { useCallback, useEffect, useState } from "react";
import { Card } from "@/components/Shell";
import { supabase } from "@/lib/supabase/client";
import styles from "./admin.module.css";

interface SessionRow {
  at: string;
  last_seen: string;
  ip: string | null;
}

interface DeviceRow {
  id: number;
  user_id: string;
  display_name: string;
  role: string;
  label: string;
  status: "approved" | "pending" | "blocked" | "removed";
  first_seen: string;
  last_seen: string;
  last_ip: string | null;
  shared_with: string[];
  sessions: number;
  recent_sessions: SessionRow[];
}

interface Overview {
  max_devices: number;
  devices: DeviceRow[];
}

const STATUS: Record<DeviceRow["status"], string> = {
  approved: "مسموح",
  pending: "بانتظار موافقتك",
  blocked: "موقوف",
  removed: "محذوف",
};

const ERRORS: Record<string, string> = {
  DEVICE_LIMIT: "وصل العضو إلى الحد الأقصى من الأجهزة. احذف جهازاً قديماً أو ارفع الحد أولاً.",
  OWNER_DEVICE: "أجهزة المالك مسموحة دائماً.",
  MAX_DEVICES_OUT_OF_RANGE: "الحد بين 1 و 10 أجهزة.",
  OWNER_ONLY: "هذا لمالك الموقع فقط.",
};

function when(iso: string): string {
  return new Date(iso).toLocaleString("ar-SY-u-nu-latn", { dateStyle: "medium", timeStyle: "short" });
}

/** Owner card: devices per member, approvals, the per-member limit and shared-device alerts (spec appendix ط). */
export function Devices() {
  const [data, setData] = useState<Overview | null>(null);
  const [maxText, setMaxText] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [open, setOpen] = useState<number | null>(null);

  const load = useCallback(async () => {
    const { data: d, error } = await supabase().rpc("device_overview");
    if (!error && d) setData(d as Overview);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function act(dev: DeviceRow, status: "approved" | "blocked" | "removed") {
    setBusy(true);
    setMsg(null);
    const { error } = await supabase().rpc("set_device_status", { p_device_id: dev.id, p_status: status });
    setBusy(false);
    if (error) return setMsg({ ok: false, text: ERRORS[error.message] ?? "لم يُحفظ التغيير. حاول مرة أخرى." });
    const done = status === "approved" ? "سُمح" : status === "blocked" ? "أُوقف" : "حُذف";
    setMsg({ ok: true, text: `${done} جهاز ${dev.display_name} (${dev.label}).` });
    void load();
  }

  async function saveMax() {
    const n = Number(maxText);
    if (!Number.isInteger(n) || n < 1 || n > 10) return setMsg({ ok: false, text: ERRORS.MAX_DEVICES_OUT_OF_RANGE });
    setBusy(true);
    setMsg(null);
    const { error } = await supabase().rpc("set_max_devices", { p_max: n });
    setBusy(false);
    if (error) return setMsg({ ok: false, text: ERRORS[error.message] ?? "لم يُحفظ التغيير. حاول مرة أخرى." });
    setMsg({ ok: true, text: `الحد الآن ${n} لكل عضو.` });
    setMaxText("");
    void load();
  }

  const devices = (data?.devices ?? []).filter((d) => d.status !== "removed");
  const pending = devices.filter((d) => d.status === "pending");
  const shared = devices.filter((d) => d.shared_with.length > 0);
  const byMember = new Map<string, DeviceRow[]>();
  for (const d of devices) byMember.set(d.display_name, [...(byMember.get(d.display_name) ?? []), d]);

  return (
    <Card title={`الأجهزة${pending.length ? ` · ${pending.length} بانتظارك` : ""}`}>
      <p className={`muted ${styles.note}`}>
        يُعرف كل جهاز بمعرّف عشوائي يحفظه المتصفح، لأن المواقع لا تستطيع قراءة رقم الجهاز (MAC). أول جهاز للعضو يُسمح
        تلقائياً، وأي جهاز بعده ينتظر موافقتك قبل اللعب بالرصيد الحقيقي. مسح بيانات المتصفح يظهر كجهاز جديد.
      </p>

      <div className={styles.gameControls}>
        <span className="muted">
          الحد لكل عضو: <b className="num">{data?.max_devices ?? "…"}</b>
        </span>
        <span className={styles.rtpField}>
          <input className="num" inputMode="numeric" aria-label="الحد الأقصى للأجهزة" placeholder={String(data?.max_devices ?? "")}
            value={maxText} onChange={(e) => setMaxText(e.target.value.replace(/[^0-9]/g, ""))} />
        </span>
        <button type="button" className="btn-secondary" disabled={busy || !maxText} onClick={saveMax}>
          حفظ الحد
        </button>
      </div>

      {shared.length > 0 && (
        <div className={styles.alert} role="alert">
          <b>تنبيه: جهاز واحد على أكثر من حساب</b>
          <ul>
            {shared.map((d) => (
              <li key={d.id}>
                {d.label} لدى {d.display_name}، ودخل منه أيضاً: {d.shared_with.join("، ")}
              </li>
            ))}
          </ul>
        </div>
      )}

      {!data ? (
        <p className="muted">لحظة…</p>
      ) : devices.length === 0 ? (
        <p className="muted">لم يُسجَّل أي جهاز بعد. يُسجَّل الجهاز عند أول دخول للعضو بعد هذا التحديث.</p>
      ) : (
        <ul className={styles.games}>
          {[...byMember.entries()].map(([name, list]) =>
            list.map((d, i) => (
              <li key={d.id} className={d.status === "pending" ? styles.pendingRow : undefined}>
                <div className={styles.gameName}>
                  <b>{i === 0 ? name : " "}{i === 0 && d.role === "owner" && <span className="muted"> · المالك</span>}</b>
                  <span className="muted">
                    {d.label} · {STATUS[d.status]}
                    {d.shared_with.length > 0 && " · مشترك"}
                  </span>
                  <span className="muted">
                    آخر دخول {when(d.last_seen)}
                    {d.last_ip && <> · <span className="num" dir="ltr">{d.last_ip}</span></>}
                    {" · "}
                    <button type="button" className={styles.linkish} onClick={() => setOpen(open === d.id ? null : d.id)}>
                      الجلسات (<span className="num">{d.sessions}</span>)
                    </button>
                  </span>
                  {open === d.id && (
                    <ul className={styles.sessions}>
                      {d.recent_sessions.map((s) => (
                        <li key={s.at}>
                          {when(s.at)} ← آخر نشاط {when(s.last_seen)}
                          {s.ip && <> · <span className="num" dir="ltr">{s.ip}</span></>}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                {d.role !== "owner" && (
                  <div className={styles.gameControls}>
                    {d.status !== "approved" && (
                      <button type="button" className="btn-secondary" disabled={busy} onClick={() => act(d, "approved")}>
                        سماح
                      </button>
                    )}
                    {d.status !== "blocked" && (
                      <button type="button" className="btn-secondary" disabled={busy} onClick={() => act(d, "blocked")}>
                        إيقاف
                      </button>
                    )}
                    <button type="button" className="btn-secondary" disabled={busy} onClick={() => act(d, "removed")}>
                      حذف
                    </button>
                  </div>
                )}
              </li>
            )),
          )}
        </ul>
      )}
      {msg && <p className={msg.ok ? "success" : "error"}>{msg.text}</p>}
    </Card>
  );
}
