-- Onyx Intel — Supabase Portal Schema (no PostGIS)
-- Run this in: Supabase Dashboard → SQL Editor → New Query → Run

-- ── Extensions ────────────────────────────────────────────────────────────────
create extension if not exists "uuid-ossp";

-- ── Tenants ───────────────────────────────────────────────────────────────────
create table if not exists tenants (
  id           uuid primary key default uuid_generate_v4(),
  clerk_org_id text not null unique,
  name         text not null,
  created_at   timestamptz not null default now()
);

-- ── Projects ──────────────────────────────────────────────────────────────────
create table if not exists projects (
  id          uuid primary key default uuid_generate_v4(),
  tenant_id   uuid not null references tenants(id) on delete cascade,
  name        text not null,
  address     text,
  city        text,
  state       text,
  status      text not null default 'active'
              check (status in ('active','bidding','complete','on_hold')),
  start_date  date,
  end_date    date,
  budget      numeric(18,2),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  meta        jsonb not null default '{}'
);
create index if not exists idx_projects_tenant on projects(tenant_id);
create index if not exists idx_projects_status on projects(tenant_id, status);

-- ── Documents ─────────────────────────────────────────────────────────────────
create table if not exists documents (
  id           text primary key,
  tenant_id    uuid not null references tenants(id) on delete cascade,
  project_id   uuid references projects(id) on delete set null,
  file_name    text not null,
  page_count   integer default 0,
  status       text not null default 'pending',
  uploaded_at  timestamptz not null default now(),
  processed_at timestamptz,
  meta         jsonb not null default '{}'
);
create index if not exists idx_documents_tenant  on documents(tenant_id);
create index if not exists idx_documents_project on documents(project_id);

-- ── Takeoff Items ─────────────────────────────────────────────────────────────
create table if not exists takeoff_items (
  id            uuid primary key default uuid_generate_v4(),
  tenant_id     uuid not null references tenants(id) on delete cascade,
  project_id    uuid not null references projects(id) on delete cascade,
  document_id   text references documents(id) on delete set null,
  page          integer not null,
  type          text not null check (type in ('length','area','perim','count','volume')),
  label         text,
  quantity      numeric(18,4),
  unit          text,
  rate          numeric(18,4),
  csi_code      text,
  division      text,
  points        jsonb,
  px_per_foot   numeric(12,6),
  geo_calib     jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  meta          jsonb not null default '{}'
);
create index if not exists idx_takeoff_tenant   on takeoff_items(tenant_id);
create index if not exists idx_takeoff_project  on takeoff_items(project_id);
create index if not exists idx_takeoff_document on takeoff_items(document_id);
create index if not exists idx_takeoff_csi      on takeoff_items(csi_code);

-- ── Schedule Tasks (CPM) ──────────────────────────────────────────────────────
create table if not exists schedule_tasks (
  id           uuid primary key default uuid_generate_v4(),
  tenant_id    uuid not null references tenants(id) on delete cascade,
  project_id   uuid not null references projects(id) on delete cascade,
  name         text not null,
  duration     integer not null default 1,
  deps         text[] default '{}',
  status       text not null default 'pending'
               check (status in ('pending','in_progress','complete','blocked')),
  es           integer,
  ef           integer,
  ls           integer,
  lf           integer,
  total_float  integer,
  free_float   integer,
  critical     boolean default false,
  start_date   date,
  end_date     date,
  ls_date      date,
  lf_date      date,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  meta         jsonb not null default '{}'
);
create index if not exists idx_tasks_tenant   on schedule_tasks(tenant_id);
create index if not exists idx_tasks_project  on schedule_tasks(project_id);
create index if not exists idx_tasks_critical on schedule_tasks(project_id, critical);

-- ── Document Intelligence ─────────────────────────────────────────────────────
create table if not exists document_intelligence (
  id           uuid primary key default uuid_generate_v4(),
  tenant_id    uuid not null references tenants(id) on delete cascade,
  project_id   uuid not null references projects(id) on delete cascade,
  document_id  text references documents(id) on delete cascade,
  chunk_index  integer not null,
  content      text not null,
  meta         jsonb not null default '{}'
);
create index if not exists idx_intel_tenant  on document_intelligence(tenant_id);
create index if not exists idx_intel_project on document_intelligence(project_id);

-- ── Updated-at trigger ────────────────────────────────────────────────────────
create or replace function _set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;

do $$ begin
  if not exists (select 1 from pg_trigger where tgname='trg_projects_updated_at') then
    create trigger trg_projects_updated_at
      before update on projects
      for each row execute function _set_updated_at();
  end if;
  if not exists (select 1 from pg_trigger where tgname='trg_takeoff_updated_at') then
    create trigger trg_takeoff_updated_at
      before update on takeoff_items
      for each row execute function _set_updated_at();
  end if;
  if not exists (select 1 from pg_trigger where tgname='trg_tasks_updated_at') then
    create trigger trg_tasks_updated_at
      before update on schedule_tasks
      for each row execute function _set_updated_at();
  end if;
end $$;

-- ── Row Level Security ────────────────────────────────────────────────────────
alter table tenants               enable row level security;
alter table projects              enable row level security;
alter table documents             enable row level security;
alter table takeoff_items         enable row level security;
alter table schedule_tasks        enable row level security;
alter table document_intelligence enable row level security;

create policy "tenant_isolation_projects" on projects
  for all using (
    tenant_id in (
      select id from tenants
      where clerk_org_id = current_setting('app.clerk_org_id', true)
    )
  );

create policy "tenant_isolation_documents" on documents
  for all using (
    tenant_id in (
      select id from tenants
      where clerk_org_id = current_setting('app.clerk_org_id', true)
    )
  );

create policy "tenant_isolation_takeoff" on takeoff_items
  for all using (
    tenant_id in (
      select id from tenants
      where clerk_org_id = current_setting('app.clerk_org_id', true)
    )
  );

create policy "tenant_isolation_tasks" on schedule_tasks
  for all using (
    tenant_id in (
      select id from tenants
      where clerk_org_id = current_setting('app.clerk_org_id', true)
    )
  );

create policy "tenant_isolation_intel" on document_intelligence
  for all using (
    tenant_id in (
      select id from tenants
      where clerk_org_id = current_setting('app.clerk_org_id', true)
    )
  );
