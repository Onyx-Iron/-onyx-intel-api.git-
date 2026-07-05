-- Commodity-index-driven cost catalog escalation.
--
-- commodity_trend_series: latest known value per BLS PPI series we track,
-- refreshed monthly by the sync-commodity-indexes edge function.
CREATE TABLE IF NOT EXISTS public.commodity_trend_series (
  series_id    text PRIMARY KEY,
  csi_division text,
  last_value   numeric,
  updated_at   timestamptz DEFAULT now()
);

-- catalog_pricing_history: audit trail of every price the escalator engine
-- (or a human) has applied to a `cost_overrides` catalog row. `tenant_id` is
-- denormalized from cost_overrides so history rows can be tenant-scoped by
-- RLS without a join.
CREATE TABLE IF NOT EXISTS public.catalog_pricing_history (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  catalog_id          uuid NOT NULL REFERENCES public.cost_overrides(id) ON DELETE CASCADE,
  tenant_id           uuid NOT NULL,
  old_price           numeric NOT NULL,
  new_price           numeric NOT NULL,
  applied_index_delta numeric NOT NULL,
  changed_at          timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_catalog_pricing_history_catalog ON public.catalog_pricing_history(catalog_id, changed_at DESC);
CREATE INDEX IF NOT EXISTS idx_catalog_pricing_history_tenant  ON public.catalog_pricing_history(tenant_id);

-- Tenant isolation on the history log, consistent with the rest of the app's
-- RLS posture (service-role backend bypasses this; it protects every other
-- access path).
ALTER TABLE public.catalog_pricing_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.catalog_pricing_history FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_select ON public.catalog_pricing_history;
CREATE POLICY tenant_isolation_select ON public.catalog_pricing_history FOR SELECT USING (tenant_id = public.current_tenant_id());

-- commodity_trend_series has no tenant_id — it's shared market data, readable
-- by any authenticated org member; writes are reserved for the service-role
-- backend (the edge function).
ALTER TABLE public.commodity_trend_series ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.commodity_trend_series FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS catalog_read ON public.commodity_trend_series;
CREATE POLICY catalog_read ON public.commodity_trend_series FOR SELECT USING (auth.role() = 'authenticated');
