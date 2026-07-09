-- Per-tenant rate limiting for the routes that trigger expensive LLM calls
-- (full-document vision extraction, document Q&A, agent chat). None of these
-- had any request throttle — an authenticated user could loop them and run
-- up an unbounded provider bill. A plain counted-rows table (rather than
-- Redis/Upstash, which isn't provisioned for this project) works fine here
-- since it's just a coarse per-minute ceiling, not a precision limiter.
-- tenant_id is TEXT, not uuid: most routes resolve a real tenants.id uuid via
-- getOrCreateTenant() first, but a couple of AI-calling routes (e.g.
-- takeoff/extract's ai_fallback path) only have the raw Clerk-derived tenant
-- key (`org_<id>` / `user_<id>`) at the point the rate limit needs checking.
-- This table is just a rate-limit bucket key, not a foreign key relation, so
-- text keeps it usable from either call site without forcing an extra tenant
-- lookup purely to satisfy a column type.
CREATE TABLE IF NOT EXISTS ai_rate_limit_hits (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  text NOT NULL,
  route      text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_rate_limit_hits_lookup
  ON ai_rate_limit_hits(tenant_id, route, created_at DESC);

-- Old rows are pure noise once outside any real rate-limit window; keep the
-- table small with a periodic prune helper (call from a scheduled function
-- if desired — not required for correctness, since lookups always filter by
-- created_at, only for table bloat).
CREATE OR REPLACE FUNCTION public.prune_ai_rate_limit_hits(older_than interval DEFAULT interval '1 day')
RETURNS void
LANGUAGE sql
AS $$
  DELETE FROM public.ai_rate_limit_hits WHERE created_at < now() - older_than;
$$;

ALTER TABLE ai_rate_limit_hits ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_rate_limit_hits FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_select ON ai_rate_limit_hits;
CREATE POLICY tenant_isolation_select ON ai_rate_limit_hits
  FOR SELECT USING (tenant_id = public.current_tenant_id()::text);
