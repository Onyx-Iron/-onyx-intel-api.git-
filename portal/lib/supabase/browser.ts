"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "./types";

let client: ReturnType<typeof createBrowserClient<Database>> | null = null;

/**
 * Browser Supabase client (anon key) for Realtime broadcast/presence.
 * Server-side data mutations continue to go through Next API routes +
 * createServiceClient — this client is intentionally limited to live collab.
 */
export function createBrowserSupabaseClient() {
  if (client) return client;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY for Realtime",
    );
  }

  client = createBrowserClient<Database>(url, anonKey);
  return client;
}
