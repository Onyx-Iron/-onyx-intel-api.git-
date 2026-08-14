alter table public.takeoff_job_units
  add column if not exists attempts integer not null default 0 check (attempts >= 0),
  add column if not exists max_attempts integer not null default 8 check (max_attempts > 0),
  add column if not exists lease_owner text,
  add column if not exists lease_expires_at timestamptz,
  add column if not exists next_retry_at timestamptz,
  add column if not exists last_error text;

create index if not exists takeoff_job_units_recovery_idx
  on public.takeoff_job_units (lease_expires_at, next_retry_at)
  where lease_owner is not null or state = 'failed_retryable';

create or replace function public.recover_expired_takeoff_units(
  p_limit integer default 20,
  p_max_attempts integer default 8
)
returns table(id uuid, state text, attempts integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  unit_row record;
  v_state text;
  v_attempts integer;
begin
  for unit_row in
    select u.* from public.takeoff_job_units u
    where u.lease_owner is not null and u.lease_expires_at < now()
    order by u.lease_expires_at
    for update skip locked
    limit greatest(1, least(p_limit, 100))
  loop
    v_attempts := unit_row.attempts + 1;
    v_state := case when v_attempts >= least(unit_row.max_attempts, p_max_attempts)
      then 'failed_terminal' else 'failed_retryable' end;
    update public.takeoff_job_units u
    set state = v_state,
        attempts = v_attempts,
        row_version = u.row_version + 1,
        lease_owner = null,
        lease_expires_at = null,
        next_retry_at = case when v_state = 'failed_retryable'
          then now() + make_interval(secs => least(30 * (2 ^ greatest(v_attempts - 1, 0))::integer, 900)) end,
        last_error = coalesce(u.last_error, 'Worker lease expired'),
        updated_at = now()
    where u.id = unit_row.id;

    insert into public.takeoff_job_events (
      job_id, unit_id, tenant_id, project_id, entity_type, from_state, to_state,
      from_row_version, to_row_version, actor_user_id, reason, event_data
    ) values (
      unit_row.job_id, unit_row.id, unit_row.tenant_id, unit_row.project_id, 'unit',
      unit_row.state, v_state, unit_row.row_version, unit_row.row_version + 1,
      'system:takeoff-recovery', 'Worker lease expired',
      jsonb_build_object('previous_lease_owner', unit_row.lease_owner, 'attempts', v_attempts)
    );
    id := unit_row.id; state := v_state; attempts := v_attempts;
    return next;
  end loop;
end;
$$;

create or replace function public.claim_takeoff_work_units(
  p_worker_id text,
  p_states text[] default array['failed_retryable']::text[],
  p_limit integer default 20,
  p_lease_seconds integer default 120
)
returns setof public.takeoff_job_units
language sql
security definer
set search_path = ''
as $$
  with claimable as (
    select u.id from public.takeoff_job_units u
    where u.state = any(p_states)
      and (u.next_retry_at is null or u.next_retry_at <= now())
      and (u.lease_owner is null or u.lease_expires_at < now())
    order by coalesce(u.next_retry_at, u.updated_at), u.id
    for update skip locked
    limit greatest(1, least(p_limit, 100))
  )
  update public.takeoff_job_units u
  set lease_owner = p_worker_id,
      lease_expires_at = now() + make_interval(secs => greatest(10, least(p_lease_seconds, 900))),
      updated_at = now()
  from claimable c where u.id = c.id
  returning u.*;
$$;

revoke all on function public.recover_expired_takeoff_units(integer, integer) from public, anon, authenticated;
revoke all on function public.claim_takeoff_work_units(text, text[], integer, integer) from public, anon, authenticated;
grant execute on function public.recover_expired_takeoff_units(integer, integer) to service_role;
grant execute on function public.claim_takeoff_work_units(text, text[], integer, integer) to service_role;
