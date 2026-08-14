-- Canonical, durable workflow state for automated takeoff. Completion is
-- derived from in-scope work units; document status flags are not a release
-- boundary.

create table if not exists public.takeoff_jobs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  state text not null default 'uploaded' check (state in (
    'uploaded','validated','split','classified','extracted','quantity_validated',
    'review_ready','approved','estimate_imported','blocked','conflicted',
    'failed_retryable','failed_terminal','superseded','cancelled'
  )),
  row_version integer not null default 0 check (row_version >= 0),
  scope_snapshot jsonb not null,
  scope_hash text not null,
  created_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint takeoff_jobs_scope_object check (jsonb_typeof(scope_snapshot) = 'object')
);

create index if not exists takeoff_jobs_tenant_project_created_idx
  on public.takeoff_jobs (tenant_id, project_id, created_at desc);

create table if not exists public.takeoff_job_units (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.takeoff_jobs(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  unit_type text not null check (unit_type in ('document','sheet','page','trade','bid_package','alternate')),
  source_id text not null,
  state text not null default 'uploaded' check (state in (
    'uploaded','validated','split','classified','extracted','quantity_validated',
    'review_ready','approved','estimate_imported','blocked','conflicted',
    'failed_retryable','failed_terminal','superseded','cancelled'
  )),
  row_version integer not null default 0 check (row_version >= 0),
  payload jsonb not null default '{}'::jsonb,
  exclusion_authorized_at timestamptz,
  exclusion_authorized_by text,
  exclusion_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (job_id, unit_type, source_id)
);

create index if not exists takeoff_job_units_claim_idx
  on public.takeoff_job_units (state, updated_at, job_id);
create index if not exists takeoff_job_units_tenant_project_idx
  on public.takeoff_job_units (tenant_id, project_id, job_id);

create table if not exists public.takeoff_job_events (
  id bigint generated always as identity primary key,
  job_id uuid not null references public.takeoff_jobs(id) on delete cascade,
  unit_id uuid references public.takeoff_job_units(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  entity_type text not null check (entity_type in ('job','unit')),
  from_state text not null,
  to_state text not null,
  from_row_version integer not null,
  to_row_version integer not null,
  actor_user_id text not null,
  reason text,
  event_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists takeoff_job_events_job_created_idx
  on public.takeoff_job_events (job_id, created_at, id);

alter table public.takeoff_jobs enable row level security;
alter table public.takeoff_jobs force row level security;
alter table public.takeoff_job_units enable row level security;
alter table public.takeoff_job_units force row level security;
alter table public.takeoff_job_events enable row level security;
alter table public.takeoff_job_events force row level security;

drop policy if exists takeoff_jobs_service_role_only on public.takeoff_jobs;
create policy takeoff_jobs_service_role_only on public.takeoff_jobs
  for all to service_role using (true) with check (true);
drop policy if exists takeoff_job_units_service_role_only on public.takeoff_job_units;
create policy takeoff_job_units_service_role_only on public.takeoff_job_units
  for all to service_role using (true) with check (true);
drop policy if exists takeoff_job_events_service_role_only on public.takeoff_job_events;
create policy takeoff_job_events_service_role_only on public.takeoff_job_events
  for all to service_role using (true) with check (true);

revoke all on table public.takeoff_jobs, public.takeoff_job_units, public.takeoff_job_events
  from anon, authenticated;
grant select, insert, update, delete on table public.takeoff_jobs, public.takeoff_job_units
  to service_role;
grant select, insert, delete on table public.takeoff_job_events to service_role;
grant usage, select on sequence public.takeoff_job_events_id_seq to service_role;

create or replace function public.transition_takeoff_state(
  p_tenant_id uuid,
  p_job_id uuid,
  p_entity_type text,
  p_entity_id uuid,
  p_expected_row_version integer,
  p_next_state text,
  p_actor_user_id text,
  p_reason text default null,
  p_event_data jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_from_state text;
  v_row_version integer;
  v_project_id uuid;
  v_allowed text[];
begin
  if p_entity_type not in ('job', 'unit') then
    raise exception 'Invalid takeoff entity type: %', p_entity_type using errcode = '22023';
  end if;
  if nullif(trim(p_actor_user_id), '') is null then
    raise exception 'actor_user_id is required' using errcode = '22023';
  end if;

  if p_entity_type = 'job' then
    if p_entity_id <> p_job_id then
      raise exception 'Job entity id must equal job id' using errcode = '22023';
    end if;
    select state, row_version, project_id
      into v_from_state, v_row_version, v_project_id
    from public.takeoff_jobs
    where id = p_job_id and tenant_id = p_tenant_id
    for update;
  else
    select state, row_version, project_id
      into v_from_state, v_row_version, v_project_id
    from public.takeoff_job_units
    where id = p_entity_id and job_id = p_job_id and tenant_id = p_tenant_id
    for update;
  end if;

  if v_from_state is null then
    raise exception 'Takeoff job or unit not found for tenant' using errcode = 'P0002';
  end if;
  if v_row_version <> p_expected_row_version then
    raise exception 'Takeoff row version conflict: expected %, found %', p_expected_row_version, v_row_version
      using errcode = 'P0001';
  end if;

  v_allowed := case v_from_state
    when 'uploaded' then array['validated','blocked','failed_retryable','failed_terminal','cancelled']
    when 'validated' then array['split','classified','blocked','failed_retryable','failed_terminal','cancelled']
    when 'split' then array['classified','blocked','failed_retryable','failed_terminal','cancelled']
    when 'classified' then array['extracted','blocked','conflicted','failed_retryable','failed_terminal','cancelled']
    when 'extracted' then array['quantity_validated','blocked','conflicted','failed_retryable','failed_terminal','cancelled']
    when 'quantity_validated' then array['review_ready','blocked','conflicted','failed_retryable','failed_terminal','cancelled']
    when 'review_ready' then array['approved','blocked','conflicted','superseded','cancelled']
    when 'approved' then array['estimate_imported','superseded']
    when 'estimate_imported' then array['superseded']
    when 'blocked' then array['validated','split','classified','extracted','quantity_validated','review_ready','cancelled']
    when 'conflicted' then array['quantity_validated','review_ready','superseded','cancelled']
    when 'failed_retryable' then array['validated','split','classified','extracted','cancelled']
    when 'failed_terminal' then array['cancelled']
    else array[]::text[]
  end;

  if not (p_next_state = any(v_allowed)) then
    raise exception 'Invalid takeoff transition: % -> %', v_from_state, p_next_state using errcode = '22023';
  end if;

  if p_entity_type = 'job' then
    update public.takeoff_jobs
    set state = p_next_state,
        row_version = row_version + 1,
        updated_at = now(),
        completed_at = case when p_next_state in ('estimate_imported','superseded','cancelled') then now() else null end
    where id = p_job_id and tenant_id = p_tenant_id;
  else
    update public.takeoff_job_units
    set state = p_next_state, row_version = row_version + 1, updated_at = now()
    where id = p_entity_id and job_id = p_job_id and tenant_id = p_tenant_id;
  end if;

  insert into public.takeoff_job_events (
    job_id, unit_id, tenant_id, project_id, entity_type, from_state, to_state,
    from_row_version, to_row_version, actor_user_id, reason, event_data
  ) values (
    p_job_id, case when p_entity_type = 'unit' then p_entity_id end,
    p_tenant_id, v_project_id, p_entity_type, v_from_state, p_next_state,
    v_row_version, v_row_version + 1, p_actor_user_id, p_reason, coalesce(p_event_data, '{}'::jsonb)
  );

  return jsonb_build_object('state', p_next_state, 'row_version', v_row_version + 1);
end;
$$;

revoke all on function public.transition_takeoff_state(uuid, uuid, text, uuid, integer, text, text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.transition_takeoff_state(uuid, uuid, text, uuid, integer, text, text, text, jsonb)
  to service_role;
