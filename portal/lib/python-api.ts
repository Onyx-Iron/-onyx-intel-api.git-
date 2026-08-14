/**
 * Onyx Intel — Python (Railway) API client helpers
 *
 * Centralizes the headers sent to the Railway takeoff service so that:
 *   - every server-side request uses the canonical ONYX_API_SECRET.
 *   - user identity never changes transport authentication credentials.
 *
 * The admin secret never crosses the network to the browser — this is
 * all server-side (Next.js Route Handlers).
 */

import { headerSafe } from "@/lib/http";

const ADMIN_EMAIL = "justinatteberry@onyx-iron.com";

export function isAdminEmail(email: string | null | undefined): boolean {
  return !!email && email.trim().toLowerCase() === ADMIN_EMAIL;
}

/**
 * Returns the value to send as `X-Onyx-Secret` when calling the Railway
 * Python API. The email argument is retained for API compatibility, but must
 * never select a different transport credential: doing so lets an unrelated
 * rate-limit secret break uploads for one account only.
 */
export function pythonApiSecret(email: string | null | undefined): string {
  void email;
  const secret = process.env.ONYX_API_SECRET;
  if (!secret || secret.trim() === "") {
    throw new Error("Missing required environment variable: ONYX_API_SECRET");
  }
  return secret;
}

/**
 * Convenience: build the full outbound header set for a Python API call.
 * Callers can spread the result directly into a fetch `headers` object.
 */
export function pythonApiHeaders(opts: {
  email?: string | null;
  tenantId?: string | null;
  projectId?: string | null;
  extra?: Record<string, string>;
}): Record<string, string> {
  const headers: Record<string, string> = {
    "X-Onyx-Secret": headerSafe(pythonApiSecret(opts.email)),
  };
  if (opts.tenantId) headers["X-Onyx-Tenant"] = headerSafe(opts.tenantId);
  if (opts.projectId) headers["X-Onyx-Project"] = headerSafe(opts.projectId);
  if (opts.extra) Object.assign(headers, opts.extra);
  return headers;
}
