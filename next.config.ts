import type { NextConfig } from "next";

// The site is a static export served by GitHub Pages; all server logic (RNG, wallet, settlement)
// runs in Supabase (Postgres functions + Edge Functions). See docs/SPEC.md section 21.
// PAGES_BASE_PATH is set by the deploy workflow ("" once rozeflow.com points at Pages).
const basePath = process.env.PAGES_BASE_PATH ?? "";

const nextConfig: NextConfig = {
  output: "export",
  basePath,
  trailingSlash: true,
  images: { unoptimized: true },
};

export default nextConfig;
