-- Cut/fill earthwork surfaces and computations (idempotent)

CREATE TABLE IF NOT EXISTS cut_fill_surfaces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  uploaded_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE cut_fill_surfaces ADD COLUMN IF NOT EXISTS name text NOT NULL;
ALTER TABLE cut_fill_surfaces ADD COLUMN IF NOT EXISTS type text NOT NULL;
ALTER TABLE cut_fill_surfaces ADD COLUMN IF NOT EXISTS points jsonb NOT NULL;
ALTER TABLE cut_fill_surfaces ADD COLUMN IF NOT EXISTS bounds jsonb;
ALTER TABLE cut_fill_surfaces ADD COLUMN IF NOT EXISTS point_count int;
CREATE INDEX IF NOT EXISTS idx_cut_fill_surfaces_tenant_project ON cut_fill_surfaces(tenant_id, project_id);

CREATE TABLE IF NOT EXISTS cut_fill_computations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  computed_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE cut_fill_computations ADD COLUMN IF NOT EXISTS existing_surface_id uuid;
ALTER TABLE cut_fill_computations ADD COLUMN IF NOT EXISTS proposed_surface_id uuid;
ALTER TABLE cut_fill_computations ADD COLUMN IF NOT EXISTS grid_resolution_ft numeric;
ALTER TABLE cut_fill_computations ADD COLUMN IF NOT EXISTS cut_volume_cy numeric;
ALTER TABLE cut_fill_computations ADD COLUMN IF NOT EXISTS fill_volume_cy numeric;
ALTER TABLE cut_fill_computations ADD COLUMN IF NOT EXISTS net_volume_cy numeric;
ALTER TABLE cut_fill_computations ADD COLUMN IF NOT EXISTS grid jsonb;
CREATE INDEX IF NOT EXISTS idx_cut_fill_computations_tenant_project ON cut_fill_computations(tenant_id, project_id);
