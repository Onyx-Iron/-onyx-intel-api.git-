// Mandatory safety guard for live-database integration tests.
//
// Context: an earlier pass of integration tests (procurement, change orders,
// financial-redaction) ran against .env.local, which pointed at the
// PRODUCTION Supabase project. No residual data was found on inspection, but
// running tests against production at all was a mistake this guard prevents
// from happening again.
//
// Every *.integration.test.ts file must call requireIntegrationTestEnv()
// (or use loadIntegrationTestEnv() below) instead of reading
// NEXT_PUBLIC_SUPABASE_URL/.env.local directly. This:
//   1. Requires ALLOW_INTEGRATION_TESTS=true to be set at all — absent that,
//      tests self-skip (same as missing credentials today).
//   2. Loads credentials ONLY from .env.test.local (a dedicated, gitignored
//      file pointing at the isolated test branch/project) — never
//      .env.local, so a developer's normal dev env can never be mistaken
//      for the test target.
//   3. Fails CLOSED (throws, does not skip) if the resolved project ref
//      matches the known production project ref, even if ALLOW_INTEGRATION_TESTS
//      is set and .env.test.local is somehow misconfigured to point at prod.

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/** The production Supabase project ref — vvnigrbdsipriufhrwbs.supabase.co. Tests must never target this. */
export const PRODUCTION_PROJECT_REF = "vvnigrbdsipriufhrwbs";

export interface IntegrationTestEnv {
  ready: boolean;
  skipReason?: string;
  supabaseUrl?: string;
  serviceKey?: string;
  projectRef?: string;
}

function loadEnvFile(relativePath: string): Record<string, string> {
  const envPath = resolve(__dirname, relativePath);
  const out: Record<string, string> = {};
  if (!existsSync(envPath)) return out;
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match) out[match[1]] = match[2].trim();
  }
  return out;
}

function extractProjectRef(supabaseUrl: string): string | undefined {
  return supabaseUrl.match(/^https:\/\/([a-z0-9]+)\.supabase\.co/)?.[1];
}

/**
 * Resolves whether live-database integration tests may run, and against
 * which project. Never reads .env.local — only .env.test.local and
 * already-set process.env values (e.g. from a CI test-environment secret).
 *
 * Throws (fails closed) if the resolved target is the production project,
 * regardless of ALLOW_INTEGRATION_TESTS. Returns `{ ready: false }` (self-skip,
 * not a failure) for any other reason tests can't run: flag unset, or
 * credentials absent.
 */
export function loadIntegrationTestEnv(): IntegrationTestEnv {
  const fromFile = loadEnvFile("../../.env.test.local");
  const get = (key: string): string | undefined => process.env[key] ?? fromFile[key];

  const allowFlag = get("ALLOW_INTEGRATION_TESTS");
  const supabaseUrl = get("TEST_SUPABASE_URL");
  const serviceKey = get("TEST_SUPABASE_SERVICE_ROLE_KEY");

  const projectRef = supabaseUrl ? extractProjectRef(supabaseUrl) : undefined;
  if (projectRef === PRODUCTION_PROJECT_REF) {
    throw new Error(
      "REFUSING TO RUN: TEST_SUPABASE_URL resolves to the production project " +
      `(${PRODUCTION_PROJECT_REF}). Integration tests must target an isolated ` +
      "Supabase branch or dedicated test project, never production. Fix " +
      ".env.test.local / the CI secret before rerunning.",
    );
  }

  if (allowFlag !== "true") {
    return { ready: false, skipReason: "ALLOW_INTEGRATION_TESTS is not set to 'true'" };
  }
  if (!supabaseUrl || !serviceKey) {
    return { ready: false, skipReason: "TEST_SUPABASE_URL / TEST_SUPABASE_SERVICE_ROLE_KEY not set (check .env.test.local)" };
  }
  if (!projectRef) {
    throw new Error(`TEST_SUPABASE_URL is not a recognizable Supabase project URL: ${supabaseUrl}`);
  }

  return { ready: true, supabaseUrl, serviceKey, projectRef };
}
