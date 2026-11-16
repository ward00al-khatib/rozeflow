"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Card, Shell } from "@/components/Shell";
import { BigWinTicker } from "@/components/social/BigWinTicker";
import { LevelBadge } from "@/components/social/LevelBadge";
import { formatPoints } from "@/lib/points";
import { fmtMultiplier, useLeaderboard, type BoardRow } from "@/lib/social";
import { useMember } from "@/lib/useMember";
import styles from "./leaderboard.module.css";

type Sort = "net" | "wagered" | "best";
const SORTS: { id: Sort; label: string }[] = [
  { id: "net", label: "صافي الربح" },
  { id: "wagered", label: "مجموع الرهانات" },
  { id: "best", label: "أكبر مضاعف" },
];

const key = (s: Sort) => (r: BoardRow) => (s === "net" ? r.net : s === "wagered" ? r.wagered : r.best_multiplier_bp);

export default function LeaderboardPage() {
  const member = useMember();
  const router = useRouter();
  const [period, setPeriod] = useState<"week" | "all">("week");
  const [sort, setSort] = useState<Sort>("net");
  const uid = member.status === "member" ? member.profile.user_id : null;
  const { rows, error } = useLeaderboard(uid, period);

  useEffect(() => {
    if (member.status === "signed_out") router.replace("/login/");
    if (member.status === "needs_join") router.replace("/join/");
  }, [member.status, router]);

  const sorted = useMemo(() => {
    if (!rows) return null;
    const k = key(sort);
    return [...rows].sort((a, b) => k(b) - k(a) || b.wagered - a.wagered);
  }, [rows, sort]);

  return (
    <Shell member={member} wide>
      <Card title="لوحة الصدارة">
        <div className={styles.controls}>
          <div className={styles.seg} role="radiogroup" aria-label="الفترة">
            <button type="button" role="radio" aria-checked={period === "week"} onClick={() => setPeriod("week")}>
              هذا الأسبوع
            </button>
            <button type="button" role="radio" aria-checked={period === "all"} onClick={() => setPeriod("all")}>
              كل الوقت
            </button>
          </div>
          <div className={styles.seg} role="radiogroup" aria-label="الترتيب حسب">
            {SORTS.map((s) => (
              <button key={s.id} type="button" role="radio" aria-checked={sort === s.id} onClick={() => setSort(s.id)}>
                {s.label}
              </button>
            ))}
          </div>
        </div>
        {error ? (
          <p className="error">تعذّر تحميل اللوحة. حاول مرة أخرى.</p>
        ) : !sorted ? (
          <p className="muted">لحظة…</p>
        ) : sorted.every((r) => r.rounds === 0) ? (
          <p className="muted">لم يلعب أحد بعد في هذه الفترة. كن الأول.</p>
        ) : (
          <ol className={styles.board}>
            {sorted.map((r, i) => (
              <li key={r.user_id} className={r.me ? styles.me : undefined}>
                <span className={`num ${styles.rank}`} data-top={i < 3 ? i + 1 : undefined}>
                  {i + 1}
                </span>
                <span className={styles.who}>
                  <Link href={`/player/?id=${r.user_id}`} className={styles.name}>
                    {r.display_name}
                    {r.me && <span className="muted"> · أنت</span>}
                  </Link>
                  <LevelBadge wagered={r.lifetime_wagered} />
                </span>
                <span className={styles.stats}>
                  <span>
                    <small>الصافي</small>
                    <b className={`num ${r.net > 0 ? styles.plus : styles.minus}`} dir="ltr">
                      {r.net > 0 ? "+" : ""}
                      {formatPoints(r.net)}
                    </b>
                  </span>
                  <span>
                    <small>الرهانات</small>
                    <b className="num">{formatPoints(r.wagered)}</b>
                  </span>
                  <span>
                    <small>أكبر مضاعف</small>
                    <b className="num" dir="ltr">{r.best_multiplier_bp ? fmtMultiplier(r.best_multiplier_bp) : "—"}</b>
                  </span>
                  <span>
                    <small>الجولات</small>
                    <b className="num">{r.rounds.toLocaleString("en-US")}</b>
                  </span>
                </span>
              </li>
            ))}
          </ol>
        )}
        <p className={`muted ${styles.note}`}>
          الأسبوع يبدأ يوم السبت بتوقيت دمشق. اللوحة للمتعة فقط، بلا جوائز، ولا تغيّر فرص أحد.
        </p>
      </Card>
      <BigWinTicker userId={uid} />
    </Shell>
  );
}
