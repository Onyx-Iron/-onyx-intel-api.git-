import { createBrowserClient } from "@supabase/ssr";
import { requireEnvOneOf, requireEnv } from "@/lib/env";
import type { Database } from "./types";

export function createClient() {
  return createBrowserClient<Database>(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireEnvOneOf(["NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "NEXT_PUBLIC_SUPABASE_ANON_KEY"]),
  );
}
