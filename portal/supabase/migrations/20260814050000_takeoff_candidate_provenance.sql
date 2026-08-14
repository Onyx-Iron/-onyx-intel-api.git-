-- Persist the evidence needed to reproduce and approve an automated quantity.
alter table public.takeoff_source_manifests
  drop constraint if exists takeoff_source_manifests_tenant_id_project_id_source_checksum_key;
create unique index if not exists takeoff_source_manifest_identity_checksum_idx
  on public.takeoff_source_manifests (tenant_id, project_id, sheet_identity, source_checksum);

alter table public.takeoff_items
  add column if not exists row_version integer not null default 0 check (row_version >= 0),
  add column if not exists takeoff_job_id uuid references public.takeoff_jobs(id) on delete set null,
  add column if not exists quantity_validation_status text not null default 'unvalidated'
    check (quantity_validation_status in ('unvalidated','validated','blocked')),
  add column if not exists quantity_validation_reason text,
  add column if not exists formula_version text,
  add column if not exists calculation_checksum text,
  add column if not exists source_provenance jsonb not null default '{}'::jsonb;

create index if not exists takeoff_items_takeoff_job_id_idx on public.takeoff_items (takeoff_job_id);
create index if not exists takeoff_items_validation_review_idx
  on public.takeoff_items (tenant_id, project_id, quantity_validation_status, review_status);

-- Governed overload. It invokes the legacy atomic refresh function inside the
-- same database transaction, then attaches immutable source and validation
-- evidence to each newly suggested candidate.
create or replace function public.apply_vision_extraction_takeoff_items(
  p_tenant_id uuid,
  p_project_id uuid,
  p_document_id uuid,
  p_page_id uuid,
  p_page_number int,
  p_items jsonb,
  p_job_id uuid,
  p_source_manifest_id uuid,
  p_source_manifest_version integer,
  p_source_checksum text
) returns setof public.takeoff_items
language plpgsql
security definer
set search_path = ''
as $$
declare
  item jsonb;
  item_key text;
begin
  if not exists (
    select 1 from public.takeoff_jobs j
    where j.id = p_job_id and j.tenant_id = p_tenant_id and j.project_id = p_project_id
  ) then raise exception 'Takeoff job not found for tenant/project' using errcode = 'P0002'; end if;

  if not exists (
    select 1 from public.takeoff_source_manifests m
    where m.id = p_source_manifest_id and m.tenant_id = p_tenant_id and m.project_id = p_project_id
      and m.document_id = p_document_id::text and m.source_checksum = p_source_checksum
      and m.manifest_version = p_source_manifest_version
  ) then raise exception 'Source manifest does not match candidate source' using errcode = 'P0001'; end if;

  perform public.apply_vision_extraction_takeoff_items(
    p_tenant_id, p_project_id, p_document_id, p_page_id, p_page_number, p_items
  );

  for item in select value from jsonb_array_elements(p_items)
  loop
    item_key := lower(trim(coalesce(item->>'description', ''))) || '|'
      || round(coalesce((item->>'quantity')::numeric, 0), 4)::text || '|'
      || lower(trim(coalesce(item->>'unit', '')));

    update public.takeoff_items
    set takeoff_job_id = p_job_id,
        source_manifest_id = p_source_manifest_id,
        source_manifest_version = p_source_manifest_version,
        source_checksum = p_source_checksum,
        quantity_validation_status = coalesce(item->>'validation_status', 'blocked'),
        quantity_validation_reason = item->>'validation_reason',
        formula_version = item->>'formula_version',
        calculation_checksum = item->>'calculation_checksum',
        source_provenance = jsonb_build_object(
          'page_id', p_page_id,
          'page_number', p_page_number,
          'source_kind', item->>'source',
          'raw_text', item->>'raw_text',
          'measurement_basis', coalesce(item->>'measurement_basis', 'source_text'),
          'source_checksum', p_source_checksum,
          'manifest_version', p_source_manifest_version
        ),
        meta = coalesce(meta, '{}'::jsonb) || jsonb_build_object(
          'formula_version', item->>'formula_version',
          'calculation_checksum', item->>'calculation_checksum',
          'quantity_validation_status', coalesce(item->>'validation_status', 'blocked')
        )
    where tenant_id = p_tenant_id and project_id = p_project_id
      and document_id = p_document_id::text
      and (meta->>'vision_page_id') = p_page_id::text
      and (meta->>'item_key') = item_key
      and review_status in ('suggested','reviewed');
  end loop;

  return query select * from public.takeoff_items
    where tenant_id = p_tenant_id and project_id = p_project_id
      and document_id = p_document_id::text and (meta->>'vision_page_id') = p_page_id::text;
end;
$$;

revoke all on function public.apply_vision_extraction_takeoff_items(uuid,uuid,uuid,uuid,int,jsonb,uuid,uuid,integer,text)
  from public, anon, authenticated;
grant execute on function public.apply_vision_extraction_takeoff_items(uuid,uuid,uuid,uuid,int,jsonb,uuid,uuid,integer,text)
  to service_role;

-- Replace confirmation so validation and source authority are checked again
-- under row locks; an API preflight cannot be raced into approving stale data.
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
    select 1 from public.takeoff_jobs j where j.id = preview_row.job_id and j.tenant_id = p_tenant_id
      and j.project_id = preview_row.project_id and j.state = 'review_ready'
  ) then raise exception 'Takeoff job is not ready for approval' using errcode = 'P0001'; end if;
  if not exists (
    select 1 from public.project_memberships m where m.tenant_id = p_tenant_id
      and m.project_id = preview_row.project_id and m.clerk_user_id = p_actor_user_id
      and m.active and m.project_role in ('owner','approver','estimator')
  ) then raise exception 'Active project approval membership required' using errcode = '42501'; end if;

  for candidate in select value from jsonb_array_elements(preview_row.payload -> 'candidateVersions')
  loop
    select i.id, i.row_version, i.is_stale, i.source_manifest_id, i.source_manifest_version,
           i.source_checksum, i.quantity_validation_status, m.authority_status
      into candidate_row
      from public.takeoff_items i
      left join public.takeoff_source_manifests m on m.id = i.source_manifest_id
      where i.id = (candidate ->> 'id')::uuid and i.tenant_id = p_tenant_id and i.project_id = preview_row.project_id
      for update of i;
    if candidate_row.id is null or candidate_row.is_stale
       or candidate_row.quantity_validation_status <> 'validated'
       or candidate_row.authority_status <> 'authoritative'
       or candidate_row.row_version <> (candidate ->> 'version')::integer
       or candidate_row.source_manifest_version is distinct from (candidate ->> 'sourceManifestVersion')::integer
       or candidate_row.source_checksum is distinct from candidate ->> 'sourceChecksum' then
      update public.takeoff_approval_previews set status = 'invalidated' where id = p_preview_id;
      raise exception 'Candidate changed or lacks validated authoritative evidence' using errcode = 'P0001';
    end if;
    update public.takeoff_items
      set review_status = 'approved', reviewed_by = p_actor_user_id, reviewed_at = now(),
          approved_by = p_actor_user_id, approved_at = now(), row_version = row_version + 1
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
