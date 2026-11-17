"use client";
import { useCallback, useEffect, useState } from "react";
import { Card } from "@/components/Shell";
import { supabase } from "@/lib/supabase/client";
import styles from "./player.module.css";

interface Offer {
  id: number;
  offer: string;
  expires_at: string;
  remaining: number;
  advertiser: string;
  logo_url: string | null;
  link_url: string | null;
}

interface Held extends Omit<Offer, "remaining"> {
  code: string;
  expired: boolean;
  source: "claim" | "award";
  note: string | null;
}

const ERRORS: Record<string, string> = {
  COUPON_SOLD_OUT: "نفدت هذه القسيمة.",
  COUPON_EXPIRED: "انتهت مدة هذه القسيمة.",
  COUPON_PAUSED: "هذه القسيمة متوقفة الآن.",
  COUPON_NOT_FOUND: "لم نجد هذه القسيمة.",
  DEVICE_NOT_APPROVED: "هذا الجهاز ينتظر موافقة المالك.",
};

function when(iso: string): string {
  return new Date(iso).toLocaleString("ar-SY-u-nu-latn", { dateStyle: "medium" });
}

function Logo({ url, name }: { url: string | null; name: string }) {
  return url ? (
    // eslint-disable-next-line @next/next/no-img-element -- advertiser logos are external links set by the owner
    <img className={styles.cLogo} src={url} alt="" referrerPolicy="no-referrer" loading="lazy" />
  ) : (
    <span className={styles.cLogo} aria-hidden="true">
      {name.slice(0, 1)}
    </span>
  );
}

/** The member's own coupons from advertisers (spec appendix ف). Free: they never cost points. */
export function MyCoupons() {
  const [available, setAvailable] = useState<Offer[] | null>(null);
  const [mine, setMine] = useState<Held[]>([]);
  const [busy, setBusy] = useState<number | null>(null);
  const [copied, setCopied] = useState<number | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data } = await supabase().rpc("my_coupons");
    if (!data) return setAvailable([]);
    const d = data as { agent: boolean; available: Offer[]; mine: Held[] };
    setAvailable(d.available);
    setMine(d.mine);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function claim(o: Offer) {
    setBusy(o.id);
    setMsg(null);
    const { error } = await supabase().rpc("claim_coupon", { p_coupon: o.id });
    setBusy(null);
    if (error) setMsg(ERRORS[error.message] ?? "لم تُؤخذ القسيمة. حاول مرة أخرى.");
    void load();
  }

  async function copy(h: Held) {
    try {
      await navigator.clipboard.writeText(h.code);
      setCopied(h.id);
    } catch {
      setMsg("لم يُنسخ تلقائياً. حدّد الكود وانسخه يدوياً.");
    }
  }

  if (available === null || (available.length === 0 && mine.length === 0)) return null;

  return (
    <Card title="قسائم المعلنين">
      <p className={`muted ${styles.note}`}>هدايا مجانية من معلنينا. لا تُشترى بالنقاط ولا تنقص رصيدك. لكل عضو نسخة واحدة.</p>
      <ul className={styles.coupons}>
        {mine.map((h) => (
          <li key={`m${h.id}`} className={h.expired ? styles.cOld : undefined}>
            <Logo url={h.logo_url} name={h.advertiser} />
            <div className={styles.cText}>
              <b>{h.offer}</b>
              <small className="muted">
                {h.advertiser}
                {h.source === "award" && <> · جائزة{h.note ? `: ${h.note}` : ""}</>}
                {" · "}
                {h.expired ? "انتهت" : `صالحة حتى ${when(h.expires_at)}`}
              </small>
              {h.link_url && (
                <a href={h.link_url} target="_blank" rel="noopener noreferrer">
                  صفحة المعلن
                </a>
              )}
            </div>
            <div className={styles.cAction}>
              <span className={`num ${styles.cCode}`} dir="ltr">
                {h.code}
              </span>
              {!h.expired && (
                <button type="button" className="btn-secondary" onClick={() => copy(h)}>
                  {copied === h.id ? "نُسخ ✓" : "نسخ"}
                </button>
              )}
            </div>
          </li>
        ))}
        {available.map((o) => (
          <li key={`a${o.id}`}>
            <Logo url={o.logo_url} name={o.advertiser} />
            <div className={styles.cText}>
              <b>{o.offer}</b>
              <small className="muted">
                {o.advertiser} · حتى {when(o.expires_at)} · بقي <span className="num">{o.remaining.toLocaleString("en-US")}</span>
              </small>
            </div>
            <div className={styles.cAction}>
              <button type="button" className="btn-primary" disabled={busy !== null} onClick={() => claim(o)}>
                {busy === o.id ? "لحظة…" : "خذ القسيمة"}
              </button>
            </div>
          </li>
        ))}
      </ul>
      {msg && <p className="error">{msg}</p>}
    </Card>
  );
}
