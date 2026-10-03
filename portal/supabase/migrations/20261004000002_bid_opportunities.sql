-- Bid board / preconstruction opportunities (Company Hub M2).

create table if not exists public.bid_opportunities (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references public.tenants(id) on delete cascade,
  project_id        uuid references public.projects(id) on delete set null,
  company_id        uuid,
  contact_id        uuid,
  name              text not null,
  client_name       text,
  stage             text not null default 'identified'
                    check (stage in (
                      'identified', 'pursuing', 'takeoff', 'pricing',
                      'submitted', 'won', 'lost', 'no_bid'
                    )),
  due_at            timestamptz,
  bid_value         numeric,
  win_probability   numeric check (win_probability is null or (win_probability >= 0 and win_probability <= 100)),
  assigned_to       text,
  source            text not null default 'manual'
                    check (source in ('manual', 'gmail', 'sam', 'dot', 'other')),
  source_ref        text,
  notes             text,
  meta              jsonb not null default '{}'::jsonb,
  created_by        text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists idx_bid_opportunities_tenant_stage
  on public.bid_opportunities(tenant_id, stage);

create index if not exists idx_bid_opportunities_tenant_due
  on public.bid_opportunities(tenant_id, due_at)
  where due_at is not null;

create index if not exists idx_bid_opportunities_project
  on public.bid_opportunities(tenant_id, project_id)
  where project_id is not null;

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
