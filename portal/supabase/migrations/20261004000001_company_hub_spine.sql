-- Company Hub spine: OAuth connections for non-Google providers + tenant presence.
-- Google remains in google_connections; this table covers dropbox/sharefile/meta/gbp/gsc/linkedin.

create table if not exists public.tenant_connections (
  id                      uuid primary key default gen_random_uuid(),
  tenant_id               uuid not null references public.tenants(id) on delete cascade,
  user_id                 text not null,
  provider                text not null
                          check (provider in (
                            'dropbox', 'sharefile', 'meta', 'gbp', 'gsc', 'linkedin'
                          )),
  access_token            text,
  refresh_token           text,
  access_expires_at       timestamptz,
  scopes                  text,
  external_account_label  text,
  external_account_id     text,
  status                  text not null default 'connected'
                          check (status in ('connected', 'error', 'revoked', 'pending')),
  status_detail           text,
  meta                    jsonb not null default '{}'::jsonb,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  unique (tenant_id, user_id, provider)
);

create index if not exists idx_tenant_connections_tenant
  on public.tenant_connections(tenant_id);

create index if not exists idx_tenant_connections_provider
  on public.tenant_connections(tenant_id, provider);

alter table public.tenant_connections enable row level security;

drop policy if exists tenant_connections_service_role_all on public.tenant_connections;
create policy tenant_connections_service_role_all
  on public.tenant_connections
  for all
  to service_role
  using (true)
  with check (true);

revoke all on table public.tenant_connections from anon, authenticated;
grant select, insert, update, delete on table public.tenant_connections to service_role;

-- Per-tenant public presence / SEO settings (website, social URLs, IndexNow, schema).
create table if not exists public.tenant_presence (
  tenant_id               uuid primary key references public.tenants(id) on delete cascade,
  website_url             text,
  sitemap_url             text,
  linkedin_url            text,
  facebook_page_id        text,
  instagram_business_id   text,
  gbp_location_name       text,
  indexnow_key            text,
  organization_jsonld     jsonb not null default '{}'::jsonb,
  service_areas           jsonb not null default '[]'::jsonb,
  llms_txt_blurb          text,
  auto_ingest_plan_email  boolean not null default false,
  linkedin_org_posting_enabled boolean not null default false,
  meta                    jsonb not null default '{}'::jsonb,
  updated_at              timestamptz not null default now(),
  created_at              timestamptz not null default now()
);

alter table public.tenant_presence enable row level security;

drop policy if exists tenant_presence_service_role_all on public.tenant_presence;
create policy tenant_presence_service_role_all
  on public.tenant_presence
  for all
  to service_role
  using (true)
  with check (true);

revoke all on table public.tenant_presence from anon, authenticated;
grant select, insert, update, delete on table public.tenant_presence to service_role;
