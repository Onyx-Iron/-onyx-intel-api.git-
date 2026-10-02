<<<<<<< HEAD
-- Security advisor: mutable search_path on SECURITY DEFINER / trigger
-- functions is an injection-adjacent risk. Pin search_path where the
-- function already exists at this point in the replay timeline.
--
-- `_set_updated_at`, `set_updated_at`, and both `match_chunks` overloads are
-- created later in `20260812000000_baseline_foreign_keys_functions_and_triggers.sql`
-- (already with `SET search_path = public` on CREATE). Altering them here
-- fails a fresh `supabase start` with SQLSTATE 42883.
ALTER FUNCTION public.touch_manual_measurements_updated_at() SET search_path = public;
=======
-- Security advisor: mutable search_path on these functions is an
-- injection-adjacent risk (a caller could manipulate search_path to shadow
-- objects the function references with malicious ones). Pinning
-- search_path doesn't change behavior — it just fixes schema resolution.
--
-- On production these functions already existed when this migration first
-- ran. On a fresh stack several are created later by
-- 20260812000000_baseline_foreign_keys_functions_and_triggers.sql (already
-- with search_path pinned). Skip any that are not present yet so
-- `supabase start` / `db push --local` can replay cleanly.

DO $$
BEGIN
  ALTER FUNCTION public._set_updated_at() SET search_path = public;
EXCEPTION
  WHEN undefined_function THEN NULL;
END $$;

DO $$
BEGIN
  ALTER FUNCTION public.set_updated_at() SET search_path = public;
EXCEPTION
  WHEN undefined_function THEN NULL;
END $$;

DO $$
BEGIN
  ALTER FUNCTION public.touch_manual_measurements_updated_at() SET search_path = public;
EXCEPTION
  WHEN undefined_function THEN NULL;
END $$;

DO $$
BEGIN
  ALTER FUNCTION public.match_chunks(vector, uuid, uuid, integer) SET search_path = public;
EXCEPTION
  WHEN undefined_function THEN NULL;
END $$;

DO $$
BEGIN
  ALTER FUNCTION public.match_chunks(vector, uuid, uuid, text, integer, integer) SET search_path = public;
EXCEPTION
  WHEN undefined_function THEN NULL;
END $$;
>>>>>>> origin/main
