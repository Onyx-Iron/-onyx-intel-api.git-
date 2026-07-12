# Fix Design — Takeoff Integrity Hardening (Milestone 1.2)

## Strategy chosen: preserve decided rows, replace only undecided rows, atomically

This is the "Preferred" strategy from the milestone brief, not the
delete-with-explicit-relink fallback — because `approved` items are never
purged in the first place, there is no dependent `estimate_items` row to
relink.

## Component 1 — atomic replacement (`apply_vision_extraction_takeoff_items`)

A single `plpgsql` function, called once per re-extraction via
`db.rpc(...)`, replacing the route's prior two-call sequence:

1. Snapshot the content keys (`description|quantity|unit`, lower-cased,
   quantity rounded to 4 decimals) of every `approved`/`rejected` row for the
   page — these are never touched.
2. Delete only `suggested`/`reviewed` rows for the page, logging each as a
   `deleted` row in `takeoff_item_history` before moving on (history-first,
   inside the same transaction).
3. For each freshly extracted finding, compute the same content key; skip it
   if it matches a decided key (already handled — don't resurrect a
   rejected/approved finding as a new suggested row); otherwise insert it as
   `suggested`, guarded by `ON CONFLICT ... DO NOTHING` against a new partial
   unique index (Milestone 1.2 addition — see below) so a concurrent second
   call can't duplicate it.
4. Return the page's current row set.

The whole function body executes as one Postgres transaction (a `plpgsql`
function call is implicitly atomic unless it opens an explicit
subtransaction/exception block, which this one does not) — any error
anywhere in the loop (e.g. a malformed `quantity` failing the `::numeric`
cast) rolls back every delete, insert, and history write from that call.
Verified by the new test `a mid-operation failure rolls back the entire
re-extraction (atomicity)`.

## Component 2 — concurrency/idempotency hardening (new this milestone)

The Milestone 1 version of the function was atomic *per call* but not safe
against **two concurrent calls** for the same page (e.g. a double-clicked
refresh button, or a client retry after a timeout whose first request
actually succeeded). Both calls could pass the "not already decided" check
before either committed its insert, producing two `suggested` rows for the
same finding.

Fix: a partial unique index —

```sql
create unique index idx_takeoff_items_undecided_page_item_key
  on takeoff_items (tenant_id, document_id, (meta->>'vision_page_id'), (meta->>'item_key'))
  where review_status in ('suggested', 'reviewed');
```

— plus `ON CONFLICT (...) WHERE review_status IN ('suggested','reviewed') DO
NOTHING` on the insert. A second concurrent call for the same undecided
finding now becomes a no-op (`FOUND` is false, so its history-write is
skipped too — no duplicate "created" history entries either). Verified by
the new test `concurrent re-extraction calls for the same page do not
duplicate the same finding`, which fires two real overlapping `Promise.all`
RPC calls against the live database.

Note: the index is scoped to `suggested`/`reviewed` only (a partial index),
so it does not constrain `approved`/`rejected` rows — an approved item and a
rejected item can still coexist with the same content key if a human
approved one occurrence and rejected a re-extracted duplicate; that is a
correctness matter for the review workflow itself, not something this
migration should silently prevent.

## Component 3 — stable item identity end-to-end (Defect 2)

- `lib/takeoff/item-key.ts` exports `computeItemKey(description, quantity,
  unit)`, used identically by the SQL function (inlined, since Postgres
  functions can't import a TS module) and by the client.
- `fetchVisionTakeoffItems` (`app/api/takeoff/canvas/vision-extract/route.ts`)
  returns `Record<item_key, TakeoffItemRef>` instead of an array — every
  finding's `takeoffRef` lookup in `VisionExtractionsPanel.tsx` is by content
  key, not position. This directly satisfies "every displayed finding must
  carry its exact `takeoff_item_id`": the `enriched` memo attaches
  `takeoffRef` (which contains `id`, `review_status`, `rejected_reason`) to
  each finding before render, and `review()` acts on `it.takeoffRef.id`.

## Component 4 — everything else on the high-priority hardening list

Already implemented in the Milestone 1 validation-fix pass and unchanged
here (re-verified as still correct during this milestone's adversarial
review — see `ACCEPTANCE_RESULTS.md`):

- Batched history inserts (`recordTakeoffHistoryBatch`,
  `lib/takeoff/history.ts`).
- GIN index on `takeoff_items.meta`
  (`idx_takeoff_items_meta_gin`).
- User-visible Approve/Reject failure banner (`actionError` state in
  `VisionExtractionsPanel.tsx`).
- Stale comment removal in the vision-extract route.
- Documented (not FK'd) `takeoff_item_history.takeoff_item_id` — see the
  column comment added in
  `supabase/migrations/20260724_takeoff_vision_extract_atomic_apply.sql`.
