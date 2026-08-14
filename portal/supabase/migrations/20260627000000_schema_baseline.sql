-- SCHEMA BASELINE — reconstructed via direct production introspection
-- (pg_catalog / information_schema, not manual reconstruction from memory).
-- See docs/frontend-backend-reconciliation/SCHEMA_BASELINE.md for the full
-- methodology, source queries, and rationale.
--
-- This file captures the 40 foundational tables that exist in production
-- but were never created by any tracked migration file in this repository
-- (they predate migration tracking / were created out-of-band). Filename
-- sorts before every other file in this directory so a fresh database
-- gets these tables before any migration that ALTERs them (e.g. the
-- v9_document_intelligence migration's `ALTER TABLE documents ADD COLUMN`).
--
-- Scope deliberately excludes:
--   - RLS enablement + policies for these tables — already fully covered
--     by existing tracked migrations (20260706_rls_tenant_isolation.sql,
--     20260706_rls_profiles_and_catalog.sql, 20260714_backfill_rls_policies.sql,
--     and later per-feature migrations), which reference these table names
--     directly and will apply correctly once this baseline creates them.
--   - Foreign keys, phantom functions/triggers, and indexes — placed in
--     20260812000000_baseline_foreign_keys_functions_and_triggers.sql instead,
--     since several FKs target tables created by migrations that run AFTER
--     this baseline (e.g. estimate_items -> estimate_versions/takeoff_items).
--   - Supabase-managed extensions/schemas (pg_graphql, pgjwt, pg_net, vault,
--     pg_repack, pg_walinspect, postgres_fdw, wrappers, pg_cron — pg_cron and
--     pg_net are already tracked in 20260707_schedule_commodity_sync.sql).

-- Production installs its non-platform-managed extensions into the
-- `extensions` schema (Supabase's convention), not `public` -- confirmed via
-- pg_extension.extnamespace directly against production.
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS "pgcrypto" SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS "vector" SCHEMA extensions;
-- Production has PostGIS installed into a non-default `topology` schema
-- (confirmed via pg_type: the `geometry` type lives in `topology`, not
-- `public`/`extensions`) -- matched here so takeoff_items.geom_* columns
-- resolve to the same type production uses.
CREATE SCHEMA IF NOT EXISTS topology;
CREATE EXTENSION IF NOT EXISTS postgis SCHEMA topology;
CREATE EXTENSION IF NOT EXISTS postgis_topology SCHEMA topology;

-- ── tenants (root of the multi-tenant model) ──────────────────────────────
CREATE TABLE IF NOT EXISTS public.tenants (
  id uuid DEFAULT uuid_generate_v4() NOT NULL,
  clerk_org_id text NOT NULL,
  name text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  plan_tier text DEFAULT 'trial'::text NOT NULL,
  subscription_status text,
  paddle_customer_id text,
  paddle_subscription_id text,
  seat_limit integer DEFAULT 1,
  seats_used integer DEFAULT 1,
  ai_credits_remaining integer DEFAULT 10,
  ai_credits_reset_at timestamp with time zone,
  trial_ends_at timestamp with time zone DEFAULT (now() + '3 days'::interval),
  comp_until timestamp with time zone,
  PRIMARY KEY (id),
  UNIQUE (clerk_org_id)
);

-- ── companies / roles (legacy company-scoped auth model) ─────────────────
CREATE TABLE IF NOT EXISTS public.companies (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  tenant_id uuid NOT NULL,
  name text NOT NULL,
  subscription_status text DEFAULT 'trial'::text NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  PRIMARY KEY (id),
  UNIQUE (tenant_id)
);

CREATE TABLE IF NOT EXISTS public.roles (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  tenant_id uuid NOT NULL,
  name text NOT NULL,
  permissions jsonb DEFAULT '{}'::jsonb NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  PRIMARY KEY (id),
  UNIQUE (tenant_id, name)
);

CREATE TABLE IF NOT EXISTS public.company_users (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  tenant_id uuid NOT NULL,
  company_id uuid NOT NULL,
  clerk_id text NOT NULL,
  email text,
  first_name text,
  last_name text,
  role_id uuid,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  PRIMARY KEY (id),
  UNIQUE (company_id, clerk_id)
);

-- ── projects (core entity almost everything else hangs off of) ───────────
CREATE TABLE IF NOT EXISTS public.projects (
  id uuid DEFAULT uuid_generate_v4() NOT NULL,
  tenant_id uuid NOT NULL,
  name text NOT NULL,
  address text,
  city text,
  state text,
  status text DEFAULT 'active'::text NOT NULL,
  start_date date,
  end_date date,
  budget numeric(18,2),
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  meta jsonb DEFAULT '{}'::jsonb NOT NULL,
  zip_code text,
  latitude numeric,
  longitude numeric,
  georeferences jsonb,
  PRIMARY KEY (id),
  CHECK (status = ANY (ARRAY['active'::text, 'bidding'::text, 'complete'::text, 'on_hold'::text]))
);

-- ── documents / pages / sheets pipeline ───────────────────────────────────
CREATE TABLE IF NOT EXISTS public.documents (
  id text NOT NULL,
  tenant_id uuid NOT NULL,
  project_id uuid,
  file_name text NOT NULL,
  page_count integer DEFAULT 0,
  status text DEFAULT 'pending'::text NOT NULL,
  uploaded_at timestamp with time zone DEFAULT now() NOT NULL,
  processed_at timestamp with time zone,
  meta jsonb DEFAULT '{}'::jsonb NOT NULL,
  doc_type text,
  drive_file_id text,
  checksum text,
  file_size bigint,
  mime_type text,
  split_status text DEFAULT 'pending'::text NOT NULL,
  ocr_status text DEFAULT 'pending'::text NOT NULL,
  vector_status text DEFAULT 'pending'::text NOT NULL,
  takeoff_status text DEFAULT 'pending'::text NOT NULL,
  sheet_index_status text DEFAULT 'pending'::text NOT NULL,
  attempt_count integer DEFAULT 0 NOT NULL,
  last_error text,
  last_error_step text,
  last_successful_step text,
  processing_started_at timestamp with time zone,
  processing_completed_at timestamp with time zone,
  document_family_id uuid,
  version_number integer DEFAULT 1 NOT NULL,
  supersedes_document_id text,
  is_current boolean DEFAULT true NOT NULL,
  PRIMARY KEY (id),
  CHECK (doc_type = ANY (ARRAY['drawing'::text, 'spec'::text, 'rfi'::text, 'submittal'::text, 'other'::text])),
  CHECK (ocr_status = ANY (ARRAY['pending'::text, 'processing'::text, 'done'::text, 'error'::text, 'partially_completed'::text, 'skipped'::text])),
  CHECK (sheet_index_status = ANY (ARRAY['pending'::text, 'processing'::text, 'done'::text, 'error'::text, 'partially_completed'::text, 'skipped'::text])),
  CHECK (split_status = ANY (ARRAY['pending'::text, 'processing'::text, 'done'::text, 'error'::text, 'skipped'::text])),
  CHECK (takeoff_status = ANY (ARRAY['pending'::text, 'processing'::text, 'done'::text, 'error'::text, 'partially_completed'::text, 'skipped'::text])),
  CHECK (vector_status = ANY (ARRAY['pending'::text, 'processing'::text, 'done'::text, 'error'::text, 'partially_completed'::text, 'skipped'::text]))
);

CREATE TABLE IF NOT EXISTS public.pages (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  document_id text NOT NULL,
  tenant_id uuid NOT NULL,
  page_number integer NOT NULL,
  extracted_text text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  PRIMARY KEY (id),
  UNIQUE (document_id, page_number)
);

CREATE TABLE IF NOT EXISTS public.sheets (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  document_id text NOT NULL,
  document_page_id uuid,
  page_number integer,
  sheet_number_raw text,
  sheet_number_normalized text,
  sheet_title text,
  discipline text,
  subdiscipline text,
  revision text,
  revision_date date,
  scale_text text,
  is_current boolean DEFAULT true NOT NULL,
  supersedes_sheet_id uuid,
  superseded_by_sheet_id uuid,
  vector_available boolean DEFAULT false NOT NULL,
  embedded_text_available boolean DEFAULT false NOT NULL,
  ocr_available boolean DEFAULT false NOT NULL,
  thumbnail_path text,
  processing_status text DEFAULT 'pending'::text NOT NULL,
  classification_confidence numeric,
  classification_method text,
  verification_status text DEFAULT 'unverified'::text NOT NULL,
  created_by text,
  updated_by text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  PRIMARY KEY (id),
  CHECK (classification_method = ANY (ARRAY['deterministic'::text, 'ai'::text, 'manual'::text, NULL::text])),
  CHECK ((supersedes_sheet_id IS DISTINCT FROM id) AND (superseded_by_sheet_id IS DISTINCT FROM id)),
  CHECK (processing_status = ANY (ARRAY['pending'::text, 'processing'::text, 'done'::text, 'error'::text, 'needs_review'::text])),
  CHECK (verification_status = ANY (ARRAY['unverified'::text, 'ai_suggested'::text, 'human_confirmed'::text, 'human_corrected'::text]))
);

CREATE TABLE IF NOT EXISTS public.sheet_corrections (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  sheet_id uuid NOT NULL,
  field text NOT NULL,
  before_value text,
  after_value text,
  corrected_by text NOT NULL,
  corrected_at timestamp with time zone DEFAULT now() NOT NULL,
  PRIMARY KEY (id)
);

-- ── chunks / document_intelligence / RAG plumbing ─────────────────────────
CREATE TABLE IF NOT EXISTS public.chunks (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  document_id text NOT NULL,
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  page_number integer,
  content text NOT NULL,
  embedding vector(768),
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  fts tsvector GENERATED ALWAYS AS (to_tsvector('english'::regconfig, COALESCE(content, ''::text))) STORED,
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.document_intelligence (
  id uuid DEFAULT uuid_generate_v4() NOT NULL,
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  document_id text,
  chunk_index integer NOT NULL,
  content text NOT NULL,
  meta jsonb DEFAULT '{}'::jsonb NOT NULL,
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.document_processing_events (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  tenant_id uuid NOT NULL,
  project_id uuid,
  document_id text NOT NULL,
  document_page_id uuid,
  step text NOT NULL,
  status text NOT NULL,
  worker text,
  job_id uuid,
  attempt_number integer DEFAULT 1 NOT NULL,
  error_code text,
  error_message text,
  started_at timestamp with time zone DEFAULT now() NOT NULL,
  completed_at timestamp with time zone,
  PRIMARY KEY (id),
  CHECK (status = ANY (ARRAY['started'::text, 'succeeded'::text, 'failed'::text, 'skipped'::text])),
  CHECK (step = ANY (ARRAY['split'::text, 'ocr'::text, 'vector'::text, 'sheet_detection'::text, 'takeoff'::text, 'embedding'::text, 'indexing'::text]))
);

CREATE TABLE IF NOT EXISTS public.memories (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  project_id uuid NOT NULL,
  tenant_id uuid NOT NULL,
  fact text NOT NULL,
  source_document_id text,
  source_page integer,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.conversations (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  project_id uuid NOT NULL,
  tenant_id uuid NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  summary text,
  message_count integer DEFAULT 0 NOT NULL,
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.messages (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  conversation_id uuid NOT NULL,
  tenant_id uuid NOT NULL,
  role text NOT NULL,
  content text NOT NULL,
  citations jsonb DEFAULT '[]'::jsonb NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  PRIMARY KEY (id),
  CHECK (role = ANY (ARRAY['user'::text, 'assistant'::text]))
);

-- ── takeoff_items (legacy/general takeoff geometry, distinct from the
--    manual_takeoffs/sheet_calibrations system which IS tracked) ──────────
CREATE TABLE IF NOT EXISTS public.takeoff_items (
  id uuid DEFAULT uuid_generate_v4() NOT NULL,
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  document_id text,
  page integer NOT NULL,
  type text NOT NULL,
  label text,
  quantity numeric(18,4),
  unit text,
  rate numeric(18,4),
  csi_code text,
  division text,
  points jsonb,
  px_per_foot numeric(12,6),
  geo_calib jsonb,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  meta jsonb DEFAULT '{}'::jsonb NOT NULL,
  geom_local topology.geometry,
  geom_sp topology.geometry(Geometry,2276),
  geom_wgs84 topology.geometry(Geometry,4326),
  created_by text,
  review_status text DEFAULT 'approved'::text NOT NULL,
  reviewed_by text,
  reviewed_at timestamp with time zone,
  rejected_reason text,
  geometry jsonb,
  document_revision text,
  sheet_revision text,
  assembly text,
  updated_by text,
  approved_by text,
  approved_at timestamp with time zone,
  source_method text,
  confidence_score numeric,
  sheet_id uuid,
  coordinate_system text DEFAULT 'canvas_px'::text NOT NULL,
  scale_unit text DEFAULT 'ft'::text NOT NULL,
  source_manual_takeoff_id uuid,
  PRIMARY KEY (id),
  CHECK (review_status = ANY (ARRAY['suggested'::text, 'reviewed'::text, 'approved'::text, 'rejected'::text])),
  CHECK (type = ANY (ARRAY['length'::text, 'area'::text, 'perim'::text, 'count'::text, 'volume'::text, 'takeoff_import'::text, 'general'::text]))
);

-- ── estimate_items (authoritative estimating line-item table) ────────────
CREATE TABLE IF NOT EXISTS public.estimate_items (
  id uuid DEFAULT uuid_generate_v4() NOT NULL,
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  trade text,
  csi_code text,
  description text NOT NULL,
  item_type text DEFAULT 'material'::text NOT NULL,
  quantity numeric(18,4),
  uom text,
  unit_cost numeric(18,4),
  notes text,
  sort_order integer DEFAULT 0 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  source_takeoff_id uuid,
  source_fingerprint text,
  quantity_basis text,
  drawing_ref text,
  location_tag text,
  pricing_status text DEFAULT 'manual'::text NOT NULL,
  estimate_version_id uuid,
  cost_code text,
  scope_category text,
  source_document_id uuid,
  source_sheet_id uuid,
  assembly_id uuid,
  labor_cost numeric DEFAULT 0 NOT NULL,
  material_cost numeric DEFAULT 0 NOT NULL,
  equipment_cost numeric DEFAULT 0 NOT NULL,
  trucking_cost numeric DEFAULT 0 NOT NULL,
  subcontract_cost numeric DEFAULT 0 NOT NULL,
  disposal_cost numeric DEFAULT 0 NOT NULL,
  testing_cost numeric DEFAULT 0 NOT NULL,
  other_direct_cost numeric DEFAULT 0 NOT NULL,
  total_direct_cost numeric DEFAULT 0 NOT NULL,
  indirect_cost numeric DEFAULT 0 NOT NULL,
  contingency numeric DEFAULT 0 NOT NULL,
  overhead numeric DEFAULT 0 NOT NULL,
  profit numeric DEFAULT 0 NOT NULL,
  total_price numeric DEFAULT 0 NOT NULL,
  unit_price numeric,
  assumptions text,
  exclusions text,
  is_allowance boolean DEFAULT false NOT NULL,
  is_alternate boolean DEFAULT false NOT NULL,
  alternate_accepted boolean DEFAULT false NOT NULL,
  created_by text,
  updated_by text,
  legacy_source text,
  PRIMARY KEY (id),
  CHECK (item_type = ANY (ARRAY['material'::text, 'labour'::text, 'equipment'::text, 'subcontract'::text])),
  CHECK (pricing_status = ANY (ARRAY['manual'::text, 'priced'::text, 'unpriced'::text, 'review'::text]))
);

-- ── change orders / RFIs / submittals / punch list / permits ──────────────
CREATE TABLE IF NOT EXISTS public.change_order_items (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  number text,
  description text NOT NULL,
  reason text,
  status text DEFAULT 'draft'::text NOT NULL,
  trade text,
  request_date date,
  submitted_date date,
  approved_date date,
  amount numeric(14,2),
  labor_cost numeric(14,2),
  material_cost numeric(14,2),
  equipment_cost numeric(14,2),
  subcontract_cost numeric(14,2),
  markup numeric(14,2),
  notes text,
  meta jsonb DEFAULT '{}'::jsonb NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  PRIMARY KEY (id),
  CHECK (status = ANY (ARRAY['draft'::text, 'pending'::text, 'approved'::text, 'rejected'::text, 'void'::text]))
);

CREATE TABLE IF NOT EXISTS public.rfi_items (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  number text,
  subject text NOT NULL,
  description text,
  discipline text,
  status text DEFAULT 'open'::text NOT NULL,
  priority text DEFAULT 'medium'::text NOT NULL,
  submitted_date date,
  due_date date,
  assigned_to text,
  response text,
  response_date date,
  meta jsonb DEFAULT '{}'::jsonb NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  PRIMARY KEY (id),
  CHECK (priority = ANY (ARRAY['low'::text, 'medium'::text, 'high'::text, 'critical'::text])),
  CHECK (status = ANY (ARRAY['draft'::text, 'open'::text, 'answered'::text, 'closed'::text, 'void'::text]))
);

CREATE TABLE IF NOT EXISTS public.submittal_items (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  number text,
  spec_section text,
  title text NOT NULL,
  description text,
  submittal_type text DEFAULT 'other'::text NOT NULL,
  status text DEFAULT 'draft'::text NOT NULL,
  revision text,
  submitted_date date,
  due_date date,
  returned_date date,
  responsible text,
  notes text,
  meta jsonb DEFAULT '{}'::jsonb NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  PRIMARY KEY (id),
  CHECK (status = ANY (ARRAY['draft'::text, 'submitted'::text, 'under_review'::text, 'approved'::text, 'approved_as_noted'::text, 'revise_resubmit'::text, 'rejected'::text, 'closed'::text])),
  CHECK (submittal_type = ANY (ARRAY['product_data'::text, 'shop_drawing'::text, 'sample'::text, 'mix_design'::text, 'manual'::text, 'other'::text]))
);

CREATE TABLE IF NOT EXISTS public.punch_list_items (
  id uuid DEFAULT uuid_generate_v4() NOT NULL,
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  item_number integer,
  description text NOT NULL,
  location text,
  trade text,
  responsible text,
  priority text DEFAULT 'medium'::text NOT NULL,
  status text DEFAULT 'open'::text NOT NULL,
  due_date date,
  sign_off text,
  completed_date date,
  notes text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  PRIMARY KEY (id),
  CHECK (priority = ANY (ARRAY['low'::text, 'medium'::text, 'high'::text, 'critical'::text])),
  CHECK (status = ANY (ARRAY['open'::text, 'in_progress'::text, 'complete'::text, 'approved'::text]))
);

CREATE TABLE IF NOT EXISTS public.permit_items (
  id uuid DEFAULT uuid_generate_v4() NOT NULL,
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  permit_type text NOT NULL,
  description text,
  authority text,
  required boolean DEFAULT true NOT NULL,
  status text DEFAULT 'not_started'::text NOT NULL,
  application_number text,
  permit_number text,
  submit_date date,
  approval_date date,
  expiry_date date,
  notes text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  PRIMARY KEY (id),
  CHECK (status = ANY (ARRAY['not_started'::text, 'submitted'::text, 'approved'::text, 'rejected'::text, 'expired'::text]))
);

CREATE TABLE IF NOT EXISTS public.procurement_items (
  id uuid DEFAULT uuid_generate_v4() NOT NULL,
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  description text NOT NULL,
  spec_section text,
  supplier text,
  status text DEFAULT 'pending'::text NOT NULL,
  po_number text,
  lead_time_days integer,
  required_date date,
  order_date date,
  delivery_date date,
  unit_cost numeric(18,4),
  quantity numeric(18,4),
  notes text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  PRIMARY KEY (id),
  CHECK (status = ANY (ARRAY['pending'::text, 'quoted'::text, 'ordered'::text, 'delivered'::text, 'rejected'::text]))
);

-- ── daily logs / schedule / contacts / notes / events / risk digests ─────
CREATE TABLE IF NOT EXISTS public.daily_logs (
  id uuid DEFAULT uuid_generate_v4() NOT NULL,
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  log_date date DEFAULT CURRENT_DATE NOT NULL,
  weather text,
  temperature text,
  crew_count integer,
  work_performed text,
  notes text,
  photo_urls jsonb DEFAULT '[]'::jsonb NOT NULL,
  created_by text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.schedule_tasks (
  id uuid DEFAULT uuid_generate_v4() NOT NULL,
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  name text NOT NULL,
  duration integer DEFAULT 1 NOT NULL,
  deps text[] DEFAULT '{}'::text[],
  status text DEFAULT 'pending'::text NOT NULL,
  es integer,
  ef integer,
  ls integer,
  lf integer,
  total_float integer,
  free_float integer,
  critical boolean DEFAULT false,
  start_date date,
  end_date date,
  ls_date date,
  lf_date date,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  meta jsonb DEFAULT '{}'::jsonb NOT NULL,
  PRIMARY KEY (id),
  CHECK (status = ANY (ARRAY['pending'::text, 'in_progress'::text, 'complete'::text, 'blocked'::text]))
);

CREATE TABLE IF NOT EXISTS public.contacts (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  tenant_id uuid NOT NULL,
  project_id uuid,
  name text NOT NULL,
  company text,
  role text,
  email text,
  phone text,
  notes text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.project_notes (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  content text DEFAULT ''::text NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_by text,
  PRIMARY KEY (id),
  UNIQUE (tenant_id, project_id)
);

CREATE TABLE IF NOT EXISTS public.project_events (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  project_id uuid NOT NULL,
  tenant_id uuid NOT NULL,
  user_id text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid,
  action text NOT NULL,
  title text NOT NULL,
  meta jsonb DEFAULT '{}'::jsonb NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.project_risk_digests (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  project_id uuid NOT NULL,
  tenant_id uuid NOT NULL,
  generated_at timestamp with time zone DEFAULT now() NOT NULL,
  risk_level text DEFAULT 'low'::text NOT NULL,
  bullets jsonb DEFAULT '[]'::jsonb NOT NULL,
  data_snapshot jsonb DEFAULT '{}'::jsonb NOT NULL,
  PRIMARY KEY (id),
  CHECK (risk_level = ANY (ARRAY['low'::text, 'medium'::text, 'high'::text, 'critical'::text]))
);

-- ── civil/earthwork tables ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.civil_construction_entrances (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  name text NOT NULL,
  length_ft numeric DEFAULT 50 NOT NULL,
  width_ft numeric DEFAULT 20 NOT NULL,
  depth_in numeric DEFAULT 8 NOT NULL,
  stone_size text DEFAULT '2-3" crushed stone'::text,
  fabric_underlayment boolean DEFAULT true,
  computed jsonb,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.civil_material_ledger (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  direction text NOT NULL,
  material_type text NOT NULL,
  quantity_bcy numeric,
  quantity_ton numeric,
  unit_price numeric,
  unit_of_measure text DEFAULT 'CY'::text,
  source_destination text,
  haul_distance_mi numeric,
  scope_ref text,
  notes text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.civil_pipe_runs (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  page_id uuid,
  name text NOT NULL,
  system text NOT NULL,
  material text,
  diameter_in numeric NOT NULL,
  length_lf numeric NOT NULL,
  avg_depth_ft numeric NOT NULL,
  trench_width_ft numeric NOT NULL,
  bedding_depth_in numeric DEFAULT 6,
  haunch_depth_in numeric DEFAULT 6,
  initial_backfill_over_pipe_in numeric DEFAULT 12,
  bedding_material text DEFAULT '#57 stone'::text,
  backfill_material text DEFAULT 'native suitable'::text,
  swell_factor numeric DEFAULT 1.15,
  shrink_factor numeric DEFAULT 0.85,
  computed jsonb,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.civil_stockpiles (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  name text NOT NULL,
  material_type text NOT NULL,
  volume_bcy numeric DEFAULT 0 NOT NULL,
  swell_factor numeric DEFAULT 1.15,
  location_notes text,
  reuse_planned boolean DEFAULT true,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.civil_surfaces (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  surface_type text NOT NULL,
  name text,
  units text DEFAULT 'ft'::text,
  coordinate_mesh jsonb NOT NULL,
  spot_elevations jsonb,
  created_by text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.earthwork_volumes (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  layer_name text NOT NULL,
  cut_volume_cy numeric DEFAULT 0 NOT NULL,
  fill_volume_cy numeric DEFAULT 0 NOT NULL,
  net_balance_cy numeric DEFAULT 0 NOT NULL,
  shrink_factor numeric DEFAULT 0.85 NOT NULL,
  swell_factor numeric DEFAULT 1.15 NOT NULL,
  deductions jsonb,
  metadata jsonb,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  scope_type text DEFAULT 'bulk_earthwork'::text,
  material_type text,
  PRIMARY KEY (id),
  UNIQUE (project_id, layer_name)
);

-- ── misc: audit, ai audit trail, google, generated docs, cost catalog ─────
CREATE TABLE IF NOT EXISTS public.audit_logs (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  tenant_id uuid NOT NULL,
  user_id text,
  action_type text NOT NULL,
  table_name text NOT NULL,
  record_id text NOT NULL,
  old_values jsonb,
  new_values jsonb,
  created_at timestamp with time zone DEFAULT now(),
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.ai_agent_audit_trails (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  tenant_id uuid NOT NULL,
  project_id uuid,
  document_id text,
  page_id uuid,
  agent_name text NOT NULL,
  execution_trigger text NOT NULL,
  finding_summary text NOT NULL,
  recommendations jsonb DEFAULT '{}'::jsonb NOT NULL,
  severity text DEFAULT 'info'::text NOT NULL,
  status text DEFAULT 'pending_human_review'::text NOT NULL,
  reviewed_by text,
  reviewed_at timestamp with time zone,
  applied_result jsonb,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.google_connections (
  id uuid DEFAULT uuid_generate_v4() NOT NULL,
  tenant_id uuid NOT NULL,
  user_id text NOT NULL,
  email text,
  refresh_token text NOT NULL,
  access_token text,
  access_expires_at timestamp with time zone,
  scopes text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  PRIMARY KEY (id),
  UNIQUE (tenant_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.generated_documents (
  id uuid DEFAULT uuid_generate_v4() NOT NULL,
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  doc_type text NOT NULL,
  title text NOT NULL,
  content text NOT NULL,
  provider text,
  meta jsonb DEFAULT '{}'::jsonb NOT NULL,
  created_by text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.cost_catalog (
  id uuid DEFAULT uuid_generate_v4() NOT NULL,
  tenant_id uuid NOT NULL,
  csi_code text,
  description text NOT NULL,
  trade text,
  uom text,
  unit_cost numeric(18,4) DEFAULT 0 NOT NULL,
  category text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  PRIMARY KEY (id)
);

-- This function is referenced by policies in
-- 20260706_rls_profiles_and_catalog.sql, which sorts before the migration
-- that historically defined it. A fresh replay therefore needs the
-- authoritative definition in the foundational baseline.
CREATE OR REPLACE FUNCTION public.current_tenant_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT t.id
  FROM public.tenants t
  WHERE t.clerk_org_id = (auth.jwt() ->> 'org_id')
  LIMIT 1;
$$;

-- These production functions were historically created out-of-band, but
-- tracked security migrations alter/revoke them before the later phantom-
-- object reconciliation migration runs. Define them here so a zero-to-
-- current replay has the same prerequisites as production.
CREATE OR REPLACE FUNCTION public._set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

CREATE OR REPLACE FUNCTION public.match_chunks(
  query_embedding vector,
  match_tenant_id uuid,
  match_project_id uuid,
  match_count integer DEFAULT 5
)
RETURNS TABLE(content text, document_id uuid, page_number integer, similarity double precision)
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  RETURN QUERY
  SELECT c.content, c.document_id::uuid, c.page_number,
         1 - (c.embedding <=> query_embedding) AS similarity
  FROM public.chunks c
  WHERE c.tenant_id = match_tenant_id AND c.project_id = match_project_id
  ORDER BY c.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.match_chunks(
  query_embedding vector,
  match_tenant_id uuid,
  match_project_id uuid,
  query_text text DEFAULT ''::text,
  match_count integer DEFAULT 6,
  rrf_k integer DEFAULT 60
)
RETURNS TABLE(content text, document_id uuid, page_number integer, similarity double precision, rrf_score double precision)
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  use_hybrid boolean := query_text IS NOT NULL AND length(trim(query_text)) > 0;
BEGIN
  IF use_hybrid THEN
    RETURN QUERY
    WITH vector_ranked AS (
      SELECT c.id, c.content, c.document_id, c.page_number,
             1 - (c.embedding <=> query_embedding) AS sim,
             ROW_NUMBER() OVER (ORDER BY c.embedding <=> query_embedding) AS vec_rank
      FROM public.chunks c
      WHERE c.tenant_id = match_tenant_id AND c.project_id = match_project_id
      ORDER BY c.embedding <=> query_embedding
      LIMIT match_count * 4
    ), keyword_ranked AS (
      SELECT c.id,
             ROW_NUMBER() OVER (ORDER BY ts_rank_cd(c.fts, websearch_to_tsquery('english', query_text)) DESC) AS kw_rank
      FROM public.chunks c
      WHERE c.tenant_id = match_tenant_id
        AND c.project_id = match_project_id
        AND c.fts @@ websearch_to_tsquery('english', query_text)
      LIMIT match_count * 4
    )
    SELECT vr.content, vr.document_id::uuid, vr.page_number, vr.sim,
           COALESCE(1.0 / (rrf_k + vr.vec_rank), 0) + COALESCE(1.0 / (rrf_k + kr.kw_rank), 0)
    FROM vector_ranked vr
    LEFT JOIN keyword_ranked kr ON kr.id = vr.id
    ORDER BY 5 DESC
    LIMIT match_count;
  ELSE
    RETURN QUERY
    SELECT c.content, c.document_id::uuid, c.page_number,
           1 - (c.embedding <=> query_embedding),
           1.0 / (rrf_k + ROW_NUMBER() OVER (ORDER BY c.embedding <=> query_embedding))
    FROM public.chunks c
    WHERE c.tenant_id = match_tenant_id AND c.project_id = match_project_id
    ORDER BY c.embedding <=> query_embedding
    LIMIT match_count;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.rls_auto_enable()
RETURNS event_trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT * FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table', 'partitioned table')
  LOOP
    IF cmd.schema_name = 'public' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
      EXCEPTION WHEN OTHERS THEN
        RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
    END IF;
  END LOOP;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM anon, authenticated, PUBLIC;
DROP EVENT TRIGGER IF EXISTS ensure_rls;
CREATE EVENT TRIGGER ensure_rls ON ddl_command_end EXECUTE FUNCTION public.rls_auto_enable();

-- ── Enable RLS on every baseline table (confirmed via pg_class.relrowsecurity
-- against production: all 40 have RLS enabled, no exceptions). Policies for
-- these tables are added by later tracked migrations (rls_tenant_isolation,
-- backfill_rls_policies, etc.) which only issue FORCE ROW LEVEL SECURITY —
-- they assume ENABLE already happened via the rls_auto_enable() event
-- trigger, which doesn't exist yet at this point in a from-scratch replay
-- (it's installed in the closing migration, after tables it needs to watch
-- already exist). Enabling explicitly here closes that ordering gap —
-- caught by the branch's security advisor reporting "policy exists, RLS
-- disabled" on every one of these tables after a full replay.
DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'tenants','companies','roles','company_users','projects','documents','pages','sheets',
    'sheet_corrections','chunks','document_intelligence','document_processing_events','memories',
    'conversations','messages','takeoff_items','estimate_items','change_order_items','rfi_items',
    'submittal_items','punch_list_items','permit_items','procurement_items','daily_logs',
    'schedule_tasks','contacts','project_notes','project_events','project_risk_digests',
    'civil_construction_entrances','civil_material_ledger','civil_pipe_runs','civil_stockpiles',
    'civil_surfaces','earthwork_volumes','audit_logs','ai_agent_audit_trails','google_connections',
    'generated_documents','cost_catalog'
  ]
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', tbl);
  END LOOP;
END $$;
