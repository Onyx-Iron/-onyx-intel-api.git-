# Transaction Design

## Chosen design: transaction + outbox (Step 8's "acceptable alternative")

Not a pure single-RPC-does-everything design, because `syncTakeoffToEstimate` (`lib/estimating/auto-sync.ts`) depends on cost-resolution logic (`lib/cost/resolver.ts`, regional pricing, cost catalogs) that is not reasonably re-implementable in plpgsql without duplicating and drifting from the TypeScript logic. Folding it into the DB transaction would mean either duplicating that logic in SQL or losing it — both worse than the outbox pattern.

## What IS atomic (one Postgres transaction, one function call)

`save_manual_takeoff_tx(...)`:
1. Upsert `manual_takeoffs` (by `tenant_id, project_id, client_key`).
2. Insert `manual_takeoff_history` (created/updated, with before/after).
3. Upsert the mirrored `takeoff_items` row (by `source_manual_takeoff_id`).
4. Insert `takeoff_item_history`.
5. Insert/refresh a **pending** `estimate_sync_outbox` row.

Any exception at any step rolls back all five — proven live (`calibration-and-atomic-writes.integration.test.ts`, "Transaction correctness" suite: a forced invalid-`takeoff_type` failure leaves zero rows in every one of these tables).

`soft_delete_manual_takeoff_tx(...)` is the same guarantee for delete: soft-delete + its history + hard-delete of the mirror + mirror history + a pending `delete` outbox row, all-or-nothing.

## What is NOT atomic with the above (by design)

`syncTakeoffToEstimate` itself runs **after** the RPC commits, in the calling route (`app/api/takeoff/canvas/manual/route.ts`). On success, the route marks the outbox row `processed`; on failure, it's marked `failed` with the error recorded, but **the business write (steps 1–5 above) has already durably committed** — nothing is lost, only the estimate hasn't caught up yet.

**We do not claim atomic estimate synchronization.** The durable, idempotent outbox row is what makes this recoverable rather than silently dropped — `syncTakeoffToEstimate` itself is already idempotent (proven in the earlier takeoff-integrity milestone), so re-running it is always safe.

## Known gap: no scheduled outbox re-driver

A `failed` or stuck `pending` outbox row is not automatically retried today — the only "retry" is a subsequent save of the same object (which upserts a fresh pending row via the dedup index). There is no cron/worker that sweeps stale pending rows. See `REMAINING_RISKS.md`.

## Idempotency details

- `client_key` uniqueness is `(tenant_id, project_id, client_key)` — a plain (non-partial) unique index, since Postgres already treats every NULL as distinct, which is what lets rows without a `client_key` (legacy callers) coexist without needing a partial-index predicate. (A partial index was tried first and failed — see `20260731_manual_takeoffs_client_key_index_fix.sql`; Postgres cannot use a partial index as an `ON CONFLICT` target through Supabase-js's column-list `.upsert()` API. The RPC itself uses raw SQL `ON CONFLICT ... WHERE ...`, which Postgres *does* support directly — used for the `takeoff_items`/`estimate_sync_outbox` partial-index conflicts inside the function body.)
- `save_manual_takeoff_tx` requires a non-null `p_client_key` — the calling route generates a random UUID for callers that don't supply one (e.g. `CADVectorLayer`), so every save is atomic even when dedup isn't the caller's intent.
- Update-history events are only distinguishable as `created` vs `updated` by whether a pre-upsert row existed for that `client_key` — there is a narrow, benign race (two concurrent first-time saves of the same new `client_key`) where both could see "no existing row" and both report `created`; the underlying `manual_takeoffs` row itself is never duplicated (proven via the concurrent-save test), only the history label could misclassify in that rare race.
