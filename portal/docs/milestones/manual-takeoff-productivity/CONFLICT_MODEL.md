# Conflict Model (Optimistic Concurrency)

## Schema
`manual_takeoffs.row_version integer not null default 1`.

## Write path
`PATCH /api/takeoff/canvas/manual { id, row_version, quantity, unit?, cost_code?, geometry }` → `update_manual_takeoff_tx(p_id, p_tenant_id, p_expected_row_version, ...)`:

1. Load the row by `id + tenant_id`.
2. If `deleted_at` is set → reject (409, message contains "soft-deleted") — you cannot edit a deleted object; restore first.
3. If `row_version != p_expected_row_version` → **structured conflict**, nothing applied: `returns (conflict: true, manual_takeoff: <current row>, mirror_takeoff_item_id)`.
4. Otherwise: `UPDATE ... WHERE id = ? AND row_version = ?` (a second belt-and-suspenders check against a race between the SELECT and UPDATE) → increments `row_version`, writes history, updates the mirror + its history, refreshes the outbox event.

Route translates a `conflict: true` RPC result into `HTTP 409 { conflict: true, server_state }`.

## Client handling (minimum required pair — STEP 2)
On `409`:
- **Reload server version** — `window.confirm` OK replaces local `points`/`quantity`/`row_version` with `server_state`, discarding the local drag.
- **Discard local change** — Cancel leaves the local (unpersisted) position in place; the object stays visually where the user left it but is NOT saved — the next drag or edit attempt will PATCH again with the same stale `row_version` and either succeed (if nothing else changed since) or conflict again.

**Not built this pass** (explicit deferral, not an oversight): "save local geometry as a new object" and "retry after review" as separate first-class actions, and any non-blocking (non-`window.confirm`) conflict UI. See `REMAINING_RISKS.md`.

## What this deliberately does NOT do
Real-time collaborative editing (OT/CRDT, live cursors, presence) — explicitly out of scope per the milestone brief. Optimistic concurrency here only prevents a **silent** last-write-wins; it does not merge concurrent edits.
