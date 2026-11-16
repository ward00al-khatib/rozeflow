"use client";
import { useState } from "react";
import { commitServerSeed } from "@/lib/fairness/rng";
import { revealedSeedFor, type DemoRound, type RevealedSeed } from "@/lib/demo/session";
import styles from "./DemoFairness.module.css";

type Seeds = { serverSeedHex: string; clientSeed: string; nonce: number };

/** What the panel needs: the demo session in the browser, or the member's seeds on the server. */
export interface FairnessSource {
  rounds: DemoRound[];
  revealed: RevealedSeed[];
  serverSeedHash: string;
  clientSeed: string;
  nonce: number;
  open: unknown;
  rotateSeeds: (clientSeed: string) => void | Promise<void>;
}

/** Fairness panel (spec 6.3): commitment before play, reveal on rotation, re-check of past rounds. */
export function DemoFairness({
  demo,
  game,
  verify,
}: {
  demo: FairnessSource;
  game: string;
  verify: (seeds: Seeds, round: DemoRound) => string;
}) {
  const [nextClientSeed, setNextClientSeed] = useState("");
  const [checks, setChecks] = useState<Record<string, string>>({});
  const [rotating, setRotating] = useState(false);
  const [rotateError, setRotateError] = useState<string | null>(null);

  const verifiable = demo.rounds
    .filter((r) => r.game === game)
    .map((r) => ({ r, seed: revealedSeedFor(r, demo.revealed) }))
    .filter((x): x is { r: DemoRound; seed: string } => x.seed !== null)
    .slice(0, 8);

  function check(r: DemoRound, seed: string) {
    const key = `${r.serverSeedHash}:${r.nonce}`;
    const hashOk = commitServerSeed(seed) === r.serverSeedHash;
    const result = verify({ serverSeedHex: seed, clientSeed: r.clientSeed, nonce: r.nonce }, r);
    setChecks((c) => ({ ...c, [key]: hashOk ? `✓ البذرة تطابق البصمة، والنتيجة المعاد حسابها: ${result}` : "✗ البذرة لا تطابق البصمة" }));
  }

  return (
    <details className={styles.panel}>
      <summary>العدالة: تحقق من النتائج بنفسك</summary>

      <p className="muted">
        قبل أي جولة نعرض بصمة (SHA-256) لبذرة الخادم السرية. كل نتيجة تُحسب من HMAC-SHA-256 لبذرة الخادم مع بذرتك ورقم
        الجولة (nonce). عند تغيير البذرة نكشف البذرة القديمة، فتستطيع إعادة حساب كل جولة سابقة ومطابقتها.
      </p>

      <dl className={styles.kv}>
        <dt>بصمة بذرة الخادم الحالية</dt>
        <dd className="num">{demo.serverSeedHash}</dd>
        <dt>بذرتك (client seed)</dt>
        <dd className="num">{demo.clientSeed}</dd>
        <dt>رقم الجولة التالية (nonce)</dt>
        <dd className="num">{demo.nonce}</dd>
      </dl>

      <div className={styles.rotate}>
        <input
          className="input num"
          placeholder="بذرة جديدة (اختياري)"
          maxLength={64}
          value={nextClientSeed}
          onChange={(e) => setNextClientSeed(e.target.value)}
        />
        <button
          type="button"
          className="btn-secondary"
          disabled={!!demo.open || rotating}
          title={demo.open ? "أكمل الجولة المفتوحة أولاً" : undefined}
          onClick={async () => {
            setRotating(true);
            setRotateError(null);
            try {
              await demo.rotateSeeds(nextClientSeed);
              setNextClientSeed("");
            } catch (e) {
              setRotateError(e instanceof Error ? e.message : "تعذّر تغيير البذرة.");
            } finally {
              setRotating(false);
            }
          }}
        >
          اكشف البذرة وابدأ بذرة جديدة
        </button>
      </div>
      {rotateError && <p className="error">{rotateError}</p>}

      {demo.revealed.length > 0 && (
        <>
          <h3>بذور مكشوفة</h3>
          <ul className={styles.revealed}>
            {demo.revealed.slice(0, 3).map((s) => (
              <li key={s.serverSeedHash}>
                <span className="muted">البذرة:</span> <span className="num">{s.serverSeed}</span>
                <br />
                <span className="muted">بصمتها:</span> <span className="num">{s.serverSeedHash}</span>
                <br />
                <span className="muted">الجولات:</span> <span className="num">0 – {Math.max(s.lastNonce - 1, 0)}</span>
              </li>
            ))}
          </ul>
        </>
      )}

      {verifiable.length > 0 && (
        <>
          <h3>أعد حساب جولة</h3>
          <ul className={styles.verify}>
            {verifiable.map(({ r, seed }) => {
              const key = `${r.serverSeedHash}:${r.nonce}`;
              return (
                <li key={key}>
                  <span>
                    جولة <span className="num">{r.nonce}</span>
                  </span>
                  <button type="button" className={styles.linkButton} onClick={() => check(r, seed)}>
                    تحقق
                  </button>
                  {checks[key] && <span className={styles.check}>{checks[key]}</span>}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </details>
  );
}
