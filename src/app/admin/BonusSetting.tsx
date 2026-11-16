"use client";
import { useCallback, useEffect, useState } from "react";
import { Card } from "@/components/Shell";
import { formatPoints } from "@/lib/points";
import { supabase } from "@/lib/supabase/client";
import styles from "./admin.module.css";

/** Owner card: the daily bonus base amount (0 turns it off). Streak days pay up to 2.5× this. */
export function BonusSetting() {
  const [base, setBase] = useState<number | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    const { data } = await supabase().from("site_settings").select("value").eq("key", "daily_bonus").maybeSingle();
    setBase(data ? Number(data.value) : 5000);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function save() {
    const pts = Number(text);
    if (!Number.isInteger(pts) || pts < 0 || pts > 1000) {
      return setMsg({ ok: false, text: "اكتب عدداً صحيحاً من 0 إلى 1,000 نقطة." });
    }
    setBusy(true);
    setMsg(null);
    const { error } = await supabase().rpc("set_daily_bonus", { p_amount: pts * 100 });
    setBusy(false);
    if (error) return setMsg({ ok: false, text: "لم يُحفظ التغيير. حاول مرة أخرى." });
    setMsg({ ok: true, text: pts === 0 ? "أُوقفت المكافأة اليومية." : `المكافأة اليومية الآن ${pts} نقطة.` });
    setText("");
    void load();
  }

  return (
    <Card title="المكافأة اليومية">
      <p className={`muted ${styles.note}`}>
        كل عضو يأخذها مرة في اليوم (بتوقيت دمشق). تزيد ربعاً كل يوم متتالٍ حتى ضعفين ونصف في اليوم السابع، وتعود للبداية
        إذا انقطع يوماً. اكتب 0 لإيقافها.
      </p>
      <div className={styles.gameControls}>
        <span className="muted">
          الآن: <b className="num">{base === null ? "…" : base === 0 ? "متوقفة" : formatPoints(base)}</b>
          {base ? " نقطة" : ""}
        </span>
        <span className={styles.rtpField}>
          <input className="num" inputMode="numeric" aria-label="المكافأة اليومية بالنقاط" value={text}
            onChange={(e) => setText(e.target.value.replace(/[^0-9]/g, ""))} />
        </span>
        <button type="button" className="btn-secondary" disabled={busy || text === ""} onClick={save}>
          حفظ
        </button>
      </div>
      {msg && <p className={msg.ok ? "success" : "error"}>{msg.text}</p>}
    </Card>
  );
}
