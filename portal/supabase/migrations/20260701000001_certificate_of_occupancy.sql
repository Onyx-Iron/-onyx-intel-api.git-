-- Certificate of Occupancy inspections (idempotent)

CREATE TABLE IF NOT EXISTS co_inspections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE co_inspections ADD COLUMN IF NOT EXISTS inspection_type text NOT NULL DEFAULT 'building';
ALTER TABLE co_inspections ADD COLUMN IF NOT EXISTS scheduled_date date;
ALTER TABLE co_inspections ADD COLUMN IF NOT EXISTS inspector_name text;
ALTER TABLE co_inspections ADD COLUMN IF NOT EXISTS inspector_phone text;
ALTER TABLE co_inspections ADD COLUMN IF NOT EXISTS inspector_email text;
ALTER TABLE co_inspections ADD COLUMN IF NOT EXISTS status text DEFAULT 'scheduled';
ALTER TABLE co_inspections ADD COLUMN IF NOT EXISTS result_date date;
ALTER TABLE co_inspections ADD COLUMN IF NOT EXISTS corrective_actions text;
ALTER TABLE co_inspections ADD COLUMN IF NOT EXISTS certificate_number text;
ALTER TABLE co_inspections ADD COLUMN IF NOT EXISTS certificate_issued_date date;
ALTER TABLE co_inspections ADD COLUMN IF NOT EXISTS certificate_type text;
ALTER TABLE co_inspections ADD COLUMN IF NOT EXISTS document_id uuid;
ALTER TABLE co_inspections ADD COLUMN IF NOT EXISTS notes text;

CREATE INDEX IF NOT EXISTS idx_co_inspections_tenant_project ON co_inspections(tenant_id, project_id);
CREATE INDEX IF NOT EXISTS idx_co_inspections_status ON co_inspections(tenant_id, project_id, status);
