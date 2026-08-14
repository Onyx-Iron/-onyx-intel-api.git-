-- Source-level price provenance and immutable estimate approval previews.

alter table public.estimate_items
  add column if not exists price_observation_id uuid references public.price_observations(id) on delete set null,
  add column if not exists price_source_snapshot jsonb,
  add column if not exists pricing_effective_date date,
  add column if not exists pricing_confidence numeric(5,4) check (pricing_confidence between 0 and 1),
  add column if not exists row_version integer not null default 0 check (row_version >= 0);

create index if not exists estimate_items_price_observation_idx
  on public.estimate_items (price_observation_id);

alter table public.estimate_versions
  add column if not exists row_version integer not null default 0 check (row_version >= 0);

create or replace function public.bump_estimate_version_revision() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op in ('UPDATE', 'DELETE') and old.estimate_version_id is not null then
    update public.estimate_versions set row_version = row_version + 1 where id = old.estimate_version_id;
  end if;
  if tg_op = 'INSERT' and new.estimate_version_id is not null then
    update public.estimate_versions set row_version = row_version + 1 where id = new.estimate_version_id;
  elsif tg_op = 'UPDATE' and new.estimate_version_id is distinct from old.estimate_version_id and new.estimate_version_id is not null then
    update public.estimate_versions set row_version = row_version + 1 where id = new.estimate_version_id;
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_bump_estimate_version_revision on public.estimate_items;
create trigger trg_bump_estimate_version_revision
  after insert or update or delete on public.estimate_items
  for each row execute function public.bump_estimate_version_revision();
revoke all on function public.bump_estimate_version_revision() from public, anon, authenticated;

create table if not exists public.estimate_approval_previews (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  estimate_id uuid not null references public.estimates(id) on delete cascade,
  estimate_version_id uuid not null references public.estimate_versions(id) on delete cascade,
  actor_user_id text not null,
  payload jsonb not null,
  payload_hash text not null check (payload_hash ~ '^[a-f0-9]{64}$'),
  status text not null default 'pending' check (status in ('pending', 'confirmed', 'expired', 'cancelled')),
  expires_at timestamptz not null,
  confirmed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists estimate_approval_previews_lookup_idx
  on public.estimate_approval_previews (tenant_id, estimate_version_id, actor_user_id, created_at desc);
create index if not exists estimate_approval_previews_project_fk_idx on public.estimate_approval_previews (project_id);
create index if not exists estimate_approval_previews_estimate_fk_idx on public.estimate_approval_previews (estimate_id);
create index if not exists estimate_approval_previews_version_fk_idx on public.estimate_approval_previews (estimate_version_id);

alter table public.estimate_approval_previews enable row level security;
alter table public.estimate_approval_previews force row level security;
drop policy if exists estimate_approval_previews_service_role_only on public.estimate_approval_previews;
create policy estimate_approval_previews_service_role_only
  on public.estimate_approval_previews for all to service_role using (true) with check (true);
revoke all on table public.estimate_approval_previews from anon, authenticated;
grant select, insert, update on table public.estimate_approval_previews to service_role;

create or replace function public.confirm_estimate_approval(
  p_preview_id uuid,
  p_tenant_id uuid,
  p_actor_user_id text,
  p_payload_hash text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  preview_row public.estimate_approval_previews%rowtype;
  version_row public.estimate_versions%rowtype;
  expected_revision integer;
  previous_version_id uuid;
begin
  select * into preview_row from public.estimate_approval_previews
    where id = p_preview_id and tenant_id = p_tenant_id for update;
  if not found then raise exception 'Estimate approval preview not found'; end if;
  if preview_row.actor_user_id <> p_actor_user_id then raise exception 'Estimate approval preview belongs to another actor'; end if;
  if preview_row.status <> 'pending' then raise exception 'Estimate approval preview is not pending'; end if;
  if preview_row.expires_at <= now() then
    update public.estimate_approval_previews set status = 'expired' where id = preview_row.id;
    raise exception 'Estimate approval preview expired';
  end if;
  if preview_row.payload_hash <> p_payload_hash then raise exception 'Estimate approval payload changed'; end if;

  expected_revision := (preview_row.payload ->> 'versionRevision')::integer;
  select * into version_row from public.estimate_versions
    where id = preview_row.estimate_version_id for update;
  if not found or version_row.status not in ('draft', 'review') then raise exception 'Estimate version is not approvable'; end if;
  if version_row.row_version <> expected_revision then raise exception 'Estimate changed after approval preview'; end if;

  select current_version_id into previous_version_id from public.estimates
    where id = preview_row.estimate_id and tenant_id = p_tenant_id for update;
  if not found then raise exception 'Estimate not found for tenant'; end if;

  update public.estimate_versions
    set status = 'approved', approved_by = p_actor_user_id, approved_at = now(), row_version = row_version + 1
    where id = version_row.id;
  if previous_version_id is not null and previous_version_id <> version_row.id then
    update public.estimate_versions
      set status = 'superseded', superseded_by = version_row.id
      where id = previous_version_id and status = 'approved';
  end if;
  update public.estimates
    set current_version_id = version_row.id, updated_by = p_actor_user_id, updated_at = now()
    where id = preview_row.estimate_id and tenant_id = p_tenant_id;
  update public.estimate_approval_previews
    set status = 'confirmed', confirmed_at = now()
    where id = preview_row.id;

  return (select to_jsonb(v) from public.estimate_versions v where v.id = version_row.id);
end;
$$;

revoke all on function public.confirm_estimate_approval(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.confirm_estimate_approval(uuid, uuid, text, text) to service_role;
