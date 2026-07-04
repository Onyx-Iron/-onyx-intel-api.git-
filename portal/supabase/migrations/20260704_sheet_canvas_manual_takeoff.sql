-- Sheet Canvas + Manual Takeoff schema
-- Companion to the client at /dashboard/projects/[id]/takeoff/canvas.

CREATE TABLE IF NOT EXISTS sheet_calibrations (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL,
  page_id      uuid NOT NULL REFERENCES document_pages(id) ON DELETE CASCADE,
  scale_ratio  numeric NOT NULL,        -- real-units-per-canvas-pixel
  unit_type    text NOT NULL DEFAULT 'LF',
  created_by   text,
  created_at   timestamptz DEFAULT now(),
  updated_at   timestamptz DEFAULT now(),
  UNIQUE (page_id)
);
CREATE INDEX IF NOT EXISTS idx_sheet_calibrations_tenant ON sheet_calibrations(tenant_id);

CREATE TABLE IF NOT EXISTS manual_takeoffs (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL,
  project_id   uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  page_id      uuid REFERENCES document_pages(id) ON DELETE SET NULL,
  cost_code    text,                    -- NN-NN-NN validated at API layer
  takeoff_type text NOT NULL,           -- count | length | area
  quantity     numeric NOT NULL,
  unit         text,                    -- EA | LF | SF
  geometry     jsonb NOT NULL,          -- { points: [{x,y}, ...], page_number }
  created_by   text,
  created_at   timestamptz DEFAULT now(),
  updated_at   timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_manual_takeoffs_project ON manual_takeoffs(project_id);
CREATE INDEX IF NOT EXISTS idx_manual_takeoffs_page ON manual_takeoffs(page_id);
CREATE INDEX IF NOT EXISTS idx_manual_takeoffs_tenant ON manual_takeoffs(tenant_id);
