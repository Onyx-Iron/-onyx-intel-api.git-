-- Closes out the schema baseline (20260627000000_schema_baseline.sql): foreign
-- keys, phantom functions/triggers, and indexes for the 40 baseline tables.
-- Placed AFTER every other tracked migration (filename sorts last) because
-- several FKs target tables created by migrations that run between the
-- baseline and here (e.g. estimate_items -> estimate_versions/takeoff_items,
-- ai_agent_audit_trails -> document_pages). RLS policies for these tables
-- are NOT duplicated here — they already exist in earlier tracked migrations
-- (20260706_rls_tenant_isolation.sql, 20260706_rls_profiles_and_catalog.sql,
-- 20260714_backfill_rls_policies.sql, etc.) and apply correctly once the
-- baseline creates the underlying tables.
-- See docs/frontend-backend-reconciliation/SCHEMA_BASELINE.md.

-- ── Foreign keys ───────────────────────────────────────────────────────────
ALTER TABLE public.companies ADD CONSTRAINT companies_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;
ALTER TABLE public.roles ADD CONSTRAINT roles_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;
ALTER TABLE public.company_users ADD CONSTRAINT company_users_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;
ALTER TABLE public.company_users ADD CONSTRAINT company_users_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;
ALTER TABLE public.company_users ADD CONSTRAINT company_users_role_id_fkey FOREIGN KEY (role_id) REFERENCES public.roles(id) ON DELETE SET NULL;

ALTER TABLE public.projects ADD CONSTRAINT projects_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;

ALTER TABLE public.documents ADD CONSTRAINT documents_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;
ALTER TABLE public.documents ADD CONSTRAINT documents_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE SET NULL;

ALTER TABLE public.pages ADD CONSTRAINT pages_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;
ALTER TABLE public.pages ADD CONSTRAINT pages_document_id_fkey FOREIGN KEY (document_id) REFERENCES public.documents(id) ON DELETE CASCADE;

-- sheets references document_pages, created by a later tracked migration
-- (page_split_pipeline) — safe here since this file runs after it.
ALTER TABLE public.sheets ADD CONSTRAINT sheets_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;
ALTER TABLE public.sheets ADD CONSTRAINT sheets_document_id_fkey FOREIGN KEY (document_id) REFERENCES public.documents(id) ON DELETE CASCADE;
ALTER TABLE public.sheets ADD CONSTRAINT sheets_document_page_id_fkey FOREIGN KEY (document_page_id) REFERENCES public.document_pages(id) ON DELETE SET NULL;
ALTER TABLE public.sheets ADD CONSTRAINT sheets_supersedes_sheet_id_fkey FOREIGN KEY (supersedes_sheet_id) REFERENCES public.sheets(id);
ALTER TABLE public.sheets ADD CONSTRAINT sheets_superseded_by_sheet_id_fkey FOREIGN KEY (superseded_by_sheet_id) REFERENCES public.sheets(id);

ALTER TABLE public.sheet_corrections ADD CONSTRAINT sheet_corrections_sheet_id_fkey FOREIGN KEY (sheet_id) REFERENCES public.sheets(id) ON DELETE CASCADE;

ALTER TABLE public.chunks ADD CONSTRAINT chunks_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;
ALTER TABLE public.chunks ADD CONSTRAINT chunks_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;
ALTER TABLE public.chunks ADD CONSTRAINT chunks_document_id_fkey FOREIGN KEY (document_id) REFERENCES public.documents(id) ON DELETE CASCADE;

ALTER TABLE public.document_intelligence ADD CONSTRAINT document_intelligence_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;
ALTER TABLE public.document_intelligence ADD CONSTRAINT document_intelligence_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;
ALTER TABLE public.document_intelligence ADD CONSTRAINT document_intelligence_document_id_fkey FOREIGN KEY (document_id) REFERENCES public.documents(id) ON DELETE CASCADE;

ALTER TABLE public.document_processing_events ADD CONSTRAINT document_processing_events_document_id_fkey FOREIGN KEY (document_id) REFERENCES public.documents(id) ON DELETE CASCADE;
ALTER TABLE public.document_processing_events ADD CONSTRAINT document_processing_events_document_page_id_fkey FOREIGN KEY (document_page_id) REFERENCES public.document_pages(id) ON DELETE SET NULL;

ALTER TABLE public.memories ADD CONSTRAINT memories_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;
ALTER TABLE public.memories ADD CONSTRAINT memories_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;
ALTER TABLE public.memories ADD CONSTRAINT memories_source_document_id_fkey FOREIGN KEY (source_document_id) REFERENCES public.documents(id) ON DELETE SET NULL;

ALTER TABLE public.conversations ADD CONSTRAINT conversations_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;
ALTER TABLE public.conversations ADD CONSTRAINT conversations_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;

ALTER TABLE public.messages ADD CONSTRAINT messages_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;
ALTER TABLE public.messages ADD CONSTRAINT messages_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.conversations(id) ON DELETE CASCADE;

-- takeoff_items references document_pages and manual_takeoffs (both created
-- by later tracked migrations).
ALTER TABLE public.takeoff_items ADD CONSTRAINT takeoff_items_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;
ALTER TABLE public.takeoff_items ADD CONSTRAINT takeoff_items_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;
ALTER TABLE public.takeoff_items ADD CONSTRAINT takeoff_items_document_id_fkey FOREIGN KEY (document_id) REFERENCES public.documents(id) ON DELETE SET NULL;
ALTER TABLE public.takeoff_items ADD CONSTRAINT takeoff_items_sheet_id_fkey FOREIGN KEY (sheet_id) REFERENCES public.document_pages(id) ON DELETE SET NULL;
ALTER TABLE public.takeoff_items ADD CONSTRAINT takeoff_items_source_manual_takeoff_id_fkey FOREIGN KEY (source_manual_takeoff_id) REFERENCES public.manual_takeoffs(id);

-- estimate_items references estimate_versions (created later) and
-- takeoff_items (created in the baseline).
ALTER TABLE public.estimate_items ADD CONSTRAINT estimate_items_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;
ALTER TABLE public.estimate_items ADD CONSTRAINT estimate_items_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;
ALTER TABLE public.estimate_items ADD CONSTRAINT estimate_items_source_takeoff_id_fkey FOREIGN KEY (source_takeoff_id) REFERENCES public.takeoff_items(id) ON DELETE SET NULL;
ALTER TABLE public.estimate_items ADD CONSTRAINT estimate_items_estimate_version_id_fkey FOREIGN KEY (estimate_version_id) REFERENCES public.estimate_versions(id) ON DELETE CASCADE;

ALTER TABLE public.change_order_items ADD CONSTRAINT change_order_items_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;
ALTER TABLE public.change_order_items ADD CONSTRAINT change_order_items_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;

ALTER TABLE public.rfi_items ADD CONSTRAINT rfi_items_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;
ALTER TABLE public.rfi_items ADD CONSTRAINT rfi_items_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;

ALTER TABLE public.submittal_items ADD CONSTRAINT submittal_items_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;
ALTER TABLE public.submittal_items ADD CONSTRAINT submittal_items_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;

ALTER TABLE public.punch_list_items ADD CONSTRAINT punch_list_items_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;
ALTER TABLE public.punch_list_items ADD CONSTRAINT punch_list_items_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;

ALTER TABLE public.permit_items ADD CONSTRAINT permit_items_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;
ALTER TABLE public.permit_items ADD CONSTRAINT permit_items_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;

ALTER TABLE public.procurement_items ADD CONSTRAINT procurement_items_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;
ALTER TABLE public.procurement_items ADD CONSTRAINT procurement_items_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;

ALTER TABLE public.daily_logs ADD CONSTRAINT daily_logs_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;
ALTER TABLE public.daily_logs ADD CONSTRAINT daily_logs_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;

ALTER TABLE public.schedule_tasks ADD CONSTRAINT schedule_tasks_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;
ALTER TABLE public.schedule_tasks ADD CONSTRAINT schedule_tasks_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;

ALTER TABLE public.contacts ADD CONSTRAINT contacts_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;
ALTER TABLE public.contacts ADD CONSTRAINT contacts_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE SET NULL;

ALTER TABLE public.project_notes ADD CONSTRAINT project_notes_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;
ALTER TABLE public.project_notes ADD CONSTRAINT project_notes_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;

-- project_events intentionally has no FK constraints — confirmed against
-- production (pg_constraint returns only its PRIMARY KEY), so none are added here.
ALTER TABLE public.civil_construction_entrances ADD CONSTRAINT civil_construction_entrances_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;
ALTER TABLE public.civil_material_ledger ADD CONSTRAINT civil_material_ledger_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;
ALTER TABLE public.civil_pipe_runs ADD CONSTRAINT civil_pipe_runs_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;
ALTER TABLE public.civil_pipe_runs ADD CONSTRAINT civil_pipe_runs_page_id_fkey FOREIGN KEY (page_id) REFERENCES public.document_pages(id) ON DELETE SET NULL;
ALTER TABLE public.civil_stockpiles ADD CONSTRAINT civil_stockpiles_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;
ALTER TABLE public.civil_surfaces ADD CONSTRAINT civil_surfaces_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;
ALTER TABLE public.earthwork_volumes ADD CONSTRAINT earthwork_volumes_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;

ALTER TABLE public.ai_agent_audit_trails ADD CONSTRAINT ai_agent_audit_trails_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;
ALTER TABLE public.ai_agent_audit_trails ADD CONSTRAINT ai_agent_audit_trails_page_id_fkey FOREIGN KEY (page_id) REFERENCES public.document_pages(id) ON DELETE SET NULL;

ALTER TABLE public.google_connections ADD CONSTRAINT google_connections_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;
ALTER TABLE public.generated_documents ADD CONSTRAINT generated_documents_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;
ALTER TABLE public.generated_documents ADD CONSTRAINT generated_documents_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;
ALTER TABLE public.cost_catalog ADD CONSTRAINT cost_catalog_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;

-- ── Phantom functions (introspected from production; no tracked migration
--    previously created them) ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._set_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin new.updated_at = now(); return new; end;
$function$;

CREATE OR REPLACE FUNCTION public.set_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$function$;

CREATE OR REPLACE FUNCTION public.claim_document_checksum(p_tenant_id uuid, p_project_id uuid, p_document_id text, p_checksum text, p_file_size bigint)
 RETURNS TABLE(result text, canonical_document_id text)
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  lock_key bigint;
  self_row record;
  other_row record;
begin
  lock_key := hashtextextended(p_tenant_id::text || '|' || p_project_id::text || '|' || p_checksum, 0);
  perform pg_advisory_xact_lock(lock_key);

  select id, status, split_status, checksum into self_row
  from documents where id = p_document_id and tenant_id = p_tenant_id;

  if self_row.id is null then
    raise exception 'claim_document_checksum: document % not found for tenant %', p_document_id, p_tenant_id;
  end if;

  if self_row.split_status = 'done' then
    return query select 'already_completed'::text, p_document_id::text;
    return;
  end if;

  if self_row.split_status = 'error' then
    update documents
      set checksum = p_checksum, file_size = p_file_size,
          split_status = 'processing', attempt_count = attempt_count + 1,
          processing_started_at = now()
      where id = p_document_id and tenant_id = p_tenant_id;
    return query select 'retryable_failed_prior_attempt'::text, p_document_id::text;
    return;
  end if;

  select id, status, split_status into other_row
  from documents
  where tenant_id = p_tenant_id and project_id = p_project_id
    and checksum = p_checksum and id <> p_document_id
    and status not in ('error', 'failed', 'duplicate')
  order by uploaded_at asc
  limit 1;

  if other_row.id is not null then
    if other_row.split_status = 'done' then
      return query select 'exact_duplicate'::text, other_row.id::text;
      return;
    else
      return query select 'already_processing'::text, other_row.id::text;
      return;
    end if;
  end if;

  update documents
    set checksum = p_checksum, file_size = p_file_size,
        split_status = 'processing', attempt_count = attempt_count + 1,
        processing_started_at = now()
    where id = p_document_id and tenant_id = p_tenant_id;
  return query select 'accepted_new'::text, p_document_id::text;
end;
$function$;

CREATE OR REPLACE FUNCTION public.match_chunks(query_embedding vector, match_tenant_id uuid, match_project_id uuid, match_count integer DEFAULT 5)
 RETURNS TABLE(content text, document_id uuid, page_number integer, similarity double precision)
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  SELECT
    c.content,
    c.document_id,
    c.page_number,
    1 - (c.embedding <=> query_embedding) AS similarity
  FROM chunks c
  WHERE
    c.tenant_id = match_tenant_id
    AND c.project_id = match_project_id
  ORDER BY c.embedding <=> query_embedding
  LIMIT match_count;
END;
$function$;

CREATE OR REPLACE FUNCTION public.match_chunks(query_embedding vector, match_tenant_id uuid, match_project_id uuid, query_text text DEFAULT ''::text, match_count integer DEFAULT 6, rrf_k integer DEFAULT 60)
 RETURNS TABLE(content text, document_id uuid, page_number integer, similarity double precision, rrf_score double precision)
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  use_hybrid boolean := query_text IS NOT NULL AND length(trim(query_text)) > 0;
BEGIN
  IF use_hybrid THEN
    RETURN QUERY
    WITH vector_ranked AS (
      SELECT
        c.id,
        c.content,
        c.document_id,
        c.page_number,
        1 - (c.embedding <=> query_embedding) AS sim,
        ROW_NUMBER() OVER (ORDER BY c.embedding <=> query_embedding) AS vec_rank
      FROM chunks c
      WHERE c.tenant_id = match_tenant_id
        AND c.project_id = match_project_id
      ORDER BY c.embedding <=> query_embedding
      LIMIT match_count * 4
    ),
    keyword_ranked AS (
      SELECT
        c.id,
        ROW_NUMBER() OVER (
          ORDER BY ts_rank_cd(c.fts, websearch_to_tsquery('english', query_text)) DESC
        ) AS kw_rank
      FROM chunks c
      WHERE c.tenant_id = match_tenant_id
        AND c.project_id = match_project_id
        AND c.fts @@ websearch_to_tsquery('english', query_text)
      LIMIT match_count * 4
    )
    SELECT
      vr.content,
      vr.document_id,
      vr.page_number,
      vr.sim AS similarity,
      (
        COALESCE(1.0 / (rrf_k + vr.vec_rank), 0) +
        COALESCE(1.0 / (rrf_k + kr.kw_rank), 0)
      ) AS rrf_score
    FROM vector_ranked vr
    LEFT JOIN keyword_ranked kr ON kr.id = vr.id
    ORDER BY rrf_score DESC
    LIMIT match_count;
  ELSE
    -- Pure vector fallback when no query text
    RETURN QUERY
    SELECT
      c.content,
      c.document_id,
      c.page_number,
      1 - (c.embedding <=> query_embedding) AS similarity,
      1.0 / (rrf_k + ROW_NUMBER() OVER (ORDER BY c.embedding <=> query_embedding)) AS rrf_score
    FROM chunks c
    WHERE c.tenant_id = match_tenant_id
      AND c.project_id = match_project_id
    ORDER BY c.embedding <=> query_embedding
    LIMIT match_count;
  END IF;
END;
$function$;

-- rls_auto_enable: SECURITY DEFINER event-trigger function that
-- auto-enables RLS on any new table created in the public schema. This is
-- a real safety net (belt-and-suspenders alongside the explicit RLS
-- migrations) and must be preserved.
CREATE OR REPLACE FUNCTION public.rls_auto_enable()
 RETURNS event_trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$function$;

-- rls_auto_enable is created for the first time in THIS replay right above
-- (it's phantom -- no tracked migration creates it), so unlike
-- current_tenant_id (whose own REVOKE in 20260714_restrict_security_definer_functions.sql
-- runs after a tracked CREATE), there is no earlier point in a from-scratch
-- replay where this REVOKE could have run. Confirmed via
-- has_function_privilege() against production: anon_exec=false,
-- auth_exec=false for this function -- both must be revoked here, right
-- after its first creation.
REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM anon, authenticated, PUBLIC;

DROP EVENT TRIGGER IF EXISTS ensure_rls;
CREATE EVENT TRIGGER ensure_rls ON ddl_command_end EXECUTE FUNCTION public.rls_auto_enable();

-- ── Phantom triggers (all use the phantom updated_at functions above) ─────
DROP TRIGGER IF EXISTS trg_projects_updated_at ON public.projects;
CREATE TRIGGER trg_projects_updated_at BEFORE UPDATE ON public.projects FOR EACH ROW EXECUTE FUNCTION public._set_updated_at();

DROP TRIGGER IF EXISTS trg_contacts_updated_at ON public.contacts;
CREATE TRIGGER trg_contacts_updated_at BEFORE UPDATE ON public.contacts FOR EACH ROW EXECUTE FUNCTION public._set_updated_at();

DROP TRIGGER IF EXISTS trg_costcat_updated_at ON public.cost_catalog;
CREATE TRIGGER trg_costcat_updated_at BEFORE UPDATE ON public.cost_catalog FOR EACH ROW EXECUTE FUNCTION public._set_updated_at();

DROP TRIGGER IF EXISTS trg_daily_logs_updated_at ON public.daily_logs;
CREATE TRIGGER trg_daily_logs_updated_at BEFORE UPDATE ON public.daily_logs FOR EACH ROW EXECUTE FUNCTION public._set_updated_at();

DROP TRIGGER IF EXISTS trg_estimate_updated_at ON public.estimate_items;
CREATE TRIGGER trg_estimate_updated_at BEFORE UPDATE ON public.estimate_items FOR EACH ROW EXECUTE FUNCTION public._set_updated_at();

DROP TRIGGER IF EXISTS trg_gconn_updated_at ON public.google_connections;
CREATE TRIGGER trg_gconn_updated_at BEFORE UPDATE ON public.google_connections FOR EACH ROW EXECUTE FUNCTION public._set_updated_at();

DROP TRIGGER IF EXISTS trg_gendocs_updated_at ON public.generated_documents;
CREATE TRIGGER trg_gendocs_updated_at BEFORE UPDATE ON public.generated_documents FOR EACH ROW EXECUTE FUNCTION public._set_updated_at();

DROP TRIGGER IF EXISTS trg_permit_updated_at ON public.permit_items;
CREATE TRIGGER trg_permit_updated_at BEFORE UPDATE ON public.permit_items FOR EACH ROW EXECUTE FUNCTION public._set_updated_at();

DROP TRIGGER IF EXISTS trg_procurement_updated_at ON public.procurement_items;
CREATE TRIGGER trg_procurement_updated_at BEFORE UPDATE ON public.procurement_items FOR EACH ROW EXECUTE FUNCTION public._set_updated_at();

DROP TRIGGER IF EXISTS trg_punch_updated_at ON public.punch_list_items;
CREATE TRIGGER trg_punch_updated_at BEFORE UPDATE ON public.punch_list_items FOR EACH ROW EXECUTE FUNCTION public._set_updated_at();

DROP TRIGGER IF EXISTS trg_takeoff_updated_at ON public.takeoff_items;
CREATE TRIGGER trg_takeoff_updated_at BEFORE UPDATE ON public.takeoff_items FOR EACH ROW EXECUTE FUNCTION public._set_updated_at();

DROP TRIGGER IF EXISTS trg_tasks_updated_at ON public.schedule_tasks;
CREATE TRIGGER trg_tasks_updated_at BEFORE UPDATE ON public.schedule_tasks FOR EACH ROW EXECUTE FUNCTION public._set_updated_at();

DROP TRIGGER IF EXISTS change_order_items_updated_at ON public.change_order_items;
CREATE TRIGGER change_order_items_updated_at BEFORE UPDATE ON public.change_order_items FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS rfi_items_updated_at ON public.rfi_items;
CREATE TRIGGER rfi_items_updated_at BEFORE UPDATE ON public.rfi_items FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS submittal_items_updated_at ON public.submittal_items;
CREATE TRIGGER submittal_items_updated_at BEFORE UPDATE ON public.submittal_items FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── Indexes (non-constraint-backing) ───────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_agent_audit_page ON public.ai_agent_audit_trails USING btree (page_id);
CREATE INDEX IF NOT EXISTS idx_agent_audit_project ON public.ai_agent_audit_trails USING btree (project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_audit_status ON public.ai_agent_audit_trails USING btree (tenant_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_record ON public.audit_logs USING btree (record_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_table ON public.audit_logs USING btree (table_name, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_tenant ON public.audit_logs USING btree (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user ON public.audit_logs USING btree (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS change_order_items_tenant_project ON public.change_order_items USING btree (tenant_id, project_id);
CREATE INDEX IF NOT EXISTS chunks_fts_idx ON public.chunks USING gin (fts);
CREATE INDEX IF NOT EXISTS chunks_hnsw ON public.chunks USING hnsw (embedding vector_cosine_ops) WITH (m='16', ef_construction='64');
CREATE INDEX IF NOT EXISTS idx_chunks_document ON public.chunks USING btree (document_id);
CREATE INDEX IF NOT EXISTS idx_chunks_project ON public.chunks USING btree (project_id);
CREATE INDEX IF NOT EXISTS idx_chunks_tenant ON public.chunks USING btree (tenant_id);
CREATE INDEX IF NOT EXISTS idx_construction_entrances_project ON public.civil_construction_entrances USING btree (project_id);
CREATE INDEX IF NOT EXISTS idx_construction_entrances_tenant ON public.civil_construction_entrances USING btree (tenant_id);
CREATE INDEX IF NOT EXISTS idx_material_ledger_project ON public.civil_material_ledger USING btree (project_id, direction);
CREATE INDEX IF NOT EXISTS idx_material_ledger_tenant ON public.civil_material_ledger USING btree (tenant_id);
CREATE INDEX IF NOT EXISTS idx_civil_pipe_runs_page_id ON public.civil_pipe_runs USING btree (page_id);
CREATE INDEX IF NOT EXISTS idx_civil_pipe_runs_project ON public.civil_pipe_runs USING btree (project_id);
CREATE INDEX IF NOT EXISTS idx_civil_pipe_runs_tenant ON public.civil_pipe_runs USING btree (tenant_id);
CREATE INDEX IF NOT EXISTS idx_stockpiles_project ON public.civil_stockpiles USING btree (project_id);
CREATE INDEX IF NOT EXISTS idx_stockpiles_tenant ON public.civil_stockpiles USING btree (tenant_id);
CREATE INDEX IF NOT EXISTS idx_civil_surfaces_project ON public.civil_surfaces USING btree (project_id, surface_type);
CREATE INDEX IF NOT EXISTS idx_civil_surfaces_tenant ON public.civil_surfaces USING btree (tenant_id);
CREATE INDEX IF NOT EXISTS idx_company_users_clerk ON public.company_users USING btree (clerk_id);
CREATE INDEX IF NOT EXISTS idx_company_users_role_id ON public.company_users USING btree (role_id);
CREATE INDEX IF NOT EXISTS contacts_project_id_idx ON public.contacts USING btree (project_id);
CREATE INDEX IF NOT EXISTS contacts_tenant_id_idx ON public.contacts USING btree (tenant_id);
CREATE INDEX IF NOT EXISTS idx_conversations_project ON public.conversations USING btree (project_id);
CREATE INDEX IF NOT EXISTS idx_conversations_tenant_id ON public.conversations USING btree (tenant_id);
CREATE INDEX IF NOT EXISTS idx_costcat_csi ON public.cost_catalog USING btree (tenant_id, csi_code);
CREATE INDEX IF NOT EXISTS idx_costcat_tenant ON public.cost_catalog USING btree (tenant_id);
CREATE INDEX IF NOT EXISTS idx_daily_logs_project ON public.daily_logs USING btree (project_id, log_date DESC);
CREATE INDEX IF NOT EXISTS idx_daily_logs_tenant ON public.daily_logs USING btree (tenant_id);
CREATE INDEX IF NOT EXISTS idx_document_intelligence_document_id ON public.document_intelligence USING btree (document_id);
CREATE INDEX IF NOT EXISTS idx_intel_project ON public.document_intelligence USING btree (project_id);
CREATE INDEX IF NOT EXISTS idx_intel_tenant ON public.document_intelligence USING btree (tenant_id);
CREATE INDEX IF NOT EXISTS idx_document_processing_events_document ON public.document_processing_events USING btree (document_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_document_processing_events_tenant ON public.document_processing_events USING btree (tenant_id, started_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS documents_tenant_project_drive_file_unique ON public.documents USING btree (tenant_id, project_id, drive_file_id) WHERE (drive_file_id IS NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS idx_documents_checksum_tenant_project ON public.documents USING btree (tenant_id, project_id, checksum) WHERE ((checksum IS NOT NULL) AND (status <> ALL (ARRAY['error'::text, 'failed'::text, 'duplicate'::text])));
CREATE INDEX IF NOT EXISTS idx_documents_family ON public.documents USING btree (document_family_id, version_number);
CREATE INDEX IF NOT EXISTS idx_documents_processing_status ON public.documents USING btree (tenant_id, split_status, ocr_status, vector_status, takeoff_status);
CREATE INDEX IF NOT EXISTS idx_documents_project ON public.documents USING btree (project_id);
CREATE INDEX IF NOT EXISTS idx_documents_tenant ON public.documents USING btree (tenant_id);
CREATE INDEX IF NOT EXISTS idx_earthwork_volumes_tenant ON public.earthwork_volumes USING btree (tenant_id);
CREATE INDEX IF NOT EXISTS idx_estimate_csi ON public.estimate_items USING btree (csi_code);
CREATE INDEX IF NOT EXISTS idx_estimate_items_version ON public.estimate_items USING btree (estimate_version_id);
CREATE INDEX IF NOT EXISTS idx_estimate_project ON public.estimate_items USING btree (project_id);
CREATE INDEX IF NOT EXISTS idx_estimate_source_fingerprint ON public.estimate_items USING btree (tenant_id, project_id, source_fingerprint);
CREATE INDEX IF NOT EXISTS idx_estimate_source_takeoff ON public.estimate_items USING btree (source_takeoff_id);
CREATE INDEX IF NOT EXISTS idx_estimate_tenant ON public.estimate_items USING btree (tenant_id);
CREATE INDEX IF NOT EXISTS idx_gendocs_project ON public.generated_documents USING btree (project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_gendocs_tenant ON public.generated_documents USING btree (tenant_id);
CREATE INDEX IF NOT EXISTS idx_gconn_tenant ON public.google_connections USING btree (tenant_id);
CREATE INDEX IF NOT EXISTS idx_memories_project ON public.memories USING btree (project_id);
CREATE INDEX IF NOT EXISTS idx_memories_source_document_id ON public.memories USING btree (source_document_id);
CREATE INDEX IF NOT EXISTS idx_memories_tenant ON public.memories USING btree (tenant_id);
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON public.messages USING btree (conversation_id);
CREATE INDEX IF NOT EXISTS idx_messages_tenant_id ON public.messages USING btree (tenant_id);
CREATE INDEX IF NOT EXISTS idx_pages_document ON public.pages USING btree (document_id);
CREATE INDEX IF NOT EXISTS idx_pages_tenant ON public.pages USING btree (tenant_id);
CREATE INDEX IF NOT EXISTS idx_permit_project ON public.permit_items USING btree (project_id);
CREATE INDEX IF NOT EXISTS idx_permit_tenant ON public.permit_items USING btree (tenant_id);
CREATE INDEX IF NOT EXISTS idx_procurement_project ON public.procurement_items USING btree (project_id);
CREATE INDEX IF NOT EXISTS idx_procurement_tenant ON public.procurement_items USING btree (tenant_id);
CREATE INDEX IF NOT EXISTS project_events_entity_idx ON public.project_events USING btree (tenant_id, entity_type, created_at DESC);
CREATE INDEX IF NOT EXISTS project_events_project_idx ON public.project_events USING btree (project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS project_events_tenant_idx ON public.project_events USING btree (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notes_tenant ON public.project_notes USING btree (tenant_id);
CREATE INDEX IF NOT EXISTS project_notes_project_id_idx ON public.project_notes USING btree (project_id);
CREATE INDEX IF NOT EXISTS project_risk_digests_project_idx ON public.project_risk_digests USING btree (project_id, generated_at DESC);
CREATE INDEX IF NOT EXISTS project_risk_digests_tenant_idx ON public.project_risk_digests USING btree (tenant_id, risk_level);
CREATE INDEX IF NOT EXISTS idx_projects_status ON public.projects USING btree (tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_projects_tenant ON public.projects USING btree (tenant_id);
CREATE INDEX IF NOT EXISTS idx_punch_project ON public.punch_list_items USING btree (project_id);
CREATE INDEX IF NOT EXISTS idx_punch_tenant ON public.punch_list_items USING btree (tenant_id);
CREATE INDEX IF NOT EXISTS rfi_items_tenant_project ON public.rfi_items USING btree (tenant_id, project_id);
CREATE INDEX IF NOT EXISTS idx_tasks_critical ON public.schedule_tasks USING btree (project_id, critical);
CREATE INDEX IF NOT EXISTS idx_tasks_project ON public.schedule_tasks USING btree (project_id);
CREATE INDEX IF NOT EXISTS idx_tasks_tenant ON public.schedule_tasks USING btree (tenant_id);
CREATE INDEX IF NOT EXISTS idx_sheet_corrections_sheet ON public.sheet_corrections USING btree (sheet_id, corrected_at);
CREATE INDEX IF NOT EXISTS idx_sheets_current ON public.sheets USING btree (project_id, is_current);
CREATE INDEX IF NOT EXISTS idx_sheets_document ON public.sheets USING btree (document_id);
CREATE INDEX IF NOT EXISTS idx_sheets_number ON public.sheets USING btree (project_id, sheet_number_normalized);
CREATE INDEX IF NOT EXISTS idx_sheets_project ON public.sheets USING btree (tenant_id, project_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_sheets_unique_page ON public.sheets USING btree (document_page_id) WHERE (document_page_id IS NOT NULL);
CREATE INDEX IF NOT EXISTS submittal_items_tenant_project ON public.submittal_items USING btree (tenant_id, project_id);
CREATE INDEX IF NOT EXISTS idx_geom_local ON public.takeoff_items USING gist (geom_local);
CREATE INDEX IF NOT EXISTS idx_geom_sp ON public.takeoff_items USING gist (geom_sp);
CREATE INDEX IF NOT EXISTS idx_geom_wgs84 ON public.takeoff_items USING gist (geom_wgs84);
CREATE INDEX IF NOT EXISTS idx_takeoff_csi ON public.takeoff_items USING btree (csi_code);
CREATE INDEX IF NOT EXISTS idx_takeoff_document ON public.takeoff_items USING btree (document_id);
CREATE INDEX IF NOT EXISTS idx_takeoff_items_meta_gin ON public.takeoff_items USING gin (meta);
CREATE INDEX IF NOT EXISTS idx_takeoff_items_review_status ON public.takeoff_items USING btree (tenant_id, project_id, review_status);
CREATE INDEX IF NOT EXISTS idx_takeoff_items_sheet_id ON public.takeoff_items USING btree (sheet_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_takeoff_items_source_manual_takeoff ON public.takeoff_items USING btree (source_manual_takeoff_id) WHERE (source_manual_takeoff_id IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_takeoff_items_source_method ON public.takeoff_items USING btree (tenant_id, project_id, source_method);
CREATE UNIQUE INDEX IF NOT EXISTS idx_takeoff_items_undecided_page_item_key ON public.takeoff_items USING btree (tenant_id, document_id, ((meta ->> 'vision_page_id'::text)), ((meta ->> 'item_key'::text))) WHERE (review_status = ANY (ARRAY['suggested'::text, 'reviewed'::text]));
CREATE INDEX IF NOT EXISTS idx_takeoff_project ON public.takeoff_items USING btree (project_id);
CREATE INDEX IF NOT EXISTS idx_takeoff_tenant ON public.takeoff_items USING btree (tenant_id);
CREATE INDEX IF NOT EXISTS idx_tenants_paddle_customer_id ON public.tenants USING btree (paddle_customer_id) WHERE (paddle_customer_id IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_tenants_paddle_subscription_id ON public.tenants USING btree (paddle_subscription_id) WHERE (paddle_subscription_id IS NOT NULL);

-- ── Final RLS-enable catch-all ────────────────────────────────────────────
-- Confirmed against production: every public table has relrowsecurity=true,
-- no exceptions. The baseline's own explicit ENABLE pass (see
-- 20260627000000_schema_baseline.sql) only covers the 40 originally-phantom
-- tables — tables created by TRACKED migrations before this point (e.g.
-- agent_runs, invoices, cost_codes, weekly_logs — created in
-- 20260630_billing.sql through 20260702_cost_catalog_v2.sql) have the same
-- gap: their own migration files never explicitly ENABLE ROW LEVEL SECURITY,
-- relying on the `rls_auto_enable()` event trigger installed by THIS file,
-- which doesn't exist yet when they're created during a from-scratch
-- replay. Dynamic (not a hardcoded table list) so it can never miss one.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', r.relname);
  END LOOP;
END $$;
