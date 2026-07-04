-- Estimation pricing matrix + schedule of values
CREATE TABLE IF NOT EXISTS project_estimates (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL,
  project_id        uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  takeoff_id        uuid,
  source            text,
  cost_code         text,
  description       text,
  quantity          numeric NOT NULL DEFAULT 0,
  unit              text,
  labor_unit        numeric DEFAULT 0,
  material_unit     numeric DEFAULT 0,
  equipment_unit    numeric DEFAULT 0,
  subcontractor_unit numeric DEFAULT 0,
  trucking_unit     numeric DEFAULT 0,
  disposal_unit     numeric DEFAULT 0,
  notes             text,
  sort_order        integer DEFAULT 0,
  created_at        timestamptz DEFAULT now(),
  updated_at        timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_project_estimates_project ON project_estimates(project_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_project_estimates_tenant  ON project_estimates(tenant_id);

CREATE TABLE IF NOT EXISTS project_financial_settings (
  project_id      uuid PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  tenant_id       uuid NOT NULL,
  overhead_pct    numeric DEFAULT 10,
  profit_pct      numeric DEFAULT 15,
  contingency_pct numeric DEFAULT 5,
  updated_at      timestamptz DEFAULT now()
);
