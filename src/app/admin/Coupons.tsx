"use client";
import { useCallback, useEffect, useState } from "react";
import { Card } from "@/components/Shell";
import { supabase } from "@/lib/supabase/client";
import styles from "./admin.module.css";

interface Advertiser {
  id: number;
  name: string;
  logo_url: string | null;
  link_url: string | null;
  status: "active" | "hidden";
}

interface Holder {
  display_name: string;
  player_no: number | null;
  source: "claim" | "award";
  at: string;
}

interface CouponRow {
  id: number;
  advertiser_id: number;
  advertiser: string;
  offer: string;
  code: string;
  audience: "all" | "award";
  quantity: number;
  expires_at: string;
  status: "active" | "paused";
  expired: boolean;
  holders: Holder[];
}

const ERRORS: Record<string, string> = {
  OWNER_ONLY: "هذا لمالك الموقع فقط.",
  URL_NOT_HTTPS: "الروابط يجب أن تبدأ بـ https://",
  BAD_NAME: "اكتب اسم المعلن (حتى 60 حرفاً).",
  BAD_OFFER: "اكتب نص العرض (حتى 200 حرف).",
  BAD_CODE: "اكتب كود القسيمة (حتى 60 حرفاً).",
  BAD_QUANTITY: "العدد من 1 إلى 100,000.",
  BAD_EXPIRY: "تاريخ الانتهاء يجب أن يكون بعد اليوم وخلال سنة.",
  ADVERTISER_NOT_FOUND: "اختر معلناً.",
  COUPON_PAUSED: "القسيمة موقوفة. شغّلها أولاً.",
  COUPON_EXPIRED: "انتهت مدة القسيمة.",
  COUPON_SOLD_OUT: "لا تكفي النسخ الباقية لكل الفائزين. زد العدد بقسيمة جديدة.",
  NO_PLAYERS: "لا لاعبين في لوحة هذا الأسبوع بعد.",
  PLAYER_NOT_FOUND: "لا يوجد لاعب بهذا الرقم.",
  PLAYER_IS_AGENT: "هذا الرقم لوكيل، والوكلاء لا يأخذون قسائم.",
  ALREADY_HAS_COUPON: "هذا اللاعب عنده القسيمة.",
};

function when(iso: string): string {
  return new Date(iso).toLocaleString("ar-SY-u-nu-latn", { dateStyle: "medium" });
}

/** Last minute of a calendar day in Damascus time (UTC+3). */
function endOfDay(date: string): string {
  return `${date}T23:59:00+03:00`;
}

/**
 * Owner card: advertisers and their coupons (spec appendix ف). Coupons are free for members: claimed once by any
 * member, or awarded by the owner to the weekly leaderboard's top players. They are never bought with points.
 */
export function Coupons() {
  const [advertisers, setAdvertisers] = useState<Advertiser[]>([]);
  const [coupons, setCoupons] = useState<CouponRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [adv, setAdv] = useState({ id: null as number | null, name: "", logo: "", link: "" });
  const [form, setForm] = useState({ advertiser: "", offer: "", code: "", audience: "all", quantity: "100", expires: "" });
  const [top, setTop] = useState<Record<number, string>>({});
  const [week, setWeek] = useState<"current" | "previous">("previous");
  const [playerNo, setPlayerNo] = useState<Record<number, string>>({});
  const [openId, setOpenId] = useState<number | null>(null);

  const load = useCallback(async () => {
    const { data } = await supabase().rpc("owner_coupons");
    if (!data) return;
    const d = data as { advertisers: Advertiser[]; coupons: CouponRow[] };
    setAdvertisers(d.advertisers);
    setCoupons(d.coupons);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function run(fn: string, args: Record<string, unknown>, ok: (data: unknown) => string) {
    setBusy(true);
    setMsg(null);
    const { data, error } = await supabase().rpc(fn, args);
    setBusy(false);
    if (error) {
      setMsg({ ok: false, text: ERRORS[error.message] ?? "لم يُحفظ. حاول مرة أخرى." });
      return false;
    }
    setMsg({ ok: true, text: ok(data) });
    void load();
    return true;
  }

  async function saveAdvertiser() {
    const done = await run(
      "owner_save_advertiser",
      { p_id: adv.id, p_name: adv.name.trim(), p_logo_url: adv.logo.trim() || null, p_link_url: adv.link.trim() || null },
      () => (adv.id ? "حُفظ المعلن." : "أُضيف المعلن."),
    );
    if (done) setAdv({ id: null, name: "", logo: "", link: "" });
  }

  async function createCoupon() {
    if (!form.expires) return setMsg({ ok: false, text: ERRORS.BAD_EXPIRY });
    const done = await run(
      "owner_create_coupon",
      {
        p_advertiser: Number(form.advertiser) || 0,
        p_offer: form.offer.trim(),
        p_code: form.code.trim(),
        p_audience: form.audience,
        p_quantity: Number(form.quantity) || 0,
        p_expires_at: endOfDay(form.expires),
      },
      () => "أُضيفت القسيمة.",
    );
    if (done) setForm((f) => ({ ...f, offer: "", code: "" }));
  }

  function awarded(data: unknown): string {
    const d = data as { given: { display_name: string }[]; skipped: number };
    if (d.given.length === 0) return "كل الفائزين عندهم القسيمة من قبل.";
    return `أُعطيت القسيمة إلى: ${d.given.map((g) => g.display_name).join("، ")}.`;
  }

  return (
    <Card title="المعلنون والقسائم">
      <p className={`muted ${styles.note}`}>
        القسائم مجانية للأعضاء ولا تُشترى بالنقاط ولا تُنقص الرصيد. «للجميع»: يأخذ كل عضو نسخة واحدة من صفحته حتى تنفد.
        «جائزة»: لا تظهر إلا لمن تعطيها له، لأفضل لاعبي الأسبوع أو للاعب برقمه. الوكلاء لا يأخذون قسائم.
      </p>

      <h3 className={styles.sub}>{adv.id ? "تعديل معلن" : "إضافة معلن"}</h3>
      <div className="field">
        <label htmlFor="adv-name">اسم المعلن</label>
        <input id="adv-name" className="input" maxLength={60} value={adv.name} onChange={(e) => setAdv({ ...adv, name: e.target.value })} />
      </div>
      <div className="field">
        <label htmlFor="adv-logo">رابط الشعار (اختياري، يبدأ بـ https://)</label>
        <input id="adv-logo" className="input" dir="ltr" value={adv.logo} onChange={(e) => setAdv({ ...adv, logo: e.target.value })} />
      </div>
      <div className="field">
        <label htmlFor="adv-link">رابط صفحة المعلن (اختياري)</label>
        <input id="adv-link" className="input" dir="ltr" value={adv.link} onChange={(e) => setAdv({ ...adv, link: e.target.value })} />
      </div>
      <div className={styles.gameControls}>
        <button type="button" className="btn-secondary" disabled={busy || !adv.name.trim()} onClick={saveAdvertiser}>
          {adv.id ? "حفظ التعديل" : "إضافة المعلن"}
        </button>
        {adv.id && (
          <button type="button" className="btn-secondary" onClick={() => setAdv({ id: null, name: "", logo: "", link: "" })}>
            إلغاء
          </button>
        )}
      </div>

      {advertisers.length > 0 && (
        <ul className={styles.games}>
          {advertisers.map((a) => (
            <li key={a.id}>
              <div className={styles.gameName}>
                <b>{a.name}</b>
                <span className="muted">{a.status === "active" ? "ظاهر" : "مخفي"}</span>
              </div>
              <div className={styles.gameControls}>
                <button type="button" className="btn-secondary"
                  onClick={() => setAdv({ id: a.id, name: a.name, logo: a.logo_url ?? "", link: a.link_url ?? "" })}>
                  تعديل
                </button>
                <button type="button" className="btn-secondary" disabled={busy}
                  onClick={() => run("owner_set_advertiser_status", { p_id: a.id, p_status: a.status === "active" ? "hidden" : "active" },
                    () => (a.status === "active" ? "أُخفي المعلن وقسائمه المفتوحة." : "ظهر المعلن."))}>
                  {a.status === "active" ? "إخفاء" : "إظهار"}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {advertisers.length > 0 && (
        <>
          <h3 className={styles.sub}>قسيمة جديدة</h3>
          <div className="field">
            <label htmlFor="cp-adv">المعلن</label>
            <select id="cp-adv" className="input" value={form.advertiser} onChange={(e) => setForm({ ...form, advertiser: e.target.value })}>
              <option value="">اختر…</option>
              {advertisers.filter((a) => a.status === "active").map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="cp-offer">العرض (مثلاً: خصم 10% على أول طلب)</label>
            <input id="cp-offer" className="input" maxLength={200} value={form.offer} onChange={(e) => setForm({ ...form, offer: e.target.value })} />
          </div>
          <div className="field">
            <label htmlFor="cp-code">الكود الذي أعطاك إياه المعلن (يظهر للعضو بعد أخذ القسيمة)</label>
            <input id="cp-code" className="input num" dir="ltr" maxLength={60} value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} />
          </div>
          <div className={styles.gameControls}>
            <div className={styles.periods} role="radiogroup" aria-label="لمن القسيمة">
              <button type="button" role="radio" aria-checked={form.audience === "all"} onClick={() => setForm({ ...form, audience: "all" })}>
                للجميع
              </button>
              <button type="button" role="radio" aria-checked={form.audience === "award"} onClick={() => setForm({ ...form, audience: "award" })}>
                جائزة
              </button>
            </div>
            <span className={styles.rtpField}>
              <input className="num" inputMode="numeric" aria-label="عدد النسخ" value={form.quantity}
                onChange={(e) => setForm({ ...form, quantity: e.target.value.replace(/[^0-9]/g, "") })} />
              <i>نسخة</i>
            </span>
            <label className="muted">
              تنتهي في{" "}
              <input type="date" className="input num" value={form.expires} onChange={(e) => setForm({ ...form, expires: e.target.value })} />
            </label>
          </div>
          <button type="button" className="btn-primary" disabled={busy || !form.advertiser || !form.offer.trim() || !form.code.trim()}
            onClick={createCoupon}>
            إضافة القسيمة
          </button>
        </>
      )}

      {coupons.length > 0 && (
        <>
          <h3 className={styles.sub}>القسائم</h3>
          <div className={styles.gameControls}>
            <span className="muted">جوائز اللوحة من</span>
            <div className={styles.periods} role="radiogroup" aria-label="أي أسبوع">
              <button type="button" role="radio" aria-checked={week === "previous"} onClick={() => setWeek("previous")}>الأسبوع الماضي</button>
              <button type="button" role="radio" aria-checked={week === "current"} onClick={() => setWeek("current")}>هذا الأسبوع</button>
            </div>
          </div>
          <ul className={styles.games}>
            {coupons.map((c) => {
              const live = c.status === "active" && !c.expired;
              return (
                <li key={c.id}>
                  <div className={styles.gameName}>
                    <b>{c.advertiser} · {c.offer}</b>
                    <span className="muted">
                      {c.audience === "all" ? "للجميع" : "جائزة"} · الكود <span className="num" dir="ltr">{c.code}</span> ·{" "}
                      <span className="num">{c.holders.length}</span> من <span className="num">{c.quantity}</span> ·{" "}
                      {c.expired ? "انتهت" : `حتى ${when(c.expires_at)}`}
                      {c.status === "paused" && " · موقوفة"}
                    </span>
                  </div>
                  <div className={styles.gameControls}>
                    {c.audience === "award" && live && (
                      <>
                        <span className={styles.rtpField}>
                          <i>أفضل</i>
                          <input className="num" inputMode="numeric" aria-label="عدد الفائزين" placeholder="3" value={top[c.id] ?? ""}
                            onChange={(e) => setTop({ ...top, [c.id]: e.target.value.replace(/[^0-9]/g, "") })} />
                        </span>
                        <button type="button" className="btn-secondary" disabled={busy}
                          onClick={() => run("owner_award_coupon_top", { p_coupon: c.id, p_week: week, p_top: Number(top[c.id] || 3) }, awarded)}>
                          امنح المتصدرين
                        </button>
                      </>
                    )}
                    {live && (
                      <>
                        <span className={styles.rtpField}>
                          <i>#</i>
                          <input className="num" inputMode="numeric" aria-label="رقم اللاعب" value={playerNo[c.id] ?? ""}
                            onChange={(e) => setPlayerNo({ ...playerNo, [c.id]: e.target.value.replace(/[^0-9]/g, "") })} />
                        </span>
                        <button type="button" className="btn-secondary" disabled={busy || !playerNo[c.id]}
                          onClick={() => run("owner_award_coupon_player", { p_coupon: c.id, p_player_no: Number(playerNo[c.id]) }, awarded)}>
                          امنح لاعباً
                        </button>
                      </>
                    )}
                    {!c.expired && (
                      <button type="button" className="btn-secondary" disabled={busy}
                        onClick={() => run("owner_set_coupon_status", { p_id: c.id, p_status: c.status === "active" ? "paused" : "active" },
                          () => (c.status === "active" ? "أُوقفت القسيمة." : "شُغّلت القسيمة."))}>
                        {c.status === "active" ? "إيقاف" : "تشغيل"}
                      </button>
                    )}
                    {c.holders.length > 0 && (
                      <button type="button" className="btn-secondary" onClick={() => setOpenId(openId === c.id ? null : c.id)}>
                        {openId === c.id ? "إخفاء الأسماء" : "من أخذها"}
                      </button>
                    )}
                  </div>
                  {openId === c.id && (
                    <ul className={`${styles.plain} ${styles.holders}`}>
                      {c.holders.map((h, i) => (
                        <li key={i}>
                          {h.display_name}
                          {h.player_no !== null && <span className="num muted">{" #"}{h.player_no}</span>} ·{" "}
                          {h.source === "award" ? "جائزة" : "أخذها بنفسه"} · {when(h.at)}
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}
      {msg && <p className={msg.ok ? "success" : "error"}>{msg.text}</p>}
    </Card>
  );
}
