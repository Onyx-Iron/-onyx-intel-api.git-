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
const LOCAL_PYTHON_FALLBACK = "http://127.0.0.1:5050";

export function isAdminEmail(email: string | null | undefined): boolean {
  return !!email && email.trim().toLowerCase() === ADMIN_EMAIL;
}

/** True when this process is a real Vercel production deploy (not preview/dev). */
export function isProductionRuntime(): boolean {
  return process.env.VERCEL_ENV === "production" ||
    (process.env.NODE_ENV === "production" && process.env.VERCEL === "1" && process.env.VERCEL_ENV !== "preview");
}

/**
 * Railway takeoff base URL. Local/dev may fall back to loopback; production
 * must set PYTHON_API_URL (silent localhost in prod was a real failure mode).
 */
export function pythonApiBaseUrl(): string {
  const configured = headerSafe(process.env.PYTHON_API_URL).replace(/\/$/, "");
  if (configured) return configured;
  if (isProductionRuntime()) {
    throw new Error("PYTHON_API_URL is required in production");
  }
  return LOCAL_PYTHON_FALLBACK;
}

/**
 * Returns the value to send as `X-Onyx-Secret` when calling the Railway
 * Python API. Admin user gets the rate-limit-bypass secret; everyone
 * else gets the regular API secret. Production refuses an empty secret.
 */
export function pythonApiSecret(email: string | null | undefined): string {
  if (isAdminEmail(email)) {
    const adminSecret = process.env.RATE_LIMIT_ADMIN_SECRET || "";
    if (adminSecret) return adminSecret;
  }
  const secret = process.env.ONYX_API_SECRET || "";
  if (!secret && isProductionRuntime()) {
    throw new Error("ONYX_API_SECRET is required in production");
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
  const headers = withCompressionHeaders({
    "X-Onyx-Secret": headerSafe(pythonApiSecret(opts.email)),
  });
  if (opts.tenantId) headers["X-Onyx-Tenant"] = headerSafe(opts.tenantId);
  if (opts.projectId) headers["X-Onyx-Project"] = headerSafe(opts.projectId);
  if (opts.extra) Object.assign(headers, opts.extra);
  return headers;
}
