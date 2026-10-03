import { timingSafeEqual } from "node:crypto";

export type OutboxAuth =
  | { ok: true }
  | { ok: false; status: 401 | 500; error: string };

function matchesSecret(expected: string | undefined, provided: string | null): boolean {
  if (!expected || !provided) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(provided);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** POST callers present x-worker-secret. A missing server secret is a misconfiguration. */
export function authorizeOutboxPost(headers: Headers): OutboxAuth {
  const secret = process.env.INTERNAL_WORKER_SECRET;
  if (!secret) {
    return { ok: false, status: 500, error: "INTERNAL_WORKER_SECRET is not configured" };
  }
  if (!matchesSecret(secret, headers.get("x-worker-secret"))) {
    return { ok: false, status: 401, error: "Unauthorized" };
  }
  return { ok: true };
}

/**
 * Vercel Cron calls GET and, when CRON_SECRET is set on the project, sends
 * `Authorization: Bearer <CRON_SECRET>`. The worker header is accepted so an
 * existing caller can drain the queue. Neither match fails closed.
 */
export function authorizeOutboxCron(headers: Headers): OutboxAuth {
  const cronSecret = process.env.CRON_SECRET;
  if (matchesSecret(cronSecret ? `Bearer ${cronSecret}` : undefined, headers.get("authorization"))) {
    return { ok: true };
  }
  if (matchesSecret(process.env.INTERNAL_WORKER_SECRET, headers.get("x-worker-secret"))) {
    return { ok: true };
  }
  return { ok: false, status: 401, error: "Unauthorized" };
}
