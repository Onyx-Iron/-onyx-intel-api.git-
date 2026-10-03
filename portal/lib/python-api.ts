/**
 * Onyx Intel — Python (Railway) API client helpers
 *
 * Centralizes the headers sent to the Railway takeoff service so that:
 *   - the admin account (justinatteberry@onyx-iron.com) always uses the
 *     RATE_LIMIT_ADMIN_SECRET, which auths AND bypasses per-tenant rate
 *     limits on the Python side.
 *   - every other user uses the plain ONYX_API_SECRET, which auths
 *     but is still rate-limited normally.
 *
 * The admin secret never crosses the network to the browser — this is
 * all server-side (Next.js Route Handlers).
 */

import { headerSafe, withCompressionHeaders } from "@/lib/http";

const ADMIN_EMAIL = "justinatteberry@onyx-iron.com";

export function isAdminEmail(email: string | null | undefined): boolean {
  return !!email && email.trim().toLowerCase() === ADMIN_EMAIL;
}

/**
 * Returns the value to send as `X-Onyx-Secret` when calling the Railway
 * Python API. Admin user gets the rate-limit-bypass secret; everyone
 * else gets the regular API secret.
 */
export function pythonApiSecret(email: string | null | undefined): string {
  if (isAdminEmail(email)) {
    const adminSecret = process.env.RATE_LIMIT_ADMIN_SECRET || "";
    if (adminSecret) return adminSecret;
  }
  return process.env.ONYX_API_SECRET || "";
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
  const headers = withCompressionHeaders({
    "X-Onyx-Secret": headerSafe(pythonApiSecret(opts.email)),
  });
  if (opts.tenantId) headers["X-Onyx-Tenant"] = headerSafe(opts.tenantId);
  if (opts.projectId) headers["X-Onyx-Project"] = headerSafe(opts.projectId);
  if (opts.extra) Object.assign(headers, opts.extra);
  return headers;
}
