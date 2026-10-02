-- Onyx Intel - Schema Migration v6
-- Adds persisted project controls: RFIs, submittals, and change orders.

create table if not exists rfi_items (
  id             uuid primary key default uuid_generate_v4(),
  tenant_id      uuid not null references tenants(id) on delete cascade,
  project_id     uuid not null references projects(id) on delete cascade,
  number         text,
  subject        text not null,
  description    text,
  discipline     text,
  status         text not null default 'open'
                 check (status in ('draft','open','answered','closed','void')),
  priority       text not null default 'medium'
                 check (priority in ('low','medium','high','critical')),
  submitted_date date,
  due_date       date,
  assigned_to    text,
  response       text,
  response_date  date,
  meta           jsonb not null default '{}',
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists idx_rfi_tenant on rfi_items(tenant_id);
create index if not exists idx_rfi_project on rfi_items(project_id, created_at desc);
create index if not exists idx_rfi_status on rfi_items(project_id, status);

create table if not exists submittal_items (
  id              uuid primary key default uuid_generate_v4(),
  tenant_id       uuid not null references tenants(id) on delete cascade,
  project_id      uuid not null references projects(id) on delete cascade,
  number          text,
  spec_section    text,
  title           text not null,
  description     text,
  submittal_type  text not null default 'other'
                  check (submittal_type in ('product_data','shop_drawing','sample','mix_design','manual','other')),
  status          text not null default 'draft'
                  check (status in ('draft','submitted','under_review','approved','approved_as_noted','revise_resubmit','rejected','closed')),
  revision        text,
  submitted_date  date,
  due_date        date,
  returned_date   date,
  responsible     text,
  notes           text,
  meta            jsonb not null default '{}',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists idx_submittal_tenant on submittal_items(tenant_id);
create index if not exists idx_submittal_project on submittal_items(project_id, created_at desc);
create index if not exists idx_submittal_status on submittal_items(project_id, status);

create table if not exists change_order_items (
  id               uuid primary key default uuid_generate_v4(),
  tenant_id        uuid not null references tenants(id) on delete cascade,
  project_id       uuid not null references projects(id) on delete cascade,
  number           text,
  description      text not null,
  reason           text,
  status           text not null default 'draft'
                   check (status in ('draft','pending','approved','rejected','void')),
  trade            text,
  request_date     date,
  submitted_date   date,
  approved_date    date,
  amount           numeric(18,4),
  labor_cost       numeric(18,4),
  material_cost    numeric(18,4),
  equipment_cost   numeric(18,4),
  subcontract_cost numeric(18,4),
  markup           numeric(18,4),
  notes            text,
  meta             jsonb not null default '{}',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists idx_change_order_tenant on change_order_items(tenant_id);
create index if not exists idx_change_order_project on change_order_items(project_id, created_at desc);
create index if not exists idx_change_order_status on change_order_items(project_id, status);

do $$ begin
  if not exists (select 1 from pg_trigger where tgname='trg_rfi_updated_at') then
    create trigger trg_rfi_updated_at
      before update on rfi_items
      for each row execute function _set_updated_at();
  end if;
  if not exists (select 1 from pg_trigger where tgname='trg_submittal_updated_at') then
    create trigger trg_submittal_updated_at
      before update on submittal_items
      for each row execute function _set_updated_at();
  end if;
  if not exists (select 1 from pg_trigger where tgname='trg_change_order_updated_at') then
    create trigger trg_change_order_updated_at
      before update on change_order_items
      for each row execute function _set_updated_at();
  end if;
end $$;

alter table rfi_items enable row level security;
alter table submittal_items enable row level security;
alter table change_order_items enable row level security;

create policy "tenant_isolation_rfi" on rfi_items
  for all using (tenant_id in (
    select id from tenants where clerk_org_id = current_setting('app.clerk_org_id', true)
  ));

create policy "tenant_isolation_submittal" on submittal_items
  for all using (tenant_id in (
    select id from tenants where clerk_org_id = current_setting('app.clerk_org_id', true)
  ));

create policy "tenant_isolation_change_order" on change_order_items
  for all using (tenant_id in (
    select id from tenants where clerk_org_id = current_setting('app.clerk_org_id', true)
  ));
