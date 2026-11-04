-- Sheet claim RPCs created in 20261003000003 are SECURITY DEFINER and
-- update every tenant's sheets / documents. That migration revoked EXECUTE
-- from PUBLIC only. Supabase default privileges also grant EXECUTE to
-- anon and authenticated, so the browser anon key could still call them
-- through PostgREST.
--
-- Concrete trigger: POST /rest/v1/rpc/claim_unparsed_sheets or
-- fail_sheet_processing with the public anon key. claim_unparsed_sheets
-- has no tenant filter, so one call marks every uncalibrated sheet
-- processing; fail_sheet_processing then sticks those rows in 'error',
-- which the claim query never retries.
--
-- Same lockdown as claim_outbox_events / enqueue_project_estimate_sync:
-- service_role only (the Vercel cron uses the service client).

revoke all on function public.claim_unparsed_sheets(integer, text, integer) from public, anon, authenticated;
revoke all on function public.complete_sheet_processing(uuid) from public, anon, authenticated;
revoke all on function public.fail_sheet_processing(uuid, text) from public, anon, authenticated;
revoke all on function public.refresh_sheet_index_status(text) from public, anon, authenticated;

grant execute on function public.claim_unparsed_sheets(integer, text, integer) to service_role;
grant execute on function public.complete_sheet_processing(uuid) to service_role;
grant execute on function public.fail_sheet_processing(uuid, text) to service_role;
grant execute on function public.refresh_sheet_index_status(text) to service_role;
