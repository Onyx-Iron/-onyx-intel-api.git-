/**
 * Canonical public origin for Clerk redirects and absolute links.
 *
 * Prefer NEXT_PUBLIC_APP_URL. On Vercel previews, fall back to the deployment
 * host so auth does not bounce users to production. Only hard-code production
 * when VERCEL_ENV is production (or when nothing else is available locally).
 */
export function getAppOrigin(): string {
  const explicit = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (explicit) return explicit.replace(/\/$/, "");

  if (process.env.VERCEL_ENV === "production") {
    return "https://app.onyx-iron.com";
  }

  const vercel = process.env.VERCEL_URL?.trim();
  if (vercel) {
    return vercel.startsWith("http") ? vercel.replace(/\/$/, "") : `https://${vercel.replace(/\/$/, "")}`;
  }

  return "http://localhost:3000";
}
