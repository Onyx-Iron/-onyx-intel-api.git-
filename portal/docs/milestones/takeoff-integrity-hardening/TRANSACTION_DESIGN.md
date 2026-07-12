# Transaction Design — `apply_vision_extraction_takeoff_items`

## Why a Postgres function instead of a Supabase multi-statement transaction

The `@supabase/supabase-js` client (PostgREST underneath) does not expose a
client-side multi-statement transaction primitive — each `.from(...)` call is
its own request/transaction. The only way to guarantee atomicity across
"read decided keys → delete undecided rows → log history → insert new rows"
is to push all of it into a single database-side call: a `plpgsql` function
invoked once via `.rpc(...)`.

## Atomicity guarantee

A PL/pgSQL function body runs inside the transaction of its calling
statement. Since `db.rpc(...)` issues one `SELECT
apply_vision_extraction_takeoff_items(...)` statement, everything inside the
function — the decided-key snapshot, every delete, every history insert,
every new-row insert — commits or rolls back together. There is no explicit
`BEGIN`/`COMMIT` inside the function (Postgres provides this for free at the
statement level); the function does not use `EXCEPTION` blocks, so any error
anywhere inside it (a bad cast, a constraint violation) aborts the whole
transaction rather than being caught and partially applied.

Verified live in this milestone: passing a non-numeric `quantity` to force a
`::numeric` cast failure mid-loop, then confirming the row that should have
been purged earlier in the same call still exists unchanged (test: `a
mid-operation failure rolls back the entire re-extraction (atomicity)`).

## Idempotency guarantee (new this milestone)

Atomicity alone doesn't prevent a second, *separate*, fully-successful call
from duplicating work — e.g. two concurrent calls for the same page, both
of which individually succeed and commit. That's a concurrency problem, not
an atomicity problem, and is solved differently:

```sql
create unique index idx_takeoff_items_undecided_page_item_key
  on takeoff_items (tenant_id, document_id, (meta->>'vision_page_id'), (meta->>'item_key'))
  where review_status in ('suggested', 'reviewed');
```

Both concurrent transactions may pass the "not already decided" check
(neither has committed yet, so neither sees the other's in-flight insert),
but only one of their `INSERT ... ON CONFLICT (...) DO NOTHING` statements
can win the unique index at commit time — Postgres serializes the conflicting
inserts at the index level. The loser's `INSERT` becomes a no-op (`FOUND` =
false), so it also skips writing a duplicate `takeoff_item_history` "created"
row for that finding.

Verified live in this milestone with two genuinely concurrent `Promise.all`
RPC calls against the same page/finding (test: `concurrent re-extraction
calls for the same page do not duplicate the same finding`) — exactly one row
exists afterward.

## What is intentionally NOT covered

- **Cross-page concurrency** is not a concern — every operation is scoped by
  `(tenant_id, document_id, vision_page_id)`, so concurrent re-extractions of
  *different* pages never contend with each other.
- **Approved/rejected rows are never subject to the unique index** (it's a
  partial index, `WHERE review_status IN ('suggested','reviewed')`) — an
  approved row and a later re-extracted "reviewed" row with the same content
  key can coexist momentarily until the reviewed one is either purged (next
  re-extraction) or itself decided. This is correct: the function's own
  decided-key check already skips inserting a new suggested row when an
  approved/rejected one with that key exists.
- The function is `security invoker`, not `security definer` — it runs with
  the calling role's privileges (the service-role client the app already
  uses everywhere), consistent with the rest of the schema's existing
  RLS-bypass-by-design posture (documented repeatedly elsewhere in this
  engagement's audits; not something this migration changes or should
  change).
