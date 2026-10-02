-- Material vendors, equipment suppliers, project staff (idempotent)

-- material_vendors
CREATE TABLE IF NOT EXISTS material_vendors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE material_vendors ADD COLUMN IF NOT EXISTS name text NOT NULL;
ALTER TABLE material_vendors ADD COLUMN IF NOT EXISTS category text;
ALTER TABLE material_vendors ADD COLUMN IF NOT EXISTS contact_name text;
ALTER TABLE material_vendors ADD COLUMN IF NOT EXISTS contact_email text;
ALTER TABLE material_vendors ADD COLUMN IF NOT EXISTS contact_phone text;
ALTER TABLE material_vendors ADD COLUMN IF NOT EXISTS unit_price numeric;
ALTER TABLE material_vendors ADD COLUMN IF NOT EXISTS unit text;
ALTER TABLE material_vendors ADD COLUMN IF NOT EXISTS lead_time_days int;
ALTER TABLE material_vendors ADD COLUMN IF NOT EXISTS notes text;
CREATE INDEX IF NOT EXISTS idx_material_vendors_tenant_project ON material_vendors(tenant_id, project_id);

-- equipment_suppliers
CREATE TABLE IF NOT EXISTS equipment_suppliers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE equipment_suppliers ADD COLUMN IF NOT EXISTS name text NOT NULL;
ALTER TABLE equipment_suppliers ADD COLUMN IF NOT EXISTS equipment_type text;
ALTER TABLE equipment_suppliers ADD COLUMN IF NOT EXISTS daily_rate numeric;
ALTER TABLE equipment_suppliers ADD COLUMN IF NOT EXISTS weekly_rate numeric;
ALTER TABLE equipment_suppliers ADD COLUMN IF NOT EXISTS monthly_rate numeric;
ALTER TABLE equipment_suppliers ADD COLUMN IF NOT EXISTS on_site_date date;
ALTER TABLE equipment_suppliers ADD COLUMN IF NOT EXISTS return_date date;
ALTER TABLE equipment_suppliers ADD COLUMN IF NOT EXISTS operator text;
ALTER TABLE equipment_suppliers ADD COLUMN IF NOT EXISTS status text DEFAULT 'rented';
ALTER TABLE equipment_suppliers ADD COLUMN IF NOT EXISTS notes text;
CREATE INDEX IF NOT EXISTS idx_equipment_suppliers_tenant_project ON equipment_suppliers(tenant_id, project_id);

-- staff_members
CREATE TABLE IF NOT EXISTS staff_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE staff_members ADD COLUMN IF NOT EXISTS name text NOT NULL;
ALTER TABLE staff_members ADD COLUMN IF NOT EXISTS role text;
ALTER TABLE staff_members ADD COLUMN IF NOT EXISTS email text;
ALTER TABLE staff_members ADD COLUMN IF NOT EXISTS phone text;
ALTER TABLE staff_members ADD COLUMN IF NOT EXISTS hourly_rate numeric;
ALTER TABLE staff_members ADD COLUMN IF NOT EXISTS project_role text;
ALTER TABLE staff_members ADD COLUMN IF NOT EXISTS certifications text[];
ALTER TABLE staff_members ADD COLUMN IF NOT EXISTS assigned_at timestamptz DEFAULT now();
ALTER TABLE staff_members ADD COLUMN IF NOT EXISTS removed_at timestamptz;
ALTER TABLE staff_members ADD COLUMN IF NOT EXISTS notes text;
CREATE INDEX IF NOT EXISTS idx_staff_members_tenant_project ON staff_members(tenant_id, project_id);
