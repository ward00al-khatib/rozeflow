"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Card, Shell } from "@/components/Shell";
import { LevelBadge } from "@/components/social/LevelBadge";
import { formatPoints } from "@/lib/points";
import { fmtMultiplier } from "@/lib/social";
import { supabase } from "@/lib/supabase/client";
import { useMember } from "@/lib/useMember";
import styles from "./player.module.css";

interface GameStat {
  game_id: string;
  name_ar: string;
  rounds: number;
  wagered: number;
  net: number;
  wins: number;
  best_multiplier_bp: number;
}

interface Profile {
  user_id: string;
  display_name: string;
  role: string;
  joined_at: string;
  me: boolean;
  can_see_history: boolean;
  summary: {
    rounds: number;
    wagered: number;
    paid: number;
    net: number;
    wins: number;
    best_multiplier_bp: number;
    first_round_at: string | null;
    last_round_at: string | null;
  };
  games: GameStat[];
  favourite: GameStat | null;
  biggest_win: { name_ar: string; stake: number; gross: number; net: number; multiplier_bp: number; at: string } | null;
}

interface HistoryRow {
  round_id: string;
  game_id: string;
  name_ar: string;
  stake: number;
  gross: number;
  net: number;
  multiplier_bp: number;
  at: string;
  nonce: number;
}

const PAGE = 50;

function when(iso: string, time = true): string {
  return new Date(iso).toLocaleString("ar-SY-u-nu-latn", time ? { dateStyle: "medium", timeStyle: "short" } : { dateStyle: "long" });
}

function Signed({ v }: { v: number }) {
  return (
    <span className={`num ${v > 0 ? styles.plus : v < 0 ? styles.minus : ""}`} dir="ltr">
      {v > 0 ? "+" : ""}
      {formatPoints(v)}
    </span>
  );
}

export default function PlayerPage() {
  const member = useMember();
  const router = useRouter();
  const [target, setTarget] = useState<string | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [more, setMore] = useState(false);
  const [game, setGame] = useState<string>("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (member.status === "signed_out") router.replace("/login/");
    if (member.status === "needs_join") router.replace("/join/");
  }, [member.status, router]);

  const uid = member.status === "member" ? member.profile.user_id : null;
  useEffect(() => {
    if (!uid) return;
    const id = new URLSearchParams(window.location.search).get("id");
    setTarget(id && /^[0-9a-f-]{36}$/i.test(id) ? id : uid);
  }, [uid]);

  useEffect(() => {
    if (!target) return;
    setProfile(null);
    setError(null);
    supabase()
      .rpc("player_profile", { p_user: target })
      .then(({ data, error: e }) => {
        if (e || !data) return setError(e?.message === "PLAYER_NOT_FOUND" ? "لا يوجد عضو بهذا الرابط." : "تعذّر تحميل الملف.");
        setProfile(data as Profile);
      });
  }, [target]);

  const loadHistory = useCallback(
    async (offset: number) => {
      if (!target) return;
      setLoading(true);
      const { data, error: e } = await supabase().rpc("player_rounds", {
        p_user: target,
        p_offset: offset,
        p_game: game || null,
        p_limit: PAGE,
      });
      setLoading(false);
      if (e || !data) return;
      const rows = data as HistoryRow[];
      setHistory((h) => (offset === 0 ? rows : [...h, ...rows]));
      setMore(rows.length === PAGE);
    },
    [target, game],
  );

  useEffect(() => {
    if (profile?.can_see_history) void loadHistory(0);
  }, [profile, loadHistory]);

  if (member.status !== "member" || (!profile && !error)) {
    return (
      <Shell member={member} wide>
        <p className="muted">لحظة…</p>
      </Shell>
    );
  }
  if (!profile) {
    return (
      <Shell member={member} wide>
        <Card>
          <p className="error">{error}</p>
          <Link href="/leaderboard/">لوحة الصدارة</Link>
        </Card>
      </Shell>
    );
  }

  const s = profile.summary;
  const winRate = s.rounds ? Math.round((s.wins / s.rounds) * 100) : 0;
  return (
    <Shell member={member} wide>
      <section className={styles.hero}>
        <div className={styles.avatar} aria-hidden="true">
          {profile.display_name.slice(0, 1)}
        </div>
        <div className={styles.heroText}>
          <h1>
            {profile.display_name}
            {profile.me && <span className="muted"> · أنت</span>}
            {profile.role === "owner" && <span className="muted"> · المالك</span>}
          </h1>
          <span className="muted">عضو منذ {when(profile.joined_at, false)}</span>
          <LevelBadge wagered={s.wagered} progress={profile.me} />
        </div>
      </section>

      <div className={styles.tiles}>
        <div>
          <small>الجولات</small>
          <b className="num">{s.rounds.toLocaleString("en-US")}</b>
        </div>
        <div>
          <small>مجموع الرهانات</small>
          <b className="num">{formatPoints(s.wagered)}</b>
        </div>
        <div>
          <small>الصافي</small>
          <b>
            <Signed v={s.net} />
          </b>
        </div>
        <div>
          <small>جولات رابحة</small>
          <b className="num">{winRate}%</b>
        </div>
        <div>
          <small>أكبر مضاعف</small>
          <b className="num" dir="ltr">
            {s.best_multiplier_bp ? fmtMultiplier(s.best_multiplier_bp) : "—"}
          </b>
        </div>
      </div>

      <div className={styles.pair}>
        <Card title="أكبر فوز">
          {profile.biggest_win ? (
            <div className={styles.big}>
              <b className="num" dir="ltr">
                +{formatPoints(profile.biggest_win.net)}
              </b>
              <span>
                في {profile.biggest_win.name_ar} بمضاعف{" "}
                <span className="num" dir="ltr">
                  {fmtMultiplier(profile.biggest_win.multiplier_bp)}
                </span>{" "}
                من دخول <span className="num">{formatPoints(profile.biggest_win.stake)}</span>
              </span>
              <small className="muted">{when(profile.biggest_win.at)}</small>
            </div>
          ) : (
            <p className="muted">لا فوز بعد.</p>
          )}
        </Card>
        <Card title="اللعبة المفضلة">
          {profile.favourite ? (
            <div className={styles.big}>
              <b>{profile.favourite.name_ar}</b>
              <span>
                <span className="num">{profile.favourite.rounds.toLocaleString("en-US")}</span> جولة، أي{" "}
                <span className="num">{Math.round((profile.favourite.rounds / Math.max(s.rounds, 1)) * 100)}%</span> من لعبه
              </span>
              <Link href={`/games/${profile.favourite.game_id}/`}>العب {profile.favourite.name_ar}</Link>
            </div>
          ) : (
            <p className="muted">لم يلعب بعد.</p>
          )}
        </Card>
      </div>

      {profile.games.length > 0 && (
        <Card title="حسب اللعبة">
          <div className={styles.scroll}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>اللعبة</th>
                  <th>الجولات</th>
                  <th>الرهانات</th>
                  <th>الصافي</th>
                  <th>رابحة</th>
                  <th>أكبر مضاعف</th>
                </tr>
              </thead>
              <tbody>
                {profile.games.map((g) => (
                  <tr key={g.game_id}>
                    <td>{g.name_ar}</td>
                    <td className="num">{g.rounds.toLocaleString("en-US")}</td>
                    <td className="num">{formatPoints(g.wagered)}</td>
                    <td>
                      <Signed v={g.net} />
                    </td>
                    <td className="num">{Math.round((g.wins / g.rounds) * 100)}%</td>
                    <td className="num" dir="ltr">
                      {g.best_multiplier_bp ? fmtMultiplier(g.best_multiplier_bp) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {profile.can_see_history ? (
        <Card title="السجل الكامل">
          <div className={styles.filter}>
            <label htmlFor="game">اللعبة</label>
            <select id="game" className="input" value={game} onChange={(e) => setGame(e.target.value)}>
              <option value="">كل الألعاب</option>
              {profile.games.map((g) => (
                <option key={g.game_id} value={g.game_id}>
                  {g.name_ar}
                </option>
              ))}
            </select>
          </div>
          {history.length === 0 ? (
            <p className="muted">{loading ? "لحظة…" : "لا جولات بعد."}</p>
          ) : (
            <ul className={styles.history}>
              {history.map((r) => (
                <li key={r.round_id}>
                  <span className={styles.hGame}>
                    <b>{r.name_ar}</b>
                    <small className="muted">{when(r.at)}</small>
                  </span>
                  <span className={styles.hNums}>
                    <small className="muted">
                      دخول <span className="num">{formatPoints(r.stake)}</span>
                      {r.gross > 0 && (
                        <>
                          {" · "}
                          <span className="num" dir="ltr">
                            {fmtMultiplier(r.multiplier_bp)}
                          </span>
                        </>
                      )}
                    </small>
                    <Signed v={r.net} />
                  </span>
                </li>
              ))}
            </ul>
          )}
          {more && (
            <button type="button" className="btn-secondary" disabled={loading} onClick={() => loadHistory(history.length)}>
              {loading ? "لحظة…" : "المزيد"}
            </button>
          )}
          {!profile.me && <p className={`muted ${styles.note}`}>تراه لأنك مالك الموقع. الأعضاء الآخرون لا يرون سجل غيرهم.</p>}
        </Card>
      ) : (
        <p className={`muted ${styles.note}`}>السجل الكامل يراه صاحبه فقط.</p>
      )}
    </Shell>
  );
}
