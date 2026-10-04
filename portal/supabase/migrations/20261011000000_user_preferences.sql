-- Per-user preferences within a tenant. First-run checklist syncs across devices.
CREATE TABLE IF NOT EXISTS public.user_preferences (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  clerk_user_id  text NOT NULL,
  first_run      jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, clerk_user_id)
);

CREATE INDEX IF NOT EXISTS idx_user_preferences_tenant ON public.user_preferences(tenant_id);

ALTER TABLE public.user_preferences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_select ON public.user_preferences;
DROP POLICY IF EXISTS tenant_isolation_insert ON public.user_preferences;
DROP POLICY IF EXISTS tenant_isolation_update ON public.user_preferences;
DROP POLICY IF EXISTS tenant_isolation_delete ON public.user_preferences;

CREATE POLICY tenant_isolation_select ON public.user_preferences
  FOR SELECT USING (tenant_id = public.current_tenant_id());
CREATE POLICY tenant_isolation_insert ON public.user_preferences
  FOR INSERT WITH CHECK (tenant_id = public.current_tenant_id());
CREATE POLICY tenant_isolation_update ON public.user_preferences
  FOR UPDATE USING (tenant_id = public.current_tenant_id())
  WITH CHECK (tenant_id = public.current_tenant_id());
CREATE POLICY tenant_isolation_delete ON public.user_preferences
  FOR DELETE USING (tenant_id = public.current_tenant_id());
