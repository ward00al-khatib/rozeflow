// Sends a Supabase Auth invite email. Owner only (spec 2.2, 8.3).
// The service role key is provided by Supabase to Edge Functions and never reaches the browser.
import { createClient } from "npm:@supabase/supabase-js@2.49.4";
import { corsHeaders } from "../_shared/cors.ts";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

Deno.serve(async (req) => {
  const cors = corsHeaders(req.headers.get("origin"));
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

  if (req.method !== "POST") return json(405, { error: "method_not_allowed" });

  const url = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  // Act as the caller to check they are the owner (RLS + is_owner()).
  const caller = createClient(url, anonKey, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
  });
  const { data: userData } = await caller.auth.getUser();
  if (!userData?.user) return json(401, { error: "not_signed_in" });
  const { data: isOwner, error: ownerErr } = await caller.rpc("is_owner");
  if (ownerErr || isOwner !== true) return json(403, { error: "owner_only" });

  let body: { email?: string; redirectTo?: string; note?: string };
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "invalid_json" });
  }
  const email = (body.email ?? "").trim().toLowerCase();
  if (!EMAIL_RE.test(email) || email.length > 254) return json(400, { error: "invalid_email" });

  // Invite links may only lead back to our own site.
  const redirectTo = body.redirectTo ?? "";
  const origin = (() => {
    try {
      return new URL(redirectTo).origin;
    } catch {
      return "";
    }
  })();
  const allowed = (cors as Record<string, string>)["Access-Control-Allow-Origin"];
  if (origin !== allowed) return json(400, { error: "invalid_redirect" });

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const { data, error } = await admin.auth.admin.inviteUserByEmail(email, { redirectTo });
  if (error) return json(400, { error: "invite_failed", message: error.message });

  await admin.from("admin_audit_logs").insert({
    admin_id: userData.user.id,
    action: "invite_member",
    target: email,
    after_json: { invited_user_id: data.user?.id ?? null },
    reason: (body.note ?? "").slice(0, 200) || null,
  });

  return json(200, { ok: true });
});
