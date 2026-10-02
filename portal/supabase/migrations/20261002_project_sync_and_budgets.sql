-- Page takeoff queues one project sync instead of inserting estimate lines,
-- and an approved estimate version can be snapshotted into a budget.

alter table estimate_sync_outbox
  alter column manual_takeoff_id drop not null;

alter table estimate_sync_outbox drop constraint if exists estimate_sync_outbox_event_type_check;
alter table estimate_sync_outbox
  add constraint estimate_sync_outbox_event_type_check
  check (event_type in ('upsert', 'delete', 'project_sync'));

alter table estimate_sync_outbox drop constraint if exists estimate_sync_outbox_manual_takeoff_required;
alter table estimate_sync_outbox
  add constraint estimate_sync_outbox_manual_takeoff_required
  check (
    (event_type = 'project_sync' and manual_takeoff_id is null)
    or (event_type in ('upsert', 'delete') and manual_takeoff_id is not null)
  );

-- One pending project sync per project. A row already processing does not
-- block a new pending row, so a page that lands mid-sync is picked up next.
create unique index if not exists idx_estimate_sync_outbox_project_sync_pending
  on estimate_sync_outbox (project_id)
  where event_type = 'project_sync' and status = 'pending';

create or replace function public.enqueue_project_estimate_sync(
  p_tenant_id uuid,
  p_project_id uuid,
  p_payload jsonb default '{}'::jsonb
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  insert into estimate_sync_outbox (
    tenant_id, project_id, manual_takeoff_id, event_type, status, payload, created_at
  ) values (
    p_tenant_id, p_project_id, null, 'project_sync', 'pending', coalesce(p_payload, '{}'::jsonb), now()
  )
  on conflict (project_id) where event_type = 'project_sync' and status = 'pending'
  do update set
    payload = excluded.payload,
    created_at = now(),
    next_attempt_at = null
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.enqueue_project_estimate_sync(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.enqueue_project_estimate_sync(uuid, uuid, jsonb) to service_role;

create table if not exists project_budgets (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  project_id uuid not null,
  source_estimate_version_id uuid not null references estimate_versions(id),
  version_number integer not null,
  total_price numeric not null default 0,
  line_count integer not null default 0,
  created_by text,
  created_at timestamptz not null default now(),
  unique (source_estimate_version_id)
);

create index if not exists idx_project_budgets_tenant_project
  on project_budgets (tenant_id, project_id, created_at desc);

create table if not exists project_budget_lines (
  id uuid primary key default gen_random_uuid(),
  budget_id uuid not null references project_budgets(id) on delete cascade,
  tenant_id uuid not null,
  project_id uuid not null,
  source_estimate_item_id uuid,
  source_takeoff_id uuid,
  csi_code text,
  description text not null,
  quantity numeric,
  uom text,
  labor_cost numeric not null default 0,
  material_cost numeric not null default 0,
  equipment_cost numeric not null default 0,
  total_price numeric not null default 0,
  sort_order integer not null default 0
);

create index if not exists idx_project_budget_lines_budget
  on project_budget_lines (budget_id, sort_order);

alter table project_budgets enable row level security;
alter table project_budget_lines enable row level security;

drop policy if exists project_budgets_service_role_only on project_budgets;
create policy project_budgets_service_role_only on project_budgets
  for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

drop policy if exists project_budget_lines_service_role_only on project_budget_lines;
create policy project_budget_lines_service_role_only on project_budget_lines
  for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
