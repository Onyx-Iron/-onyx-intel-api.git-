create table if not exists public.bid_opportunities (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  linked_project_id uuid references public.projects(id) on delete set null,
  linked_estimate_version_id uuid references public.estimate_versions(id) on delete set null,
  name text not null,
  client_name text,
  source text,
  stage text not null default 'lead'
    check (stage in ('lead', 'qualifying', 'bidding', 'submitted', 'shortlisted', 'won', 'lost', 'no_bid')),
  priority text not null default 'medium'
    check (priority in ('low', 'medium', 'high', 'critical')),
  bid_due_date date,
  estimated_value numeric(14, 2) check (estimated_value is null or estimated_value >= 0),
  win_probability numeric(5, 2) check (win_probability is null or (win_probability >= 0 and win_probability <= 100)),
  location text,
  scope_summary text,
  next_action text,
  owner text,
  notes text,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_bid_opportunities_tenant_stage_due
  on public.bid_opportunities (tenant_id, stage, bid_due_date);

create index if not exists idx_bid_opportunities_tenant_updated
  on public.bid_opportunities (tenant_id, updated_at desc);

create index if not exists idx_bid_opportunities_linked_project
  on public.bid_opportunities (tenant_id, linked_project_id)
  where linked_project_id is not null;

drop trigger if exists trg_bid_opportunities_updated_at on public.bid_opportunities;
create trigger trg_bid_opportunities_updated_at
  before update on public.bid_opportunities
  for each row execute function public._set_updated_at();

alter table public.bid_opportunities enable row level security;

drop policy if exists bid_opportunities_service_role_all on public.bid_opportunities;
create policy bid_opportunities_service_role_all
  on public.bid_opportunities
  for all
  to service_role
  using (true)
  with check (true);

revoke all on table public.bid_opportunities from anon, authenticated;
grant select, insert, update, delete on table public.bid_opportunities to service_role;
