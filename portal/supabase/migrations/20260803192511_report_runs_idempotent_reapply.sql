-- Supabase production recorded a second `report_runs` apply while reconciling
-- the Reports workspace migration. Keep a matching idempotent local migration
-- so local/remote ledgers do not drift; this intentionally preserves the same
-- final schema as 20260803191503_report_runs.sql.

create table if not exists public.report_runs (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  project_id    uuid not null references public.projects(id) on delete cascade,
  report_type   text not null default 'project_status'
                check (report_type in ('project_status')),
  title         text not null,
  status        text not null default 'generated'
                check (status in ('generated', 'failed')),
  provider      text,
  summary       jsonb not null default '{}'::jsonb,
  inputs        jsonb not null default '{}'::jsonb,
  body          text not null,
  generated_by text,
  generated_at timestamptz not null default now(),
  created_at   timestamptz not null default now()
);

create index if not exists idx_report_runs_tenant_generated
  on public.report_runs(tenant_id, generated_at desc);

create index if not exists idx_report_runs_project_generated
  on public.report_runs(tenant_id, project_id, generated_at desc);

create index if not exists idx_report_runs_project_id
  on public.report_runs(project_id);

alter table public.report_runs enable row level security;

drop policy if exists report_runs_service_role_all on public.report_runs;
create policy report_runs_service_role_all
  on public.report_runs
  for all
  to service_role
  using (true)
  with check (true);

revoke all on table public.report_runs from anon, authenticated;
grant select, insert, update, delete on table public.report_runs to service_role;
