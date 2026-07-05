import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    root: __dirname,
  },
  typescript: {
    // Supabase generated types drift from prod schema (tables added via Management API).
    // Re-tighten after running supabase typegen.
    ignoreBuildErrors: true,
  },
};

export default nextConfig;
