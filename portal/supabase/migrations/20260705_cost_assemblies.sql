-- Composite trade assembly groups (e.g. "6-inch concrete paving w/ rebar")
-- A cost_assembly is a catalog entry with a variable_schema describing the
-- inputs an estimator fills in (thickness, mix design, rebar spacing, etc).
-- Each assembly_component is one derived material/labor line, computed from
-- a formula_expression evaluated against those variables at insert time.
CREATE TABLE IF NOT EXISTS public.cost_assemblies (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  csi_code        text NOT NULL,
  assembly_name   text NOT NULL,
  variable_schema jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_cost_assemblies_csi ON public.cost_assemblies(csi_code);

CREATE TABLE IF NOT EXISTS public.assembly_components (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assembly_id        uuid NOT NULL REFERENCES public.cost_assemblies(id) ON DELETE CASCADE,
  item_type          text NOT NULL,
  formula_expression text NOT NULL,
  cost_code_ref      text,
  sort_order         integer DEFAULT 0,
  created_at         timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_assembly_components_assembly ON public.assembly_components(assembly_id, sort_order);
