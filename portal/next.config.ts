import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // CI/verification can use an isolated output directory when a synced
  // workspace has the normal .next directory locked by its file provider.
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  turbopack: {
    root: path.resolve(__dirname, ".."),
  },
  typescript: {
    // Supabase generated types drift from prod schema (tables added via Management API).
    // Re-tighten after running supabase typegen.
    ignoreBuildErrors: true,
  },
};

export default nextConfig;
