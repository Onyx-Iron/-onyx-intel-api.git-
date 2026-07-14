-- Recovers two migrations applied directly to production earlier in this
-- engagement (recorded in production's applied-migration ledger as
-- 20260713214831_revoke_public_execute_on_manual_takeoff_rpcs and
-- 20260713214919_estimating_tables_service_role_policies) but never
-- committed to this repo as tracked files — the same "applied but
-- untracked" gap this whole schema-baseline effort exists to close.
-- Discovered by the branch's security advisor reporting these RPCs as
-- anon/authenticated-executable and these 5 tables as missing RLS policies,
-- when production has neither exposure. Verified directly against
-- production before writing this file (has_function_privilege /
-- pg_policies), not reconstructed from memory alone.

-- ── Revoke EXECUTE from public/anon/authenticated on the manual-takeoff and
--    outbox-worker RPCs — these are only ever called from the service-role
--    backend (API routes, the outbox worker), never from client code using
--    the anon/authenticated key.
REVOKE EXECUTE ON FUNCTION public.save_manual_takeoff_tx(uuid, uuid, uuid, uuid, text, text, numeric, text, jsonb, text, text, text, boolean, text) FROM public, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.update_manual_takeoff_tx(uuid, uuid, integer, jsonb, numeric, text, text, text, text) FROM public, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.soft_delete_manual_takeoff_tx(uuid, uuid, text) FROM public, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.claim_outbox_events(integer, text, integer) FROM public, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.complete_outbox_event(uuid) FROM public, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fail_outbox_event(uuid, text, integer) FROM public, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.retry_outbox_event(uuid, uuid) FROM public, anon, authenticated;

-- ── estimate_versions/estimate_proposals/estimate_sov/estimate_audit_log/
--    estimates: service-role-only RLS (these carry pricing/financial data
--    and every read/write already goes through the service-role backend —
--    no anon/authenticated access path is legitimate).
DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['estimates', 'estimate_versions', 'estimate_proposals', 'estimate_sov', 'estimate_audit_log']
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', tbl);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', tbl);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', tbl || '_service_role_only', tbl);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL USING (auth.role() = ''service_role'') WITH CHECK (auth.role() = ''service_role'')',
      tbl || '_service_role_only', tbl
    );
  END LOOP;
END $$;
