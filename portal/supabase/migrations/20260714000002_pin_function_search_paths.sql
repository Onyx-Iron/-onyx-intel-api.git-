-- Security advisor: mutable search_path on these 5 functions is an
-- injection-adjacent risk (a caller could manipulate search_path to shadow
-- objects the function references with malicious ones). Pinning
-- search_path doesn't change behavior — it just fixes schema resolution.
ALTER FUNCTION public._set_updated_at() SET search_path = public;
ALTER FUNCTION public.set_updated_at() SET search_path = public;
ALTER FUNCTION public.touch_manual_measurements_updated_at() SET search_path = public;
ALTER FUNCTION public.match_chunks(vector, uuid, uuid, integer) SET search_path = public;
ALTER FUNCTION public.match_chunks(vector, uuid, uuid, text, integer, integer) SET search_path = public;
