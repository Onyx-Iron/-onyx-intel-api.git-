import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep Next/Vercel HTTP compression on (Brotli when the client Accept-Encoding
  // includes br). Heavy takeoff JSON (coordinate arrays) benefits ~60–80%.
  compress: true,
  poweredByHeader: false,
  turbopack: {
    root: __dirname,
  },
  typescript: {
    // Supabase generated types drift from prod schema (tables added via Management API).
    // Re-tighten after running supabase typegen.
    ignoreBuildErrors: true,
  },
  async headers() {
    return [
      {
        // Canvas / takeoff APIs return dense JSON — advertise compression.
        source: "/api/:path*",
        headers: [
          { key: "Vary", value: "Accept-Encoding" },
          { key: "X-Content-Type-Options", value: "nosniff" },
        ],
      },
    ];
  },
};

export default nextConfig;
