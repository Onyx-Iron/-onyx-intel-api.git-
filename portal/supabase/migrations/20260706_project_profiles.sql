-- Operational role mapping: which role a given Clerk user holds within a
-- tenant workspace. Distinct from `staff_members` (HR/field-roster data) —
-- this table drives auth/permission checks and UI view-state gating.
CREATE TABLE IF NOT EXISTS public.project_profiles (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  clerk_user_id  text NOT NULL,
  role           text NOT NULL DEFAULT 'Estimator'
                 CHECK (role IN ('Owner', 'Admin', 'Estimator', 'ProjectManager', 'FieldSuperintendent', 'Subcontractor', 'ClientView')),
  created_at     timestamptz DEFAULT now(),
  updated_at     timestamptz DEFAULT now(),
  UNIQUE (tenant_id, clerk_user_id)
);
CREATE INDEX IF NOT EXISTS idx_project_profiles_tenant ON public.project_profiles(tenant_id);
