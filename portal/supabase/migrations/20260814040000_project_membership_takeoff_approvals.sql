create table if not exists public.project_memberships (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  clerk_user_id text not null,
  project_role text not null check (project_role in ('owner','approver','estimator','operator','viewer')),
  active boolean not null default true,
  granted_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, project_id, clerk_user_id)
);

create table if not exists public.takeoff_approval_previews (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  job_id uuid not null references public.takeoff_jobs(id) on delete cascade,
  actor_user_id text not null,
  payload jsonb not null,
  payload_hash text not null,
  status text not null default 'pending' check (status in ('pending','confirmed','expired','invalidated','cancelled')),
  expires_at timestamptz not null,
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint takeoff_approval_preview_payload_object check (jsonb_typeof(payload) = 'object')
);

create index if not exists takeoff_approval_previews_job_idx on public.takeoff_approval_previews (job_id, created_at desc);

create table if not exists public.takeoff_approval_confirmations (
  id uuid primary key default gen_random_uuid(),
  preview_id uuid not null unique references public.takeoff_approval_previews(id) on delete restrict,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  actor_user_id text not null,
  payload_hash text not null,
  confirmed_at timestamptz not null default now()
);

alter table public.project_memberships enable row level security;
alter table public.project_memberships force row level security;
alter table public.takeoff_approval_previews enable row level security;
alter table public.takeoff_approval_previews force row level security;
alter table public.takeoff_approval_confirmations enable row level security;
alter table public.takeoff_approval_confirmations force row level security;
create policy project_memberships_service_role_only on public.project_memberships for all to service_role using (true) with check (true);
create policy takeoff_approval_previews_service_role_only on public.takeoff_approval_previews for all to service_role using (true) with check (true);
create policy takeoff_approval_confirmations_service_role_only on public.takeoff_approval_confirmations for all to service_role using (true) with check (true);
revoke all on table public.project_memberships, public.takeoff_approval_previews, public.takeoff_approval_confirmations from anon, authenticated;
grant select, insert, update, delete on table public.project_memberships, public.takeoff_approval_previews to service_role;
grant select, insert on table public.takeoff_approval_confirmations to service_role;

create or replace function public.confirm_takeoff_approval_preview(
  p_tenant_id uuid,
  p_preview_id uuid,
  p_actor_user_id text,
  p_payload_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  preview_row record;
  candidate jsonb;
  candidate_row record;
  approved_count integer := 0;
begin
  select * into preview_row from public.takeoff_approval_previews
  where id = p_preview_id and tenant_id = p_tenant_id for update;
  if preview_row.id is null then raise exception 'Approval preview not found' using errcode = 'P0002'; end if;
  if preview_row.status <> 'pending' then raise exception 'Approval preview is no longer pending' using errcode = 'P0001'; end if;
  if preview_row.expires_at <= now() then
    update public.takeoff_approval_previews set status = 'expired' where id = p_preview_id;
    raise exception 'Approval preview expired' using errcode = 'P0001';
  end if;
  if preview_row.actor_user_id <> p_actor_user_id then raise exception 'Approval preview belongs to another actor' using errcode = '42501'; end if;
  if preview_row.payload_hash <> p_payload_hash then raise exception 'Approval preview payload changed' using errcode = 'P0001'; end if;
  if not exists (
    select 1 from public.project_memberships m where m.tenant_id = p_tenant_id
      and m.project_id = preview_row.project_id and m.clerk_user_id = p_actor_user_id
      and m.active and m.project_role in ('owner','approver','estimator')
  ) then raise exception 'Active project approval membership required' using errcode = '42501'; end if;

  for candidate in select value from jsonb_array_elements(preview_row.payload -> 'candidateVersions')
  loop
    select id, row_version, is_stale, source_manifest_version, source_checksum
      into candidate_row from public.takeoff_items
      where id = (candidate ->> 'id')::uuid and tenant_id = p_tenant_id and project_id = preview_row.project_id
      for update;
    if candidate_row.id is null or candidate_row.is_stale
       or candidate_row.row_version <> (candidate ->> 'version')::integer
       or candidate_row.source_manifest_version is distinct from (candidate ->> 'sourceManifestVersion')::integer
       or candidate_row.source_checksum is distinct from candidate ->> 'sourceChecksum' then
      update public.takeoff_approval_previews set status = 'invalidated' where id = p_preview_id;
      raise exception 'Candidate changed after approval preview' using errcode = 'P0001';
    end if;
    update public.takeoff_items set review_status = 'approved', reviewed_by = p_actor_user_id, reviewed_at = now(), row_version = row_version + 1
      where id = candidate_row.id;
    approved_count := approved_count + 1;
  end loop;

  update public.takeoff_approval_previews set status = 'confirmed', confirmed_at = now() where id = p_preview_id;
  insert into public.takeoff_approval_confirmations (preview_id, tenant_id, project_id, actor_user_id, payload_hash)
    values (p_preview_id, p_tenant_id, preview_row.project_id, p_actor_user_id, p_payload_hash);
  return jsonb_build_object('approved_count', approved_count, 'payload_hash', p_payload_hash);
end;
$$;

revoke all on function public.confirm_takeoff_approval_preview(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.confirm_takeoff_approval_preview(uuid, uuid, text, text) to service_role;
