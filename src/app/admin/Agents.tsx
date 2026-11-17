"use client";
import { useCallback, useEffect, useState } from "react";
import { Card } from "@/components/Shell";
import {
  KIND_LABELS,
  STATUS_LABELS,
  agentError,
  fmtWhen,
  newKey,
  parsePlayerNo,
  pointsToCenti,
  type AgentOverview,
  type OwnerAgentRow,
} from "@/lib/agents";
import { formatPoints } from "@/lib/points";
import { supabase } from "@/lib/supabase/client";
import styles from "./admin.module.css";

type Msg = { ok: boolean; text: string } | null;

/** Owner card: agents who hand out free points, their allowances and the full movement log (spec appendix س). */
export function Agents() {
  const [data, setData] = useState<AgentOverview | null>(null);
  const [noText, setNoText] = useState("");
  const [parent, setParent] = useState("");
  const [note, setNote] = useState("");
  const [grant, setGrant] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);
  const [showClosed, setShowClosed] = useState(false);

  const load = useCallback(async () => {
    const { data: d } = await supabase().rpc("agent_overview", {});
    if (d) setData(d as AgentOverview);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

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
    void load();
    return true;
  }

  async function add() {
    const no = parsePlayerNo(noText);
    if (no === null) return setMsg({ ok: false, text: "اكتب رقم العضو كما يظهر في محفظته." });
    const ok = await run("owner_add_agent", { p_player_no: no, p_parent: parent || null, p_note: note.trim() || null },
      parent ? "أُضيف الوكيل الفرعي." : "أُضيف الوكيل الرئيسي.");
    if (ok) {
      setNoText("");
      setNote("");
    }
  }

  async function give(a: OwnerAgentRow) {
    const amount = pointsToCenti(grant[a.user_id] ?? "");
    if (amount === null) return setMsg({ ok: false, text: agentError("BAD_AMOUNT") });
    if (!window.confirm(`منح ${a.display_name} حصة ${formatPoints(amount)} نقطة مجانية يوزّعها على اللاعبين؟`)) return;
    if (await run("owner_grant_allowance", { p_agent: a.user_id, p_amount: amount, p_key: newKey() },
      `أُضيفت ${formatPoints(amount)} نقطة إلى حصة ${a.display_name}.`)) {
      setGrant((g) => ({ ...g, [a.user_id]: "" }));
    }
  }

  async function revokeAll(a: OwnerAgentRow) {
    if (!window.confirm(`استرجاع كل الحصة المتبقية لدى ${a.display_name} (${formatPoints(a.allowance)} نقطة)؟`)) return;
    await run("owner_revoke_allowance", { p_agent: a.user_id, p_amount: null, p_key: newKey() },
      `استُرجعت حصة ${a.display_name} المتبقية.`);
  }

  async function setStatus(a: OwnerAgentRow, status: "active" | "frozen" | "closed") {
    if (status === "closed" &&
      !window.confirm(`إنهاء وكالة ${a.display_name}؟ تُسترجع حصته المتبقية، ويبقى سجله كما هو.`)) return;
    const text = status === "frozen" ? `جُمّدت وكالة ${a.display_name}.`
      : status === "closed" ? `انتهت وكالة ${a.display_name}.` : `${a.display_name} يعمل الآن.`;
    await run("set_agent_status", { p_agent: a.user_id, p_status: status }, text);
  }

  const agents = (data?.agents ?? []).filter((a) => showClosed || a.status !== "closed");
  const masters = (data?.agents ?? []).filter((a) => a.parent_id === null && a.status !== "closed");
  const closedCount = (data?.agents ?? []).filter((a) => a.status === "closed").length;

  return (
    <Card title="الوكلاء والنقاط المجانية">
      <p className={`muted ${styles.note}`}>
        الوكيل عضو تثق به، تعطيه حصة نقاط مجانية يوزّعها على أصدقائه برقم اللاعب. لا ثمن للحصة ولا للنقاط، ولا سحب ولا
        تحويل من اللاعب إلى الوكيل. الوكيل الرئيسي يستطيع إضافة وكلاء فرعيين وتمرير جزء من حصته لهم. كل حركة لها رقم
        مرجعي وتبقى في السجل.
      </p>

      {data && (
        <div className={styles.tiles}>
          <div className={styles.tile}>
            <span>مُنح للوكلاء</span>
            <b className="num">{formatPoints(data.totals.granted)}</b>
          </div>
          <div className={styles.tile}>
            <span>وُزّع على اللاعبين</span>
            <b className="num">{formatPoints(data.totals.gifted)}</b>
          </div>
          <div className={styles.tile}>
            <span>باقٍ مع الوكلاء</span>
            <b className="num">{formatPoints(data.outstanding)}</b>
          </div>
          <div className={styles.tile}>
            <span>لاعبون وصلتهم</span>
            <b className="num">{data.totals.players}</b>
          </div>
        </div>
      )}

      <div className={styles.gameControls} style={{ marginBottom: 14 }}>
        <input className="input num" inputMode="numeric" dir="ltr" placeholder="رقم العضو" aria-label="رقم العضو"
          style={{ maxWidth: 130 }} value={noText} onChange={(e) => setNoText(e.target.value.replace(/[^0-9#]/g, ""))} />
        <select className="input" aria-label="نوع الوكيل" style={{ maxWidth: 220 }} value={parent}
          onChange={(e) => setParent(e.target.value)}>
          <option value="">وكيل رئيسي</option>
          {masters.map((m) => (
            <option key={m.user_id} value={m.user_id}>فرعي لدى {m.display_name}</option>
          ))}
        </select>
        <input className="input" placeholder="ملاحظة لك (اختياري)" aria-label="ملاحظة" maxLength={200}
          style={{ maxWidth: 220 }} value={note} onChange={(e) => setNote(e.target.value)} />
        <button type="button" className="btn-primary" disabled={busy || !noText} onClick={add}>إضافة وكيل</button>
      </div>
      <p className={`muted ${styles.note}`}>رقم العضو يظهر له في صفحة المحفظة.</p>

      {agents.length > 0 && (
        <ul className={styles.games}>
          {agents.map((a) => (
            <li key={a.user_id} style={a.parent_id ? { paddingInlineStart: 18 } : undefined}>
              <div className={styles.gameName}>
                <b>
                  {a.display_name} <span className="num muted">#{a.player_no}</span>
                </b>
                <span className="muted">
                  {a.parent_id ? `فرعي لدى ${a.parent_name}` : "رئيسي"} · {STATUS_LABELS[a.status]} · الحصة{" "}
                  <span className="num">{formatPoints(a.allowance)}</span> · وزّع{" "}
                  <span className="num">{formatPoints(a.gifted)}</span> على <span className="num">{a.players}</span> لاعب
                </span>
                {a.note && <span className="muted">{a.note}</span>}
              </div>
              {a.status !== "closed" && (
                <div className={styles.gameControls}>
                  <span className={styles.rtpField}>
                    <input className="num" inputMode="numeric" aria-label={`حصة لـ ${a.display_name}`}
                      value={grant[a.user_id] ?? ""}
                      onChange={(e) => setGrant((g) => ({ ...g, [a.user_id]: e.target.value.replace(/[^0-9]/g, "") }))} />
                  </span>
                  <button type="button" className="btn-secondary" disabled={busy || !grant[a.user_id]} onClick={() => give(a)}>
                    منح حصة
                  </button>
                  <button type="button" className="btn-secondary" disabled={busy || a.allowance === 0} onClick={() => revokeAll(a)}>
                    استرجاع الحصة
                  </button>
                  <button type="button" className="btn-secondary" disabled={busy}
                    onClick={() => setStatus(a, a.status === "active" ? "frozen" : "active")}>
                    {a.status === "active" ? "تجميد" : "إعادة تفعيل"}
                  </button>
                  <button type="button" className="btn-secondary" disabled={busy} onClick={() => setStatus(a, "closed")}>
                    إنهاء الوكالة
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {closedCount > 0 && (
        <button type="button" className={styles.linkish} onClick={() => setShowClosed((v) => !v)}>
          {showClosed ? "إخفاء الوكالات المنتهية" : `عرض الوكالات المنتهية (${closedCount})`}
        </button>
      )}
      {msg && <p className={msg.ok ? "success" : "error"}>{msg.text}</p>}

      {data && data.transfers.length > 0 && (
        <>
          <h3 style={{ fontSize: 15, margin: "18px 0 8px" }}>سجل الحركات (آخر 100)</h3>
          <div className={styles.scroll}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>الوقت</th>
                  <th>المرجع</th>
                  <th>النوع</th>
                  <th>من</th>
                  <th>إلى</th>
                  <th>النقاط</th>
                </tr>
              </thead>
              <tbody>
                {data.transfers.map((t) => (
                  <tr key={t.id}>
                    <td>{fmtWhen(t.created_at)}</td>
                    <td className="num" dir="ltr">{t.ref}</td>
                    <td>{KIND_LABELS[t.kind]}</td>
                    <td>{t.from_name ?? "الإدارة"}{t.from_no !== null && <span className="num muted">{"\u00a0#"}{t.from_no}</span>}</td>
                    <td>{t.to_name ?? "الإدارة"}{t.to_no !== null && <span className="num muted">{"\u00a0#"}{t.to_no}</span>}</td>
                    <td className="num">{formatPoints(t.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Card>
  );
}
