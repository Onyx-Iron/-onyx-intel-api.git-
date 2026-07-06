-- Security advisor flagged 76 tables exposed to anon AND authenticated via
-- pg_graphql/PostgREST default grants — including companies, contacts,
-- invoices, tenants, roles, audit_logs. Every data access path in this app
-- goes through the service-role backend (confirmed: no call site anywhere
-- uses the anon-key client for table queries) — RLS-enabled-with-policies
-- is a defense-in-depth backstop, but the underlying table grants
-- themselves should not exist for roles this app never uses to query data.
-- Revoke everything from anon/authenticated across the whole public schema,
-- and set default privileges so newly created tables don't silently regain
-- these grants going forward.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated;

-- Re-grant SELECT only on the tables whose RLS policies explicitly rely on
-- being queryable by the "authenticated" role (catalog tables + the ones
-- with authenticated-scoped read policies added this session).
GRANT SELECT ON public.cost_codes, public.cost_indices, public.cost_prices,
  public.cost_assemblies, public.assembly_components, public.commodity_trend_series,
  public.tenants
  TO authenticated;
