-- The Clerk foreign-data-wrapper table (named "1" from setup — holds Clerk
-- invitation data: invitation_id, identifier, identifier_type) currently
-- grants anon/authenticated full INSERT/UPDATE/DELETE/SELECT/TRUNCATE.
-- Foreign tables bypass Postgres RLS entirely, so these grants are the
-- ONLY protection — anyone with the public anon key could otherwise read
-- or destroy Clerk invitation records directly. It's genuinely used by
-- team/invite/route.ts via the service-role client, so we keep that access
-- and only strip anon/authenticated.
--
<<<<<<< HEAD
-- The FDW table is provisioned outside the migration timeline (Clerk
-- integration setup). Skip cleanly on fresh local replay when it is absent.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = '1'
  ) THEN
    RAISE NOTICE 'public."1" not present — skipping Clerk FDW grant revoke';
    RETURN;
  END IF;
  REVOKE ALL ON public."1" FROM anon, authenticated, PUBLIC;
=======
-- This FDW table is provisioned outside tracked migrations (dashboard /
-- production setup). On a fresh local stack it may not exist — skip then.
DO $$
BEGIN
  IF to_regclass('public."1"') IS NOT NULL THEN
    REVOKE ALL ON public."1" FROM anon, authenticated, PUBLIC;
  END IF;
>>>>>>> origin/main
END $$;
