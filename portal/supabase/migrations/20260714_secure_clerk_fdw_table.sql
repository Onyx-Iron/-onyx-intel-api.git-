-- The Clerk foreign-data-wrapper table (named "1" from setup — holds Clerk
-- invitation data: invitation_id, identifier, identifier_type) currently
-- grants anon/authenticated full INSERT/UPDATE/DELETE/SELECT/TRUNCATE.
-- Foreign tables bypass Postgres RLS entirely, so these grants are the
-- ONLY protection — anyone with the public anon key could otherwise read
-- or destroy Clerk invitation records directly. It's genuinely used by
-- team/invite/route.ts via the service-role client, so we keep that access
-- and only strip anon/authenticated.
REVOKE ALL ON public."1" FROM anon, authenticated, PUBLIC;
