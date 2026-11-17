/**
 * Usernames (spec appendix ع). New members sign in with a username; Supabase Auth still needs an email, so the
 * account uses the internal address <username>@users.rozeflow.com, which nothing is ever sent to.
 */
export const USERNAME_DOMAIN = "users.rozeflow.com";
export const USERNAME_RE = /^[a-z0-9_]{3,20}$/;

/** Lower-cases and trims what the member typed. */
export function normalizeUsername(input: string): string {
  return input.trim().toLowerCase();
}

/** The sign-in email for what was typed on the login page: an email stays as is, a username maps to its address. */
export function loginEmail(input: string): string {
  const v = input.trim();
  return v.includes("@") ? v : `${normalizeUsername(v)}@${USERNAME_DOMAIN}`;
}

/** The username inside an internal address, or null for a real email. */
export function usernameOf(email: string | null | undefined): string | null {
  const e = (email ?? "").toLowerCase();
  return e.endsWith(`@${USERNAME_DOMAIN}`) ? e.slice(0, -USERNAME_DOMAIN.length - 1) : null;
}
