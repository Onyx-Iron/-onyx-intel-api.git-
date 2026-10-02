-- Invoicing: unified invoices table + lien waivers (idempotent)

CREATE TABLE IF NOT EXISTS invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS direction text NOT NULL DEFAULT 'receivable';
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS invoice_number text;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS vendor_or_customer text NOT NULL DEFAULT '';
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS description text;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS amount numeric NOT NULL DEFAULT 0;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS retainage numeric DEFAULT 0;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS invoice_date date;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS due_date date;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS paid_date date;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS status text DEFAULT 'open';
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS payment_method text;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS reference text;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS notes text;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'invoices_direction_chk') THEN
    ALTER TABLE invoices ADD CONSTRAINT invoices_direction_chk
      CHECK (direction IN ('receivable','payable'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'invoices_status_chk') THEN
    ALTER TABLE invoices ADD CONSTRAINT invoices_status_chk
      CHECK (status IN ('open','paid','overdue','disputed','canceled'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_invoices_tenant_project    ON invoices(tenant_id, project_id);
CREATE INDEX IF NOT EXISTS idx_invoices_direction          ON invoices(tenant_id, project_id, direction);
CREATE INDEX IF NOT EXISTS idx_invoices_status             ON invoices(tenant_id, project_id, status);
CREATE INDEX IF NOT EXISTS idx_invoices_due_date           ON invoices(tenant_id, project_id, due_date);

CREATE TABLE IF NOT EXISTS lien_waivers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE lien_waivers ADD COLUMN IF NOT EXISTS vendor_name text NOT NULL DEFAULT '';
ALTER TABLE lien_waivers ADD COLUMN IF NOT EXISTS waiver_type text NOT NULL DEFAULT 'conditional_progress';
ALTER TABLE lien_waivers ADD COLUMN IF NOT EXISTS draw_number text;
ALTER TABLE lien_waivers ADD COLUMN IF NOT EXISTS amount numeric;
ALTER TABLE lien_waivers ADD COLUMN IF NOT EXISTS through_date date;
ALTER TABLE lien_waivers ADD COLUMN IF NOT EXISTS state text;
ALTER TABLE lien_waivers ADD COLUMN IF NOT EXISTS document_id uuid;
ALTER TABLE lien_waivers ADD COLUMN IF NOT EXISTS signed_at timestamptz;
ALTER TABLE lien_waivers ADD COLUMN IF NOT EXISTS signed_by text;
ALTER TABLE lien_waivers ADD COLUMN IF NOT EXISTS status text DEFAULT 'pending';
ALTER TABLE lien_waivers ADD COLUMN IF NOT EXISTS notes text;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lien_waivers_status_chk') THEN
    ALTER TABLE lien_waivers ADD CONSTRAINT lien_waivers_status_chk
      CHECK (status IN ('pending','received','expired'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_lien_waivers_tenant_project ON lien_waivers(tenant_id, project_id);
CREATE INDEX IF NOT EXISTS idx_lien_waivers_status        ON lien_waivers(tenant_id, project_id, status);
