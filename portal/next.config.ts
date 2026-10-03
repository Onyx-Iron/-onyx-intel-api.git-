import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    root: __dirname,
  },
  // Mid-sized Server Action payloads (JSON imports, small PDFs). Large plan
  // sets MUST use /api/documents/upload-url + direct Storage PUT/TUS instead —
  // this only raises the Server Action ceiling (Pro/Enterprise up to ~50MB).
  experimental: {
    serverActions: {
      bodySizeLimit: "50mb",
    },
  },
  typescript: {
    // Supabase generated types drift from prod schema (tables added via Management API).
    // Re-tighten after running supabase typegen.
    ignoreBuildErrors: true,
  },
};

export default nextConfig;
