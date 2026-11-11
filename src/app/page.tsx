"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Ambient } from "@/components/fx/Ambient";
import { GameCover, type GameId } from "@/components/lobby/Covers";
import { useMember } from "@/lib/useMember";
import styles from "./page.module.css";

const GAMES: Array<{ id: GameId; name: string; tag: string; fact: [string, string]; wide?: boolean }> = [
  { id: "slots", name: "السلوتس", tag: "مختبر الليل · لفّات مجانية بمضاعف يكبر", fact: ["عائد", "95.8%"], wide: true },
  { id: "crash", name: "كراش", tag: "حصّل قبل الانهيار", fact: ["حتى", "1,000×"], wide: true },
  { id: "dice", name: "النرد", tag: "اختر فرصتك", fact: ["عائد", "99%"] },
  { id: "roulette", name: "الروليت", tag: "صفر واحد", fact: ["حتى", "36×"] },
  { id: "plinko", name: "بلينكو", tag: "ثلاث مخاطر", fact: ["عائد", "99%"] },
  { id: "mines", name: "الألغام", tag: "اكشف وحصّل", fact: ["حتى", "1,000×"] },
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
      <Ambient count={34} seed={11} />
      <header className={styles.top}>
        {/* Placeholder: the real ROZEFLOW wordmark is drawn SVG from the ROZE generator (spec 23.2). */}
        <span className={styles.brand} dir="ltr">
          ROZE<span>FLOW</span>
        </span>
        {member.status === "member" ? (
          <Link href="/wallet/" className={styles.account}>
            محفظتي
          </Link>
        ) : member.status === "signed_out" ? (
          <Link href="/login/" className={styles.account}>
            الدخول
          </Link>
        ) : null}
      </header>

      <section className={styles.hero}>
        <h1 className={styles.wordmark} dir="ltr">
          <span>ROZE</span>
          <span className={styles.flow}>FLOW</span>
        </h1>
        <p className={styles.lede}>ست ألعاب بنقاط افتراضية فقط، ونتائج يمكنك التحقق منها بنفسك.</p>
        {linkError && (
          <p className="error" role="alert">
            {linkError}
          </p>
        )}
      </section>

      <ul className={styles.games}>
        {GAMES.map((g, i) => (
          <li key={g.id} className={g.wide ? styles.wide : undefined} style={{ animationDelay: `${i * 70}ms` }}>
            <Link href={`/games/${g.id}/`} className={styles.card}>
              <span className={styles.art}>
                <GameCover game={g.id} />
              </span>
              <span className={styles.meta}>
                <span className={styles.text}>
                  <strong>{g.name}</strong>
                  <small>{g.tag}</small>
                </span>
                <span className={styles.fact}>
                  {g.fact[0]} <span className="num">{g.fact[1]}</span>
                </span>
              </span>
              <span className={styles.play} aria-hidden="true">
                <svg viewBox="0 0 24 24">
                  <path d="M8 5.5v13l11-6.5z" fill="currentColor" />
                </svg>
                العب
              </span>
            </Link>
          </li>
        ))}
      </ul>

      <p className={styles.note}>الألعاب متاحة الآن بنقاط تجريبية تبقى في متصفحك. الدخول بالدعوة فقط.</p>
    </main>
  );
}
