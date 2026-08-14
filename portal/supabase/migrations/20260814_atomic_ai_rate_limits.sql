-- Atomically consume one paid-AI request allowance. The advisory lock is
-- scoped to a tenant + route and released at transaction end, preventing a
-- burst of concurrent serverless requests from racing past the limit.
CREATE OR REPLACE FUNCTION public.consume_ai_rate_limit(
  p_tenant_id text,
  p_route text,
  p_window_ms integer,
  p_max_hits integer
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  recent_hits bigint;
BEGIN
  IF p_tenant_id IS NULL OR btrim(p_tenant_id) = ''
     OR p_route IS NULL OR btrim(p_route) = ''
     OR p_window_ms < 1000 OR p_window_ms > 86400000
     OR p_max_hits < 1 OR p_max_hits > 10000 THEN
    RAISE EXCEPTION 'Invalid rate-limit arguments';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_tenant_id || ':' || p_route, 0));

  SELECT count(*)
    INTO recent_hits
    FROM public.ai_rate_limit_hits
   WHERE tenant_id = p_tenant_id
     AND route = p_route
     AND created_at >= now() - make_interval(secs => p_window_ms / 1000.0);

  IF recent_hits >= p_max_hits THEN
    RETURN false;
  END IF;

  INSERT INTO public.ai_rate_limit_hits (tenant_id, route)
  VALUES (p_tenant_id, p_route);
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.consume_ai_rate_limit(text, text, integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.consume_ai_rate_limit(text, text, integer, integer) FROM anon;
REVOKE ALL ON FUNCTION public.consume_ai_rate_limit(text, text, integer, integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.consume_ai_rate_limit(text, text, integer, integer) TO service_role;
