# Root Cause Analysis — Takeoff Integrity Hardening (Milestone 1.2)

## Defect 1: vision re-extraction destroyed review decisions, non-atomically

**Where:** `app/api/takeoff/canvas/vision-extract/route.ts` (prior version, before the
Milestone 1 validation pass).

**Root cause:** the POST handler's "refresh" path (`force: true`) issued two
separate, unprotected Supabase calls from the API route itself:

1. `DELETE FROM takeoff_items WHERE tenant_id = ? AND meta->>'vision_page_id' = ?`
   — deleted **every** AI-vision row for the page, regardless of
   `review_status`. An `approved` item that had already been synced into
   `estimate_items`, or a `rejected` item an estimator had explicitly
   dismissed, was deleted exactly like an untouched `suggested` row.
2. A second `INSERT` of the freshly extracted items.

Because these were two independent network round trips with no transaction
wrapping them, a crash/timeout between steps could leave a page with **zero**
takeoff rows — not even the old ones — until the next successful re-run.

**Estimate-sync interaction:** `syncTakeoffToEstimate` /
`buildEstimateImportRows` (`lib/estimating/takeoff-import.ts:159`) only ever
import a takeoff row into `estimate_items` when `review_status === "approved"`.
Suggested/reviewed/rejected rows are excluded from every sync. This has a
direct consequence for orphaning: **a suggested or reviewed row can never
have a linked `estimate_items` row**, so purging only suggested/reviewed rows
(the fixed behavior) cannot orphan an estimate item by construction — this is
proven by the new test `no orphaned estimate_item remains after a
suggested/reviewed row is replaced`. `estimate_items.source_takeoff_id` also
carries `ON DELETE SET NULL` (`supabase/migrations/20260721_estimate_items_takeoff_audit_columns.sql:5`),
so even in a hypothetical future where an approved+synced row were deleted,
the FK degrades to a null reference rather than a dangling/broken one or a
constraint violation — a second layer of protection, not the primary one.

**Source-fingerprint / dedup:** the pre-fix code paired displayed vision
findings to `takeoff_items` rows by **array index** across two independently
ordered lists (see Defect 2) — there was no stable per-finding identity at
all, which is also why the old delete-all approach was originally taken:
without a stable key, there was no way to tell "this finding already exists
and was decided" from "this is a new finding."

## Defect 2: frontend paired findings to rows by array position

**Where:** `components/takeoff/canvas/VisionExtractionsPanel.tsx` (prior
version) and the vision-extract route's response shape.

**Root cause:** the route returned `takeoffItems` as a plain array (ordered
by whatever the DB query happened to return), and the panel zipped it against
`state.result.items` (ordered by whatever the Gemini vision call returned) by
index: `takeoffItems[i]`. These two arrays have no guaranteed correspondence
— a DB re-query can come back in a different order than the extraction
result, especially after any `ORDER BY created_at`-adjacent change, a partial
insert, or a retried request. Clicking "Approve" on displayed finding N could
silently call the review endpoint with a `takeoff_item_id` belonging to a
different finding.

## Fix summary (already implemented, Milestone 1 validation pass; this
milestone hardens the transaction/idempotency/authorization gaps found on
top of that fix)

- Replaced the two-call delete+insert with a single atomic Postgres function,
  `apply_vision_extraction_takeoff_items` (see `TRANSACTION_DESIGN.md`).
- Replaced array-index pairing with a stable content key
  (`description|quantity|unit`, `lib/takeoff/item-key.ts`), returned server-
  side as `Record<item_key, TakeoffItemRef>` and looked up by key on the
  client — every displayed finding now carries its exact `takeoff_item_id`.
- This milestone additionally closes two gaps the Milestone 1 fix didn't
  cover: **concurrent-call idempotency** (two overlapping re-extraction calls
  for the same page could each pass the "already decided" check before
  either committed, producing a duplicate `suggested` row) and **explicit
  authorization documentation** for cross-project approval scope.
