# Outbox Worker

## Schema additions (`estimate_sync_outbox`)
`claimed_at`, `claimed_by`, `next_attempt_at`; status enum extended to `pending | processing | processed | failed | dead_letter`. Dedup index changed from "one pending row per (manual_takeoff_id, event_type)" to "one **active** (pending OR processing) row" — a row being worked must still block a duplicate competing event.

## RPCs (`20260810_productivity_row_version_and_outbox_worker.sql`)
- `claim_outbox_events(limit, worker_id, visibility_timeout_seconds=120)` — atomically claims up to `limit` events via `FOR UPDATE SKIP LOCKED` (two concurrent callers never claim the same row) and also reclaims `processing` rows whose claim is older than the visibility timeout (a crashed/timed-out worker never leaves a row stuck forever).
- `complete_outbox_event(id)` — marks `processed`.
- `fail_outbox_event(id, error, max_attempts=5)` — increments `attempts`; exponential backoff (`30s, 60s, 120s, 240s`, capped at 1h) until `max_attempts`, then `dead_letter` (terminal, never auto-retried again).
- `retry_outbox_event(id, tenant_id)` — tenant-scoped manual reset back to `pending` (used by the user-facing retry route).

## TypeScript processing layer (`lib/estimating/outbox-worker.ts`)
`processOutboxBatch(db, workerId, batchSize|options)`:
- `'upsert'` events → `syncTakeoffToEstimate` (already idempotent from the prior milestone).
- `'delete'` events → `reconcileDeletedTakeoffEstimateItems`: removes an already-synced `estimate_items` row from a still-**draft/review** version; leaves it completely untouched if the version is approved/superseded/void (immutability — enforced additionally at the DB level by `prevent_locked_estimate_item_write`).
- Accepts an optional `syncFn` override so integration tests can inject a reproduction of `syncTakeoffToEstimate`'s logic bound to a bare test client — `syncTakeoffToEstimate` itself depends on `next/headers` `cookies()` and cannot run outside a real Next.js request (same constraint as this codebase's other integration tests).

## Invocation (no new queue system — STEP 14's explicit instruction)
1. **Opportunistic, in-process**: `app/api/takeoff/canvas/manual/route.ts`'s POST/DELETE/PATCH each call `processOutboxBatch` right after their own atomic write commits — this is what makes retry actually happen today, without any external scheduler.
2. **Server-to-server trigger**: `POST /api/internal/outbox/process` (shared-secret auth via `INTERNAL_WORKER_SECRET`, not Clerk). `GET` on the same path is the Vercel Cron sweep in `portal/vercel.json` (every 5 minutes). Vercel sends `Authorization: Bearer <CRON_SECRET>` only when `CRON_SECRET` is set on the Vercel project; until then the sweep returns 401. Clerk does not gate this path. No Vault secret and no new migration.
3. **User-facing manual retry**: `POST /api/internal/outbox/retry { id }` (Clerk-authenticated, tenant-scoped) for a `dead_letter` event — STEP 15's "retry failed sync where authorized."

## Known limitation
The 5-minute sweep only drains the queue after `CRON_SECRET` is set on the Vercel project. Until then, a `pending`/`failed` event that never gets touched again by (1) still waits. See `REMAINING_RISKS.md`.
