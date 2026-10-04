import { copyFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import type { NextConfig } from "next";

function publishPdfWorker(): void {
  try {
    const require = createRequire(join(__dirname, "package.json"));
    const source = require.resolve("pdfjs-dist/build/pdf.worker.min.mjs");
    const destDir = join(__dirname, "public");
    mkdirSync(destDir, { recursive: true });
    copyFileSync(source, join(destDir, "pdf.worker.min.mjs"));
  } catch (err) {
    console.warn("[next.config] pdf.worker.min.mjs was not copied into public/", err);
  }
}

publishPdfWorker();

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
