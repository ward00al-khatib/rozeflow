// Creates a member account from a one-use invite link the owner shared himself (spec appendix ن).
// Members sign in with a unique username (spec appendix ع). Supabase Auth needs an email, so the account gets
// the internal address <username>@users.rozeflow.com, which nothing is ever sent to; Auth's unique email makes
// the username unique. The service role key never reaches the browser.
import { createClient } from "npm:@supabase/supabase-js@2.49.4";
import { corsHeaders } from "../_shared/cors.ts";

const USERNAME_RE = /^[a-z0-9_]{3,20}$/;
const USERNAME_DOMAIN = "users.rozeflow.com";
const CODE_RE = /^[A-Za-z0-9_-]{16}$/;

Deno.serve(async (req) => {
  const cors = corsHeaders(req.headers.get("origin"));
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
  if (req.method !== "POST") return json(405, { error: "method_not_allowed" });

  let body: { code?: string; username?: string; password?: string };
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "invalid_json" });
  }
  const code = (body.code ?? "").trim();
  const username = (body.username ?? "").trim().toLowerCase();
  const password = body.password ?? "";
  if (!CODE_RE.test(code)) return json(400, { error: "INVITE_INVALID" });
  if (!USERNAME_RE.test(username)) return json(400, { error: "bad_username" });
  const email = `${username}@${USERNAME_DOMAIN}`;
  if (password.length < 10 || password.length > 72) return json(400, { error: "weak_password" });

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });

  // Hold the link so one code makes one account, even if two people try it at once.
  const { data: linkId, error: reserveErr } = await admin.rpc("reserve_invite_code", { p_code: code });
  if (reserveErr || linkId == null) return json(400, { error: "INVITE_INVALID" });

  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data.user) {
    await admin.rpc("finish_invite_code", { p_id: linkId, p_user: null });
    const taken = error?.code === "email_exists" || /already/i.test(error?.message ?? "");
    return json(400, { error: taken ? "username_taken" : "create_failed" });
  }
  await admin.rpc("finish_invite_code", { p_id: linkId, p_user: data.user.id });
  return json(200, { ok: true });
});
