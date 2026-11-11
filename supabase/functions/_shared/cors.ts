// Only the ROZEFLOW site may call these functions from a browser.
const ALLOWED_ORIGINS = new Set([
  "https://ward00al-khatib.github.io",
  "https://rozeflow.com",
  "https://www.rozeflow.com",
  "http://localhost:3000",
]);

export function corsHeaders(origin: string | null): HeadersInit {
  const allow = origin && ALLOWED_ORIGINS.has(origin) ? origin : "https://ward00al-khatib.github.io";
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    Vary: "Origin",
  };
}
