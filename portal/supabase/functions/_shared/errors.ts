/**
 * Minimal Edge error-tracking facade (mirrors portal/lib/observability/errors.ts).
 * Never throws; logs to console and optionally posts when SENTRY_DSN is set.
 */
export function captureException(
  err: unknown,
  context?: Record<string, unknown>,
): void {
  const message = err instanceof Error ? err.message : String(err);
  const stack = err instanceof Error ? err.stack : undefined;
  console.error("[onyx.edge.error]", message, context ?? {}, stack ?? "");

  const dsn = Deno.env.get("SENTRY_DSN");
  if (!dsn) return;

  void fetch("https://sentry.io/api/0/envelope/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message,
      stack,
      context,
      service: "onyx-edge",
      dsn_configured: true,
    }),
  }).catch(() => { /* ignore */ });
}
