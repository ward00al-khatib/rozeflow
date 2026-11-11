"use client";
import Link from "next/link";
import type { ReactNode } from "react";
import { supabase } from "@/lib/supabase/client";
import type { MemberState } from "@/lib/useMember";
import styles from "./Shell.module.css";

export function Shell({ member, children }: { member: MemberState; children: ReactNode }) {
  const signedIn = member.status === "member";
  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        {/* Placeholder: replaced by the drawn ROZEFLOW wordmark SVG (spec 23.2). */}
        <Link href="/" className={styles.brand} dir="ltr">
          ROZE<span>FLOW</span>
        </Link>
        <nav className={styles.nav}>
          {signedIn && <Link href="/wallet/">المحفظة</Link>}
          {signedIn && member.profile.role === "owner" && <Link href="/admin/">الإدارة</Link>}
          {member.status === "signed_out" && <Link href="/login/">الدخول</Link>}
          {member.status !== "signed_out" && member.status !== "loading" && (
            <button type="button" className={styles.linkButton} onClick={() => supabase().auth.signOut()}>
              خروج
            </button>
          )}
        </nav>
      </header>
      <main className={styles.main}>{children}</main>
    </div>
  );
}

export function Card({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className={styles.card}>
      {title && <h2 className={styles.cardTitle}>{title}</h2>}
      {children}
    </section>
  );
}
