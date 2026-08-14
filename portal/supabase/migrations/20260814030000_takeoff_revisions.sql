create table if not exists public.takeoff_source_manifests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  document_id text references public.documents(id) on delete set null,
  sheet_id uuid references public.sheets(id) on delete set null,
  sheet_identity text not null,
  discipline text not null,
  sheet_number text not null,
  revision_label text,
  issue_date date,
  source_checksum text not null,
  manifest_version integer not null check (manifest_version > 0),
  authority_status text not null default 'proposed' check (authority_status in ('proposed','authoritative','superseded','conflicted')),
  created_by text not null,
  created_at timestamptz not null default now(),
  unique (tenant_id, project_id, sheet_identity, manifest_version),
  unique (tenant_id, project_id, source_checksum)
);

create unique index if not exists takeoff_source_one_authority_idx
  on public.takeoff_source_manifests (tenant_id, project_id, sheet_identity)
  where authority_status = 'authoritative';

create table if not exists public.takeoff_source_lineage (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  predecessor_id uuid not null references public.takeoff_source_manifests(id),
  successor_id uuid not null references public.takeoff_source_manifests(id),
  status text not null default 'proposed' check (status in ('proposed','approved','rejected')),
  decided_by text,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  unique (predecessor_id, successor_id),
  check (predecessor_id <> successor_id)
);

alter table public.takeoff_items
  add column if not exists source_manifest_id uuid references public.takeoff_source_manifests(id) on delete set null,
  add column if not exists source_manifest_version integer,
  add column if not exists source_checksum text,
  add column if not exists is_stale boolean not null default false;

create index if not exists takeoff_items_source_manifest_idx on public.takeoff_items (source_manifest_id, is_stale);

alter table public.takeoff_source_manifests enable row level security;
alter table public.takeoff_source_manifests force row level security;
alter table public.takeoff_source_lineage enable row level security;
alter table public.takeoff_source_lineage force row level security;
create policy takeoff_source_manifests_service_role_only on public.takeoff_source_manifests for all to service_role using (true) with check (true);
create policy takeoff_source_lineage_service_role_only on public.takeoff_source_lineage for all to service_role using (true) with check (true);
revoke all on table public.takeoff_source_manifests, public.takeoff_source_lineage from anon, authenticated;
grant select, insert, update, delete on table public.takeoff_source_manifests, public.takeoff_source_lineage to service_role;

create or replace function public.approve_takeoff_source_revision(
  p_tenant_id uuid,
  p_project_id uuid,
  p_lineage_id uuid,
  p_actor_user_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  lineage_row record;
  stale_count integer;
begin
  select l.*, prior.sheet_identity
  into lineage_row
  from public.takeoff_source_lineage l
  join public.takeoff_source_manifests prior on prior.id = l.predecessor_id
  join public.takeoff_source_manifests next_source on next_source.id = l.successor_id
  where l.id = p_lineage_id and l.tenant_id = p_tenant_id and l.project_id = p_project_id
    and l.status = 'proposed' and prior.sheet_identity = next_source.sheet_identity
  for update of l;
  if lineage_row.id is null then
    raise exception 'Proposed revision lineage not found for tenant/project' using errcode = 'P0002';
  end if;

  update public.takeoff_source_manifests set authority_status = 'superseded'
    where id = lineage_row.predecessor_id and tenant_id = p_tenant_id;
  update public.takeoff_source_manifests set authority_status = 'authoritative'
    where id = lineage_row.successor_id and tenant_id = p_tenant_id;
  update public.takeoff_source_lineage set status = 'approved', decided_by = p_actor_user_id, decided_at = now()
    where id = p_lineage_id;

  update public.takeoff_items set is_stale = true
    where tenant_id = p_tenant_id and project_id = p_project_id
      and source_manifest_id = lineage_row.predecessor_id
      and review_status in ('suggested','reviewed');
  get diagnostics stale_count = row_count;

  return jsonb_build_object('authoritative_manifest_id', lineage_row.successor_id, 'stale_candidate_count', stale_count);
end;
$$;

revoke all on function public.approve_takeoff_source_revision(uuid, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.approve_takeoff_source_revision(uuid, uuid, uuid, text) to service_role;
