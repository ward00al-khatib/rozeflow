"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useMember } from "@/lib/useMember";
import styles from "./page.module.css";

const GAMES: Array<{ name: string; href?: string }> = [
  { name: "النرد", href: "/games/dice/" },
  { name: "الروليت", href: "/games/roulette/" },
  { name: "بلينكو", href: "/games/plinko/" },
  { name: "الألغام" },
  { name: "كراش" },
  { name: "السلوتس" },
];

export default function Home() {
  const member = useMember();
  const router = useRouter();
  const [linkError, setLinkError] = useState<string | null>(null);

  // Supabase sends failed email links back as #error=...&error_code=... (e.g. otp_expired).
  useEffect(() => {
    const hash = new URLSearchParams(window.location.hash.slice(1));
    const code = hash.get("error_code") ?? hash.get("error");
    if (!code) return;
    setLinkError(
      code === "otp_expired"
        ? "رابط الدعوة منتهي الصلاحية أو استُخدم من قبل. اطلب من صاحب الموقع إرسال دعوة جديدة، وافتح الرابط مرة واحدة فقط."
        : "تعذّر استخدام هذا الرابط. اطلب من صاحب الموقع إرسال رابط جديد.",
    );
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
  }, []);

  // Invite links from the Supabase dashboard land here; send them on to finish joining.
  useEffect(() => {
    if (member.status === "needs_join") router.replace("/join/");
  }, [member.status, router]);

  return (
    <main className={styles.main}>
      {/* Placeholder: the real ROZEFLOW wordmark is drawn SVG from the ROZE generator (spec 23.2). */}
      <h1 className={styles.wordmark} dir="ltr">
        <span>ROZE</span>
        <span className={styles.flow}>FLOW</span>
      </h1>
      <p className={styles.lede}>موقع خاص بالدعوات. ست ألعاب، ونقاط افتراضية فقط، ونتائج يمكنك التحقق منها بنفسك.</p>

      <ul className={styles.games}>
        {GAMES.map((g, i) => {
          const body = (
            <>
              <span className="num">{String(i + 1).padStart(2, "0")}</span>
              {g.name}
              {!g.href && <span className={styles.soon}>قريباً</span>}
            </>
          );
          return (
            <li key={g.name} className={g.href ? styles.live : undefined}>
              {g.href ? <Link href={g.href}>{body}</Link> : body}
            </li>
          );
        })}
      </ul>

      {linkError && <p className="error" role="alert">{linkError}</p>}
      {member.status === "member" ? (
        <Link href="/wallet/" className="btn-primary">محفظتي</Link>
      ) : member.status === "signed_out" ? (
        <Link href="/login/" className="btn-primary">الدخول</Link>
      ) : null}
      <p className={styles.note}>النرد والروليت وبلينكو متاحة الآن بنقاط تجريبية. بقية الألعاب قيد الإنشاء. الدخول بالدعوة فقط.</p>
    </main>
  );
}
