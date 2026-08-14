create table if not exists public.takeoff_import_commands (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  preview_id uuid not null references public.takeoff_approval_previews(id) on delete restrict,
  idempotency_key text not null,
  actor_user_id text not null,
  status text not null default 'started' check (status in ('started','completed','failed')),
  result jsonb,
  error text,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (tenant_id, idempotency_key),
  unique (preview_id)
);

create table if not exists public.takeoff_reconciliation_exceptions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  source_takeoff_id uuid,
  estimate_item_id uuid,
  exception_type text not null,
  details jsonb not null default '{}'::jsonb,
  resolved_at timestamptz,
  resolved_by text,
  created_at timestamptz not null default now()
);

alter table public.takeoff_import_commands enable row level security;
alter table public.takeoff_import_commands force row level security;
alter table public.takeoff_reconciliation_exceptions enable row level security;
alter table public.takeoff_reconciliation_exceptions force row level security;
create policy takeoff_import_commands_service_role_only on public.takeoff_import_commands for all to service_role using (true) with check (true);
create policy takeoff_reconciliation_exceptions_service_role_only on public.takeoff_reconciliation_exceptions for all to service_role using (true) with check (true);
revoke all on table public.takeoff_import_commands, public.takeoff_reconciliation_exceptions from anon, authenticated;
grant select, insert, update on table public.takeoff_import_commands, public.takeoff_reconciliation_exceptions to service_role;
