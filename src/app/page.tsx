import styles from "./page.module.css";

const GAMES = ["النرد", "الروليت", "بلينكو", "الألغام", "كراش", "السلوتس"];

export default function Home() {
  return (
    <main className={styles.main}>
      {/* Placeholder: the real ROZEFLOW wordmark is drawn SVG from the ROZE generator (spec 23.2), added in M1. */}
      <h1 className={styles.wordmark} dir="ltr">
        <span>ROZE</span>
        <span className={styles.flow}>FLOW</span>
      </h1>
      <p className={styles.lede}>موقع خاص بالدعوات. ست ألعاب، ونقاط افتراضية فقط، ونتائج يمكنك التحقق منها بنفسك.</p>

      <ul className={styles.games}>
        {GAMES.map((g, i) => (
          <li key={g}>
            <span className="num">{String(i + 1).padStart(2, "0")}</span>
            {g}
          </li>
        ))}
      </ul>

      <p className={styles.note}>قيد الإنشاء. الدخول بالدعوة فقط.</p>
    </main>
  );
}
