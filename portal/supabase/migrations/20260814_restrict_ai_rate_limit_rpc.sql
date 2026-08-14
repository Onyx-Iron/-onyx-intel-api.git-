-- Supabase can provision explicit function grants for API roles at creation
-- time. Remove those grants so only trusted server code can consume limits.
REVOKE ALL ON FUNCTION public.consume_ai_rate_limit(text, text, integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.consume_ai_rate_limit(text, text, integer, integer) FROM anon;
REVOKE ALL ON FUNCTION public.consume_ai_rate_limit(text, text, integer, integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.consume_ai_rate_limit(text, text, integer, integer) TO service_role;
