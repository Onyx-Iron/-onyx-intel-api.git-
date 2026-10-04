import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    ".next-*/**",
    "node_modules-*/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Deno Edge Functions: separate runtime (Deno globals, esm.sh URL
    // imports) from the rest of the portal. Linted/typechecked separately
    // under Deno's own tooling, not this Next.js/Node config -- same
    // reasoning as their tsconfig.json exclusion.
    "supabase/functions/**",
    // Vendored by next.config from pdfjs-dist; not app source.
    "public/pdf.worker.min.mjs",
  ]),
]);

export default eslintConfig;
