-- Takeoff layers (Bluebeam/PlanSwift-style) + non-quantity sheet markups.

create table if not exists public.takeoff_layers (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references public.tenants(id) on delete cascade,
  project_id          uuid not null references public.projects(id) on delete cascade,
  name                text not null,
  description         text,
  color               text not null default '#CCFF00',
  opacity             numeric not null default 1
                      check (opacity >= 0 and opacity <= 1),
  visible             boolean not null default true,
  locked              boolean not null default false,
  sort_order          integer not null default 0,
  discipline          text,
  trade               text,
  default_cost_code   text,
  created_by          text,
  updated_by          text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create unique index if not exists idx_takeoff_layers_tenant_project_name
  on public.takeoff_layers(tenant_id, project_id, name);

create index if not exists idx_takeoff_layers_project
  on public.takeoff_layers(tenant_id, project_id, sort_order);

alter table public.takeoff_layers enable row level security;
drop policy if exists takeoff_layers_service_role_all on public.takeoff_layers;
create policy takeoff_layers_service_role_all
  on public.takeoff_layers for all to service_role
  using (true) with check (true);
revoke all on table public.takeoff_layers from anon, authenticated;
grant select, insert, update, delete on table public.takeoff_layers to service_role;

alter table public.manual_takeoffs
  add column if not exists layer_id uuid references public.takeoff_layers(id) on delete set null;

create index if not exists idx_manual_takeoffs_layer
  on public.manual_takeoffs(layer_id)
  where layer_id is not null;

-- Markups never sync to estimates.
create table if not exists public.sheet_markups (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  project_id      uuid not null references public.projects(id) on delete cascade,
  page_id         uuid,
  markup_type     text not null check (markup_type in ('cloud', 'text', 'highlight', 'pen')),
  geometry        jsonb not null default '{}'::jsonb,
  label           text,
  color           text not null default '#F5A623',
  created_by      text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists idx_sheet_markups_page
  on public.sheet_markups(tenant_id, project_id, page_id);

alter table public.sheet_markups enable row level security;
drop policy if exists sheet_markups_service_role_all on public.sheet_markups;
create policy sheet_markups_service_role_all
  on public.sheet_markups for all to service_role
  using (true) with check (true);
revoke all on table public.sheet_markups from anon, authenticated;
grant select, insert, update, delete on table public.sheet_markups to service_role;
