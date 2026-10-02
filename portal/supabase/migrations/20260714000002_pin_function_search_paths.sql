-- Security advisor: mutable search_path on SECURITY DEFINER / trigger
-- functions is an injection-adjacent risk. Pin search_path where the
-- function already exists at this point in the replay timeline.
--
-- `_set_updated_at`, `set_updated_at`, and both `match_chunks` overloads are
-- created later in `20260812000000_baseline_foreign_keys_functions_and_triggers.sql`
-- (already with `SET search_path = public` on CREATE). Altering them here
-- fails a fresh `supabase start` with SQLSTATE 42883.
ALTER FUNCTION public.touch_manual_measurements_updated_at() SET search_path = public;
