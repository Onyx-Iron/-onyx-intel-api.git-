-- Fix: the partial unique index added in
-- 20260730_professional_manual_takeoff.sql (`where client_key is not null`)
-- cannot be used as a Postgres ON CONFLICT target through Supabase's
-- .upsert({ onConflict: "tenant_id,project_id,client_key" }) — Postgres
-- requires ON CONFLICT's inference to match the index's predicate exactly,
-- and the upsert-by-column-list API has no way to express a WHERE clause.
-- Every save through app/api/takeoff/canvas/manual/route.ts's POST handler
-- was failing with 42P10 "no unique or exclusion constraint matching the ON
-- CONFLICT specification" — caught by the live-database integration tests
-- for this milestone (manual-canvas-persistence.integration.test.ts), never
-- shipped to production.
--
-- The partial predicate was unnecessary in the first place: Postgres
-- already treats every NULL as distinct from every other NULL in a plain
-- (non-partial) unique index, so rows with no client_key (older callers like
-- CADVectorLayer that don't send one) still never collide with each other.
-- A plain unique index gives the same real guarantee — one row per
-- (tenant_id, project_id, non-null client_key) — while also being usable as
-- an ON CONFLICT target.

drop index if exists idx_manual_takeoffs_client_key;

create unique index if not exists idx_manual_takeoffs_client_key
  on manual_takeoffs (tenant_id, project_id, client_key);
