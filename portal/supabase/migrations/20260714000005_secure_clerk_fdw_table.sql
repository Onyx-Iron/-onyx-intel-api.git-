-- The Clerk foreign-data-wrapper table (named "1" from setup — holds Clerk
-- invitation data: invitation_id, identifier, identifier_type) currently
-- grants anon/authenticated full INSERT/UPDATE/DELETE/SELECT/TRUNCATE.
-- Foreign tables bypass Postgres RLS entirely, so these grants are the
-- ONLY protection — anyone with the public anon key could otherwise read
-- or destroy Clerk invitation records directly. It's genuinely used by
-- team/invite/route.ts via the service-role client, so we keep that access
-- and only strip anon/authenticated.
-- The Clerk FDW table is created out of band. A fresh replay has no
-- public."1", so only revoke when that relation is already present.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = '1'
  ) THEN
    EXECUTE 'REVOKE ALL ON public."1" FROM anon, authenticated, PUBLIC';
  END IF;
END $$;
