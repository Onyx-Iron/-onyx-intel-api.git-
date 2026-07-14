-- Recovers a third wave of untracked production state: a set of single
-- "ALL command" RLS policies (naming pattern `tenant_isolation_<table>` or
-- `<table>_service_role_only`) that exist in production on tables whose
-- tracked migrations (or the schema baseline) never created any policy for
-- them at all. Distinct from the four-way select/insert/update/delete
-- policies added by 20260706_rls_tenant_isolation.sql /
-- 20260714_backfill_rls_policies.sql — this is a second, separately-applied
-- policy set, confirmed via direct production introspection
-- (pg_policies), not reconstructed from memory.
--
-- Discovered by replaying the full corrected migration history on the
-- isolated test branch and finding these tables reported as "RLS enabled,
-- no policies" by the security advisor, while production's own advisor
-- shows no such gap for them.

DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'chunks', 'contacts', 'conversations', 'cost_catalog', 'daily_logs',
    'document_intelligence', 'estimate_items', 'generated_documents',
    'google_connections', 'memories', 'messages', 'pages', 'permit_items',
    'procurement_items', 'project_notes', 'projects', 'punch_list_items',
    'schedule_tasks', 'takeoff_items'
  ]
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'tenant_isolation_' || tbl, tbl);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL USING (tenant_id IN (SELECT tenants.id FROM public.tenants WHERE tenants.clerk_org_id = current_setting(''app.clerk_org_id'', true)))',
      'tenant_isolation_' || tbl, tbl
    );
  END LOOP;
END $$;

-- contacts and project_notes each additionally carry a second,
-- identically-scoped policy under a shorter name in production
-- ("tenant_isolation") -- both harmless duplicates of the one above, kept
-- for exact parity since dropping either isn't part of this reconciliation.
DROP POLICY IF EXISTS tenant_isolation ON public.contacts;
CREATE POLICY tenant_isolation ON public.contacts FOR ALL
  USING (tenant_id IN (SELECT tenants.id FROM public.tenants WHERE tenants.clerk_org_id = current_setting('app.clerk_org_id', true)));

DROP POLICY IF EXISTS tenant_isolation ON public.project_notes;
CREATE POLICY tenant_isolation ON public.project_notes FOR ALL
  USING (tenant_id IN (SELECT tenants.id FROM public.tenants WHERE tenants.clerk_org_id = current_setting('app.clerk_org_id', true)));

-- document_processing_events, sheet_corrections, sheets: service-role-only
-- (no tenant-scoped read path — these are worker/pipeline-internal tables).
DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['document_processing_events', 'sheet_corrections', 'sheets']
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', tbl || '_service_role_only', tbl);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL USING (auth.role() = ''service_role'') WITH CHECK (auth.role() = ''service_role'')',
      tbl || '_service_role_only', tbl
    );
  END LOOP;
END $$;
