-- Cost Catalog v2: location-aware pricing with multi-source data, per-tenant
-- overrides, and actual-cost calibration capture. Additive + idempotent.

-- Master CSI MasterFormat cost code dictionary
CREATE TABLE IF NOT EXISTS cost_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  csi_code text NOT NULL UNIQUE,
  division text NOT NULL,
  description text NOT NULL,
  uom text,
  trade text,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

-- Regional pricing observations (BLS / DOT / OCE / RSMeans / seed)
CREATE TABLE IF NOT EXISTS cost_prices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cost_code_id uuid NOT NULL REFERENCES cost_codes(id) ON DELETE CASCADE,
  source text NOT NULL,
  region_type text NOT NULL,
  region_code text NOT NULL,
  unit_cost numeric NOT NULL,
  labor_cost numeric,
  material_cost numeric,
  equipment_cost numeric,
  currency text DEFAULT 'USD',
  observed_at date NOT NULL,
  valid_until date,
  meta jsonb,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cost_prices_lookup
  ON cost_prices(cost_code_id, region_type, region_code, observed_at DESC);
CREATE INDEX IF NOT EXISTS idx_cost_prices_source
  ON cost_prices(source, observed_at DESC);

-- Per-tenant price overrides
CREATE TABLE IF NOT EXISTS cost_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  cost_code_id uuid NOT NULL REFERENCES cost_codes(id) ON DELETE CASCADE,
  region_code text,
  unit_cost numeric NOT NULL,
  labor_cost numeric,
  material_cost numeric,
  equipment_cost numeric,
  notes text,
  effective_from date DEFAULT (now()::date),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_cost_overrides_tenant_code_region
  ON cost_overrides(tenant_id, cost_code_id, COALESCE(region_code, ''));

-- Regional indices (BLS PPI, ENR CCI, RSMeans LCI)
CREATE TABLE IF NOT EXISTS cost_indices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source text NOT NULL,
  series_code text NOT NULL,
  division text,
  region_code text NOT NULL,
  index_value numeric NOT NULL,
  base_value numeric,
  observed_at date NOT NULL,
  meta jsonb,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cost_indices_lookup
  ON cost_indices(source, series_code, observed_at DESC);

-- Actual cost observations from closed-out projects (calibration data)
CREATE TABLE IF NOT EXISTS cost_actuals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  cost_code_id uuid REFERENCES cost_codes(id) ON DELETE SET NULL,
  csi_code text,
  region_code text,
  estimated_unit_cost numeric,
  actual_unit_cost numeric NOT NULL,
  quantity numeric,
  variance_pct numeric GENERATED ALWAYS AS (
    CASE WHEN estimated_unit_cost > 0
      THEN (actual_unit_cost - estimated_unit_cost) / estimated_unit_cost * 100
      ELSE NULL END
  ) STORED,
  observed_at date NOT NULL,
  source text,
  notes text,
  meta jsonb,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cost_actuals_tenant_code
  ON cost_actuals(tenant_id, csi_code, observed_at DESC);

-- Location columns on projects for location-aware resolution
ALTER TABLE projects ADD COLUMN IF NOT EXISTS zip_code text;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS latitude numeric;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS longitude numeric;
