-- Advisor flagged the new prune_ai_rate_limit_hits() (added with the AI rate
-- limiting migration) as having a mutable search_path, same class of issue
-- fixed for the other functions in 20260714_pin_function_search_paths.sql.
ALTER FUNCTION public.prune_ai_rate_limit_hits(interval) SET search_path = public;
