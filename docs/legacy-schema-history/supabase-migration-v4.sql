-- Onyx Intel — Schema Migration v4
-- Cost Catalog (reusable unit-price library, tenant-level — shared across projects)

create table if not exists cost_catalog (
  id          uuid primary key default uuid_generate_v4(),
  tenant_id   uuid not null references tenants(id) on delete cascade,
  csi_code    text,
  description text not null,
  trade       text,
  uom         text,
  unit_cost   numeric(18,4) not null default 0,
  category    text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists idx_costcat_tenant on cost_catalog(tenant_id);
create index if not exists idx_costcat_csi    on cost_catalog(tenant_id, csi_code);

do $$ begin
  if not exists (select 1 from pg_trigger where tgname='trg_costcat_updated_at') then
    create trigger trg_costcat_updated_at before update on cost_catalog
      for each row execute function _set_updated_at();
  end if;
end $$;

alter table cost_catalog enable row level security;

create policy "tenant_isolation_costcat" on cost_catalog
  for all using (tenant_id in (
    select id from tenants where clerk_org_id = current_setting('app.clerk_org_id', true)
  ));
