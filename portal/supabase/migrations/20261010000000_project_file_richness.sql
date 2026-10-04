-- Project-file richness: links, pins, cost loop, pay apps, field production, closeout.
-- All rows stay on a single project. Sheet pins are not takeoff geometry.

alter table public.schedule_tasks
  add column if not exists percent_complete numeric;

alter table public.rfi_items
  add column if not exists ball_contact_id uuid,
  add column if not exists ball_since date;

alter table public.submittal_items
  add column if not exists ball_contact_id uuid,
  add column if not exists ball_since date,
  add column if not exists warranty_end_date date;

alter table public.change_order_items
  add column if not exists ball_contact_id uuid,
  add column if not exists ball_since date;

alter table public.punch_list_items
  add column if not exists ball_contact_id uuid,
  add column if not exists ball_since date;

alter table public.daily_logs
  add column if not exists client_visible boolean not null default false;

alter table public.project_contacts
  add column if not exists clerk_user_id text;

alter table public.project_budgets
  add column if not exists is_current boolean not null default false;

alter table public.project_budget_lines
  add column if not exists original_amount numeric not null default 0,
  add column if not exists approved_change_amount numeric not null default 0,
  add column if not exists forecast_override numeric;

update public.project_budget_lines
  set original_amount = total_price
  where original_amount = 0 and total_price <> 0;

create unique index if not exists idx_project_budgets_one_current
  on public.project_budgets (tenant_id, project_id)
  where is_current;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'project_contacts_contact_id_fkey'
  ) then
    alter table public.project_contacts
      add constraint project_contacts_contact_id_fkey
      foreign key (contact_id) references public.contacts(id) on delete cascade
      not valid;
  end if;
end $$;

create table if not exists public.project_record_links (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  from_type text not null,
  from_id uuid not null,
  to_type text not null,
  to_id uuid not null,
  link_role text not null,
  created_at timestamptz not null default now(),
  constraint project_record_links_role_check check (
    link_role in ('related', 'blocks', 'requires', 'prices', 'bills', 'installs', 'distributes')
  ),
  unique (tenant_id, project_id, from_type, from_id, to_type, to_id, link_role)
);

create index if not exists idx_project_record_links_project
  on public.project_record_links (tenant_id, project_id);

create table if not exists public.sheet_pins (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  page_id uuid not null,
  entity_type text not null,
  entity_id uuid not null,
  x numeric not null,
  y numeric not null,
  label text,
  created_at timestamptz not null default now()
);

create index if not exists idx_sheet_pins_page
  on public.sheet_pins (tenant_id, project_id, page_id);

create table if not exists public.schedule_baselines (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  name text not null,
  is_current boolean not null default false,
  created_by text,
  created_at timestamptz not null default now()
);

create unique index if not exists idx_schedule_baselines_one_current
  on public.schedule_baselines (tenant_id, project_id)
  where is_current;

create table if not exists public.schedule_baseline_tasks (
  id uuid primary key default gen_random_uuid(),
  baseline_id uuid not null references public.schedule_baselines(id) on delete cascade,
  tenant_id uuid not null,
  project_id uuid not null,
  source_task_id uuid,
  name text not null,
  start_date date,
  end_date date,
  duration numeric,
  critical boolean
);

create table if not exists public.project_commitments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  source text not null,
  purchase_order_id uuid,
  contact_id uuid,
  title text not null,
  status text not null default 'open',
  created_at timestamptz not null default now(),
  constraint project_commitments_source_check check (source in ('purchase_order', 'subcontract'))
);

create table if not exists public.project_commitment_lines (
  id uuid primary key default gen_random_uuid(),
  commitment_id uuid not null references public.project_commitments(id) on delete cascade,
  tenant_id uuid not null,
  project_id uuid not null,
  budget_line_id uuid,
  description text not null,
  amount numeric not null default 0
);

create table if not exists public.project_cost_entries (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  budget_line_id uuid,
  invoice_id uuid,
  time_card_id uuid,
  source text not null default 'invoice',
  amount numeric not null default 0,
  entry_date date,
  created_at timestamptz not null default now()
);

create table if not exists public.change_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  title text not null,
  status text not null default 'draft',
  rfi_id uuid,
  change_order_id uuid,
  schedule_task_id uuid,
  day_impact integer not null default 0,
  created_at timestamptz not null default now(),
  constraint change_events_status_check check (status in ('draft', 'pending', 'approved', 'void'))
);

create table if not exists public.change_event_lines (
  id uuid primary key default gen_random_uuid(),
  change_event_id uuid not null references public.change_events(id) on delete cascade,
  tenant_id uuid not null,
  project_id uuid not null,
  budget_line_id uuid,
  takeoff_id uuid,
  description text not null,
  quantity numeric,
  unit_price numeric,
  amount numeric not null default 0
);

create table if not exists public.pay_applications (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  side text not null,
  number text,
  draw_number text,
  status text not null default 'draft',
  commitment_id uuid,
  responsible_contact_id uuid,
  invoice_id uuid,
  retainage_pct numeric not null default 0,
  created_at timestamptz not null default now(),
  constraint pay_applications_side_check check (side in ('owner', 'commitment')),
  constraint pay_applications_status_check check (status in ('draft', 'payable', 'issued', 'void'))
);

create table if not exists public.pay_application_lines (
  id uuid primary key default gen_random_uuid(),
  pay_application_id uuid not null references public.pay_applications(id) on delete cascade,
  tenant_id uuid not null,
  project_id uuid not null,
  description text not null,
  cost_code text,
  scheduled_value numeric not null default 0,
  previous_amount numeric not null default 0,
  this_period numeric not null default 0,
  stored_materials numeric not null default 0,
  retainage numeric not null default 0,
  balance numeric not null default 0,
  is_allowance boolean not null default false
);

create table if not exists public.daily_log_manpower (
  id uuid primary key default gen_random_uuid(),
  daily_log_id uuid not null references public.daily_logs(id) on delete cascade,
  tenant_id uuid not null,
  project_id uuid not null,
  company_name text,
  project_contact_id uuid,
  headcount integer not null default 0,
  hours numeric not null default 0
);

create table if not exists public.daily_log_delays (
  id uuid primary key default gen_random_uuid(),
  daily_log_id uuid not null references public.daily_logs(id) on delete cascade,
  tenant_id uuid not null,
  project_id uuid not null,
  reason_code text not null,
  hours numeric not null default 0,
  schedule_task_id uuid
);

create table if not exists public.daily_log_equipment (
  id uuid primary key default gen_random_uuid(),
  daily_log_id uuid not null references public.daily_logs(id) on delete cascade,
  tenant_id uuid not null,
  project_id uuid not null,
  name text not null,
  hours numeric not null default 0
);

create table if not exists public.daily_log_deliveries (
  id uuid primary key default gen_random_uuid(),
  daily_log_id uuid not null references public.daily_logs(id) on delete cascade,
  tenant_id uuid not null,
  project_id uuid not null,
  note text not null,
  commitment_id uuid
);

create table if not exists public.daily_log_quantities (
  id uuid primary key default gen_random_uuid(),
  daily_log_id uuid not null references public.daily_logs(id) on delete cascade,
  tenant_id uuid not null,
  project_id uuid not null,
  budget_line_id uuid,
  estimate_item_id uuid,
  quantity numeric not null default 0,
  unit text
);

create table if not exists public.time_cards (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  staff_member_id uuid not null,
  work_date date not null,
  cost_code text,
  schedule_task_id uuid,
  hours numeric not null default 0,
  status text not null default 'draft',
  created_at timestamptz not null default now(),
  constraint time_cards_status_check check (status in ('draft', 'approved', 'void'))
);

create table if not exists public.project_meetings (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  title text not null,
  meeting_date date not null,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists public.project_meeting_actions (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references public.project_meetings(id) on delete cascade,
  tenant_id uuid not null,
  project_id uuid not null,
  title text not null,
  assignee text,
  due_date date,
  todo_id uuid
);

create table if not exists public.project_inspections (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  inspection_type text not null,
  status text not null default 'scheduled',
  result text,
  inspected_on date,
  document_id uuid,
  sheet_pin_id uuid,
  created_at timestamptz not null default now()
);

-- Both ends of a link must be rows on this project.
create or replace function public.entity_project_id(
  p_tenant uuid,
  p_project uuid,
  p_type text,
  p_id uuid
) returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  found uuid;
begin
  if p_type = 'rfi' then
    select project_id into found from rfi_items where id = p_id and tenant_id = p_tenant;
  elsif p_type = 'submittal' then
    select project_id into found from submittal_items where id = p_id and tenant_id = p_tenant;
  elsif p_type = 'change_order' then
    select project_id into found from change_order_items where id = p_id and tenant_id = p_tenant;
  elsif p_type = 'change_event' then
    select project_id into found from change_events where id = p_id and tenant_id = p_tenant;
  elsif p_type = 'punch' then
    select project_id into found from punch_list_items where id = p_id and tenant_id = p_tenant;
  elsif p_type = 'schedule_task' then
    select project_id into found from schedule_tasks where id = p_id and tenant_id = p_tenant;
  elsif p_type = 'purchase_order' then
    select project_id into found from purchase_orders where id = p_id and tenant_id = p_tenant;
  elsif p_type = 'commitment' then
    select project_id into found from project_commitments where id = p_id and tenant_id = p_tenant;
  elsif p_type = 'invoice' then
    select project_id into found from invoices where id = p_id and tenant_id = p_tenant;
  elsif p_type = 'pay_app' then
    select project_id into found from pay_applications where id = p_id and tenant_id = p_tenant;
  elsif p_type = 'budget_line' then
    select project_id into found from project_budget_lines where id = p_id and tenant_id = p_tenant;
  elsif p_type = 'estimate_item' then
    select project_id into found from estimate_items where id = p_id and tenant_id = p_tenant;
  elsif p_type = 'takeoff' then
    select project_id into found from takeoff_items where id = p_id and tenant_id = p_tenant;
  elsif p_type = 'daily_log' then
    select project_id into found from daily_logs where id = p_id and tenant_id = p_tenant;
  elsif p_type = 'todo' then
    select project_id into found from todo_items where id = p_id and tenant_id = p_tenant;
  elsif p_type = 'meeting' then
    select project_id into found from project_meetings where id = p_id and tenant_id = p_tenant;
  elsif p_type = 'inspection' then
    select project_id into found from project_inspections where id = p_id and tenant_id = p_tenant;
  elsif p_type = 'document' then
    select project_id into found from documents where id = p_id and tenant_id = p_tenant;
  elsif p_type = 'project_contact' then
    select project_id into found from project_contacts where id = p_id and tenant_id = p_tenant;
  elsif p_type = 'contact' then
    select project_id into found from contacts where id = p_id and tenant_id = p_tenant and project_id = p_project;
    if found is null then
      select project_id into found from project_contacts
        where contact_id = p_id and tenant_id = p_tenant and project_id = p_project;
    end if;
  else
    found := null;
  end if;
  return found;
end;
$$;

create or replace function public.enforce_project_record_link()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  from_project uuid;
  to_project uuid;
begin
  from_project := public.entity_project_id(new.tenant_id, new.project_id, new.from_type, new.from_id);
  to_project := public.entity_project_id(new.tenant_id, new.project_id, new.to_type, new.to_id);
  if from_project is null or to_project is null or from_project <> new.project_id or to_project <> new.project_id then
    raise exception 'link ends must belong to the same project';
  end if;
  return new;
end;
$$;

drop trigger if exists project_record_links_same_project on public.project_record_links;
create trigger project_record_links_same_project
  before insert or update on public.project_record_links
  for each row execute function public.enforce_project_record_link();

revoke all on function public.entity_project_id(uuid, uuid, text, uuid) from public, anon, authenticated;
revoke all on function public.enforce_project_record_link() from public, anon, authenticated;

do $$
declare
  t text;
begin
  foreach t in array array[
    'project_record_links', 'sheet_pins', 'schedule_baselines', 'schedule_baseline_tasks',
    'project_commitments', 'project_commitment_lines', 'project_cost_entries',
    'change_events', 'change_event_lines', 'pay_applications', 'pay_application_lines',
    'daily_log_manpower', 'daily_log_delays', 'daily_log_equipment', 'daily_log_deliveries',
    'daily_log_quantities', 'time_cards', 'project_meetings', 'project_meeting_actions',
    'project_inspections'
  ]
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_service_role_all', t);
    execute format(
      'create policy %I on public.%I for all to service_role using (true) with check (true)',
      t || '_service_role_all', t
    );
    execute format('revoke all on table public.%I from anon, authenticated', t);
    execute format('grant select, insert, update, delete on table public.%I to service_role', t);
  end loop;
end $$;
