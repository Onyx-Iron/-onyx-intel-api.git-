-- High-frequency transient outbox staging (UNLOGGED).
-- ---------------------------------------------------------------------------
-- Durable `estimate_sync_outbox` stays LOGGED (crash-safe, re-driveable).
-- This UNLOGGED staging table absorbs bursty canvas/edit fan-out without
-- writing WAL for every intermediate event — up to ~50% less disk I/O on
-- the hot path. Rows are promoted into the durable outbox by
-- `promote_outbox_staging()` (cron / worker). UNLOGGED contents are
-- discarded on a hard crash; only un-promoted staging is at risk.

CREATE UNLOGGED TABLE IF NOT EXISTS public.estimate_sync_outbox_staging (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL,
  project_id        uuid NOT NULL,
  manual_takeoff_id uuid,
  event_type        text NOT NULL CHECK (event_type IN ('upsert', 'delete', 'project_sync')),
  payload           jsonb,
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT estimate_sync_outbox_staging_takeoff_required CHECK (
    (event_type = 'project_sync' AND manual_takeoff_id IS NULL)
    OR (event_type IN ('upsert', 'delete') AND manual_takeoff_id IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_outbox_staging_created
  ON public.estimate_sync_outbox_staging (created_at);

CREATE INDEX IF NOT EXISTS idx_outbox_staging_takeoff
  ON public.estimate_sync_outbox_staging (manual_takeoff_id, event_type);

ALTER TABLE public.estimate_sync_outbox_staging ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS estimate_sync_outbox_staging_service_role_only
  ON public.estimate_sync_outbox_staging;
CREATE POLICY estimate_sync_outbox_staging_service_role_only
  ON public.estimate_sync_outbox_staging
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

COMMENT ON TABLE public.estimate_sync_outbox_staging IS
  'UNLOGGED transient outbox buffer — bypasses WAL; promote to estimate_sync_outbox for durability.';

-- Contractor sub-assembly recipes (tenant-scoped expansions of cost_assemblies).
ALTER TABLE public.cost_assemblies
  ADD COLUMN IF NOT EXISTS tenant_id uuid,
  ADD COLUMN IF NOT EXISTS recipe_key text,
  ADD COLUMN IF NOT EXISTS trigger_unit text DEFAULT 'LF',
  ADD COLUMN IF NOT EXISTS description text;

CREATE UNIQUE INDEX IF NOT EXISTS idx_cost_assemblies_tenant_recipe
  ON public.cost_assemblies (tenant_id, recipe_key)
  WHERE recipe_key IS NOT NULL AND tenant_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_cost_assemblies_tenant
  ON public.cost_assemblies (tenant_id)
  WHERE tenant_id IS NOT NULL;

ALTER TABLE public.assembly_components
  ADD COLUMN IF NOT EXISTS description text,
  ADD COLUMN IF NOT EXISTS unit text DEFAULT 'EA',
  ADD COLUMN IF NOT EXISTS labor_factor numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS material_factor numeric DEFAULT 0;

-- Global seed recipes (tenant_id NULL) — pipe LF and concrete wall LF.
INSERT INTO public.cost_assemblies (id, csi_code, assembly_name, recipe_key, trigger_unit, description, variable_schema)
VALUES
  (
    'a0000000-0000-4000-8000-000000000001',
    '33-30-00',
    'Utility Pipe Run (LF)',
    'utility_pipe_lf',
    'LF',
    'Expands 1 LF of pipe into excavation, bedding, backfill, testing, and labor crew.',
    '{"driver":"quantity_lf","vars":["pipe_od_in","depth_ft"]}'::jsonb
  ),
  (
    'a0000000-0000-4000-8000-000000000002',
    '03-30-00',
    'Concrete Wall (LF)',
    'concrete_wall_lf',
    'LF',
    'Expands 1 LF of concrete wall into formwork, rebar, concrete, and curing.',
    '{"driver":"quantity_lf","vars":["height_ft","thickness_in"]}'::jsonb
  )
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.assembly_components (assembly_id, item_type, formula_expression, cost_code_ref, description, unit, sort_order, labor_factor, material_factor)
SELECT v.assembly_id, v.item_type, v.formula_expression, v.cost_code_ref, v.description, v.unit, v.sort_order, v.labor_factor, v.material_factor
FROM (VALUES
  ('a0000000-0000-4000-8000-000000000001'::uuid, 'excavation', 'qty * 0.15', '31-23-00', 'Trench excavation', 'CY', 10, 12::numeric, 0::numeric),
  ('a0000000-0000-4000-8000-000000000001'::uuid, 'bedding', 'qty * 0.05', '31-23-23', 'Pipe bedding (aggregate)', 'CY', 20, 4::numeric, 35::numeric),
  ('a0000000-0000-4000-8000-000000000001'::uuid, 'pipe', 'qty', '33-30-00', 'Pipe material', 'LF', 30, 8::numeric, 22::numeric),
  ('a0000000-0000-4000-8000-000000000001'::uuid, 'backfill', 'qty * 0.12', '31-23-00', 'Native backfill / compact', 'CY', 40, 10::numeric, 0::numeric),
  ('a0000000-0000-4000-8000-000000000001'::uuid, 'testing', 'max(1, qty / 100)', '33-01-00', 'Pressure / deflection testing', 'EA', 50, 150::numeric, 25::numeric),
  ('a0000000-0000-4000-8000-000000000001'::uuid, 'labor_crew', 'qty / 40', '01-50-00', 'Pipe crew days', 'DAY', 60, 1200::numeric, 0::numeric),
  ('a0000000-0000-4000-8000-000000000002'::uuid, 'formwork', 'qty * height_ft * 2', '03-11-00', 'Wall formwork both faces', 'SF', 10, 3.5::numeric, 1.2::numeric),
  ('a0000000-0000-4000-8000-000000000002'::uuid, 'rebar', 'qty * height_ft * thickness_in * 0.15', '03-20-00', 'Wall rebar', 'LB', 20, 0.4::numeric, 0.85::numeric),
  ('a0000000-0000-4000-8000-000000000002'::uuid, 'concrete', '(qty * height_ft * (thickness_in/12)) / 27', '03-30-00', 'Cast-in-place concrete', 'CY', 30, 25::numeric, 140::numeric),
  ('a0000000-0000-4000-8000-000000000002'::uuid, 'curing', 'qty * height_ft * 2', '03-39-00', 'Curing / protection', 'SF', 40, 0.35::numeric, 0.15::numeric)
) AS v(assembly_id, item_type, formula_expression, cost_code_ref, description, unit, sort_order, labor_factor, material_factor)
WHERE NOT EXISTS (
  SELECT 1 FROM public.assembly_components c WHERE c.assembly_id = v.assembly_id
);

-- Promote UNLOGGED staging rows into durable estimate_sync_outbox.
CREATE OR REPLACE FUNCTION public.promote_outbox_staging(p_limit integer DEFAULT 200)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer := 0;
  r record;
BEGIN
  FOR r IN
    SELECT * FROM public.estimate_sync_outbox_staging
    ORDER BY created_at
    LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 200), 2000))
    FOR UPDATE SKIP LOCKED
  LOOP
    -- Prefer upsert into existing pending row (partial unique index on
    -- manual_takeoff_id + event_type WHERE pending); else insert.
    UPDATE public.estimate_sync_outbox
    SET payload = COALESCE(r.payload, payload),
        attempts = 0,
        last_error = NULL
    WHERE manual_takeoff_id = r.manual_takeoff_id
      AND event_type = r.event_type
      AND status = 'pending';

    IF NOT FOUND THEN
      INSERT INTO public.estimate_sync_outbox (
        tenant_id, project_id, manual_takeoff_id, event_type, status, payload
      ) VALUES (
        r.tenant_id, r.project_id, r.manual_takeoff_id, r.event_type, 'pending', r.payload
      );
    END IF;

    DELETE FROM public.estimate_sync_outbox_staging WHERE id = r.id;
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.promote_outbox_staging(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.promote_outbox_staging(integer) TO service_role;

-- Fast insert into UNLOGGED staging (hot path).
CREATE OR REPLACE FUNCTION public.enqueue_outbox_staging(
  p_tenant_id uuid,
  p_project_id uuid,
  p_manual_takeoff_id uuid,
  p_event_type text,
  p_payload jsonb DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF p_event_type = 'project_sync' AND p_manual_takeoff_id IS NOT NULL THEN
    RAISE EXCEPTION 'project_sync staging rows must have null manual_takeoff_id';
  END IF;
  IF p_event_type IN ('upsert', 'delete') AND p_manual_takeoff_id IS NULL THEN
    RAISE EXCEPTION 'upsert/delete staging rows require manual_takeoff_id';
  END IF;

  INSERT INTO public.estimate_sync_outbox_staging (
    tenant_id, project_id, manual_takeoff_id, event_type, payload
  ) VALUES (
    p_tenant_id, p_project_id, p_manual_takeoff_id, p_event_type, p_payload
  )
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.enqueue_outbox_staging(uuid, uuid, uuid, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.enqueue_outbox_staging(uuid, uuid, uuid, text, jsonb) TO service_role;
