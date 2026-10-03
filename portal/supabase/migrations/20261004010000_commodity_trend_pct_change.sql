-- Persist the 90-day PPI percent change on commodity_trend_series so
-- resolveCost can age stale regional/national catalog prices at read time.
-- Previously only last_value was stored and the monthly Edge job only
-- mutated cost_overrides (often empty), so estimators never saw PPI.

ALTER TABLE public.commodity_trend_series
  ADD COLUMN IF NOT EXISTS pct_change_90d numeric;

COMMENT ON COLUMN public.commodity_trend_series.pct_change_90d IS
  'Approximate 90-day (3 monthly BLS periods) percent change; applied at resolve time to stale catalog prices.';
