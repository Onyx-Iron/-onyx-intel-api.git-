-- Onyx Intel — Schema Migration v5
-- Google account connections (one connect → Drive/Gmail/Calendar/Docs/Sheets)

create table if not exists google_connections (
  id                  uuid primary key default uuid_generate_v4(),
  tenant_id           uuid not null references tenants(id) on delete cascade,
  user_id             text not null,                 -- clerk user id
  email               text,
  refresh_token       text not null,                 -- long-lived; used to mint access tokens
  access_token        text,
  access_expires_at   timestamptz,
  scopes              text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (tenant_id, user_id)
);
create index if not exists idx_gconn_tenant on google_connections(tenant_id);

do $$ begin
  if not exists (select 1 from pg_trigger where tgname='trg_gconn_updated_at') then
    create trigger trg_gconn_updated_at before update on google_connections
      for each row execute function _set_updated_at();
  end if;
end $$;

alter table google_connections enable row level security;

create policy "tenant_isolation_gconn" on google_connections
  for all using (tenant_id in (
    select id from tenants where clerk_org_id = current_setting('app.clerk_org_id', true)
  ));
