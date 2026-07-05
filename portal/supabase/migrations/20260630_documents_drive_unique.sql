-- 2026-06-30 — Race-proof idempotency for Drive-backed document registration.
--
-- Background: /api/documents/register-drive currently does a check-then-insert
-- (SELECT by drive_file_id → if not found, INSERT) which can race when the
-- browser retries a flaky upload. Two near-simultaneous requests both see
-- "not found" and both insert, producing duplicate document rows for the
-- same Drive file.
--
-- This partial unique index makes the duplicate impossible at the DB level.
-- Scoped per (tenant_id, project_id, drive_file_id) so different tenants /
-- projects re-uploading the same drive_file_id is still allowed (rare but
-- legitimate if a user imports the same file into two projects).
--
-- Applied via Supabase Management API DDL — see lib/supabase deploy notes.

CREATE UNIQUE INDEX IF NOT EXISTS documents_tenant_project_drive_file_unique
  ON documents (tenant_id, project_id, drive_file_id)
  WHERE drive_file_id IS NOT NULL;

-- The register-drive route can now be simplified to a plain INSERT;
-- on conflict the duplicate is dropped without a SELECT round-trip.
-- The route should catch the unique-violation (Postgres error 23505) and
-- return the existing row instead.
