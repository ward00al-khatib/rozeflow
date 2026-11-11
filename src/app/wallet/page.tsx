"use client";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Card, Shell } from "@/components/Shell";
import { LEDGER_LABELS, availableDelta, formatPoints } from "@/lib/points";
import { supabase } from "@/lib/supabase/client";
import { useMember } from "@/lib/useMember";
import styles from "./wallet.module.css";

interface Wallet {
  available: number;
  reserved: number;
}
interface LedgerRow {
  id: number;
  type: string;
  amount: number;
  available_after: number;
  created_at: string;
  reason: string | null;
}

const DATE_FMT = new Intl.DateTimeFormat("ar-SY-u-nu-latn", {
  day: "numeric",
  month: "long",
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});

export default function WalletPage() {
  const member = useMember();
  const router = useRouter();
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [rows, setRows] = useState<LedgerRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (member.status === "signed_out") router.replace("/login/");
    if (member.status === "needs_join") router.replace("/join/");
  }, [member.status, router]);

  const uid = member.status === "member" ? member.profile.user_id : null;
  useEffect(() => {
    if (!uid) return;
    const sb = supabase();
    Promise.all([
      sb.from("wallet_accounts").select("available, reserved").eq("user_id", uid).single(),
      sb.from("wallet_ledger")
        .select("id, type, amount, available_after, created_at, reason")
        .eq("user_id", uid)
        .order("id", { ascending: false })
        .limit(50),
    ]).then(([w, l]) => {
      if (w.error || l.error) return setError("تعذّر تحميل المحفظة.");
      setWallet(w.data as Wallet);
      setRows((l.data ?? []) as LedgerRow[]);
    });
  }, [uid]);

  return (
    <Shell member={member}>
      {member.status === "member" && <p className="muted">أهلاً {member.profile.display_name}</p>}
      <Card>
        <div className={styles.balances}>
          <div>
            <div className="muted">الرصيد المتاح</div>
            <div className={`num ${styles.big}`}>{wallet ? formatPoints(wallet.available) : "—"}</div>
          </div>
          <div>
            <div className="muted">محجوز في جولات</div>
            <div className={`num ${styles.small}`}>{wallet ? formatPoints(wallet.reserved) : "—"}</div>
          </div>
        </div>
        <p className="muted">نقاط افتراضية للترفيه فقط، بلا أي قيمة مالية.</p>
      </Card>

      <Card title="سجل الحركات">
        {error && <p className="error">{error}</p>}
        {!error && rows.length === 0 && <p className="muted">لا حركات بعد.</p>}
        <ul className={styles.ledger}>
          {rows.map((r) => {
            const delta = availableDelta(r.type, r.amount);
            return (
              <li key={r.id}>
                <div>
                  <div>{LEDGER_LABELS[r.type] ?? r.type}</div>
                  <div className="muted">{DATE_FMT.format(new Date(r.created_at))}{r.reason ? ` · ${r.reason}` : ""}</div>
                </div>
                <div className={styles.amounts}>
                  <span className={`num ${delta > 0 ? styles.plus : styles.minus}`}>
                    {delta > 0 ? "+" : ""}{formatPoints(delta)}
                  </span>
                  <span className="num muted">{formatPoints(r.available_after)}</span>
                </div>
              </li>
            );
          })}
        </ul>
      </Card>
    </Shell>
  );
}
