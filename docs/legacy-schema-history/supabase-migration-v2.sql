-- Onyx Intel — Schema Migration v2
-- Run in: Supabase Dashboard → SQL Editor → New Query → Run
-- Adds: contacts, project_notes, estimate_items, procurement_items, punch_list_items, permit_items

-- ── Contacts ──────────────────────────────────────────────────────────────────
create table if not exists contacts (
  id          uuid primary key default uuid_generate_v4(),
  tenant_id   uuid not null references tenants(id) on delete cascade,
  project_id  uuid references projects(id) on delete cascade,
  name        text not null,
  company     text,
  role        text,
  email       text,
  phone       text,
  notes       text,
  source      text default 'manual',
  document_id text references documents(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists idx_contacts_tenant  on contacts(tenant_id);
create index if not exists idx_contacts_project on contacts(project_id);

-- ── Project Notes ─────────────────────────────────────────────────────────────
create table if not exists project_notes (
  id          uuid primary key default uuid_generate_v4(),
  tenant_id   uuid not null references tenants(id) on delete cascade,
  project_id  uuid not null references projects(id) on delete cascade,
  content     text not null default '',
  updated_by  text,
  updated_at  timestamptz not null default now(),
  unique (project_id)
);
create index if not exists idx_notes_tenant  on project_notes(tenant_id);
create index if not exists idx_notes_project on project_notes(project_id);

-- ── Estimate Items ────────────────────────────────────────────────────────────
create table if not exists estimate_items (
  id          uuid primary key default uuid_generate_v4(),
  tenant_id   uuid not null references tenants(id) on delete cascade,
  project_id  uuid not null references projects(id) on delete cascade,
  trade       text,
  csi_code    text,
  description text not null,
  item_type   text not null default 'material'
              check (item_type in ('material','labour','equipment','subcontract')),
  quantity    numeric(18,4),
  uom         text,
  unit_cost   numeric(18,4),
  notes       text,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists idx_estimate_tenant  on estimate_items(tenant_id);
create index if not exists idx_estimate_project on estimate_items(project_id);
create index if not exists idx_estimate_csi     on estimate_items(csi_code);

-- ── Procurement Items ─────────────────────────────────────────────────────────
create table if not exists procurement_items (
  id              uuid primary key default uuid_generate_v4(),
  tenant_id       uuid not null references tenants(id) on delete cascade,
  project_id      uuid not null references projects(id) on delete cascade,
  description     text not null,
  spec_section    text,
  supplier        text,
  status          text not null default 'pending'
                  check (status in ('pending','quoted','ordered','delivered','rejected')),
  po_number       text,
  lead_time_days  integer,
  required_date   date,
  order_date      date,
  delivery_date   date,
  unit_cost       numeric(18,4),
  quantity        numeric(18,4),
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists idx_procurement_tenant  on procurement_items(tenant_id);
create index if not exists idx_procurement_project on procurement_items(project_id);

-- ── Punch List Items ──────────────────────────────────────────────────────────
create table if not exists punch_list_items (
  id             uuid primary key default uuid_generate_v4(),
  tenant_id      uuid not null references tenants(id) on delete cascade,
  project_id     uuid not null references projects(id) on delete cascade,
  item_number    integer,
  description    text not null,
  location       text,
  trade          text,
  responsible    text,
  priority       text not null default 'medium'
                 check (priority in ('low','medium','high','critical')),
  status         text not null default 'open'
                 check (status in ('open','in_progress','complete','approved')),
  due_date       date,
  sign_off       text,
  completed_date date,
  notes          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists idx_punch_tenant  on punch_list_items(tenant_id);
create index if not exists idx_punch_project on punch_list_items(project_id);

-- ── Permit Items ──────────────────────────────────────────────────────────────
create table if not exists permit_items (
  id                 uuid primary key default uuid_generate_v4(),
  tenant_id          uuid not null references tenants(id) on delete cascade,
  project_id         uuid not null references projects(id) on delete cascade,
  permit_type        text not null,
  description        text,
  authority          text,
  required           boolean not null default true,
  status             text not null default 'not_started'
                     check (status in ('not_started','submitted','approved','rejected','expired')),
  application_number text,
  permit_number      text,
  submit_date        date,
  approval_date      date,
  expiry_date        date,
  notes              text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index if not exists idx_permit_tenant  on permit_items(tenant_id);
create index if not exists idx_permit_project on permit_items(project_id);

-- ── Updated-at triggers ───────────────────────────────────────────────────────
do $$ begin
  if not exists (select 1 from pg_trigger where tgname='trg_contacts_updated_at') then
    create trigger trg_contacts_updated_at
      before update on contacts
      for each row execute function _set_updated_at();
  end if;
  if not exists (select 1 from pg_trigger where tgname='trg_estimate_updated_at') then
    create trigger trg_estimate_updated_at
      before update on estimate_items
      for each row execute function _set_updated_at();
  end if;
  if not exists (select 1 from pg_trigger where tgname='trg_procurement_updated_at') then
    create trigger trg_procurement_updated_at
      before update on procurement_items
      for each row execute function _set_updated_at();
  end if;
  if not exists (select 1 from pg_trigger where tgname='trg_punch_updated_at') then
    create trigger trg_punch_updated_at
      before update on punch_list_items
      for each row execute function _set_updated_at();
  end if;
  if not exists (select 1 from pg_trigger where tgname='trg_permit_updated_at') then
    create trigger trg_permit_updated_at
      before update on permit_items
      for each row execute function _set_updated_at();
  end if;
end $$;

-- ── Row Level Security ────────────────────────────────────────────────────────
alter table contacts          enable row level security;
alter table project_notes     enable row level security;
alter table estimate_items    enable row level security;
alter table procurement_items enable row level security;
alter table punch_list_items  enable row level security;
alter table permit_items      enable row level security;

create policy "tenant_isolation_contacts" on contacts
  for all using (tenant_id in (
    select id from tenants where clerk_org_id = current_setting('app.clerk_org_id', true)
  ));

create policy "tenant_isolation_notes" on project_notes
  for all using (tenant_id in (
    select id from tenants where clerk_org_id = current_setting('app.clerk_org_id', true)
  ));

create policy "tenant_isolation_estimate" on estimate_items
  for all using (tenant_id in (
    select id from tenants where clerk_org_id = current_setting('app.clerk_org_id', true)
  ));

create policy "tenant_isolation_procurement" on procurement_items
  for all using (tenant_id in (
    select id from tenants where clerk_org_id = current_setting('app.clerk_org_id', true)
  ));

create policy "tenant_isolation_punch" on punch_list_items
  for all using (tenant_id in (
    select id from tenants where clerk_org_id = current_setting('app.clerk_org_id', true)
  ));

create policy "tenant_isolation_permit" on permit_items
  for all using (tenant_id in (
    select id from tenants where clerk_org_id = current_setting('app.clerk_org_id', true)
  ));
