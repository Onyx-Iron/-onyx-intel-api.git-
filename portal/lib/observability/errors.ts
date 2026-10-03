/**
 * Minimal error-tracking facade.
 * When SENTRY_DSN (or NEXT_PUBLIC_SENTRY_DSN) is set, posts a lightweight
 * event payload; otherwise logs to console. Never throws.
 */

export function captureException(
  err: unknown,
  context?: Record<string, unknown>,
): void {
  const message = err instanceof Error ? err.message : String(err);
  const stack = err instanceof Error ? err.stack : undefined;
  console.error("[onyx.error]", message, context ?? {}, stack ?? "");

  const dsn = process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN;
  if (!dsn) return;

  // Best-effort: do not block request path on telemetry.
  void fetch("https://sentry.io/api/0/envelope/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message,
      stack,
      context,
      service: "onyx-portal",
      dsn_configured: true,
    }),
  }).catch(() => { /* ignore */ });
}

export function captureMessage(
  message: string,
  context?: Record<string, unknown>,
): void {
  console.warn("[onyx.message]", message, context ?? {});
}
