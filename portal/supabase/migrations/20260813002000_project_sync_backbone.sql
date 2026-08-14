-- One durable synchronization clock and append-only history for every project.
--
-- Any write to a table carrying (tenant_id, project_id) advances the owning
-- project's revision. Child rows that inherit project scope through a document
-- or conversation are covered by dedicated triggers below. The web app polls
-- only project_sync_state, so a background extractor and a browser mutation
-- produce the same cross-tab refresh signal.

create schema if not exists private;
grant usage on schema private to service_role;

create table if not exists public.project_sync_state (
  tenant_id uuid not null,
  project_id uuid not null,
  revision bigint not null default 0 check (revision >= 0),
  updated_at timestamptz not null default now(),
  last_table text,
  last_entity_id text,
  last_operation text check (last_operation is null or last_operation in ('insert', 'update', 'delete')),
  primary key (tenant_id, project_id)
);

create table if not exists public.project_data_history (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  project_id uuid not null,
  revision bigint not null check (revision > 0),
  table_name text not null,
  entity_id text,
  operation text not null check (operation in ('insert', 'update', 'delete')),
  actor_user_id text not null default 'system',
  transaction_id bigint not null default txid_current(),
  before_data jsonb,
  after_data jsonb,
  changed_at timestamptz not null default now()
);

create unique index if not exists project_data_history_project_revision_idx
  on public.project_data_history (tenant_id, project_id, revision);

create index if not exists project_data_history_project_changed_idx
  on public.project_data_history (tenant_id, project_id, changed_at desc);

create index if not exists project_data_history_entity_idx
  on public.project_data_history (tenant_id, project_id, table_name, entity_id, changed_at desc);

alter table public.project_sync_state enable row level security;
alter table public.project_sync_state force row level security;
alter table public.project_data_history enable row level security;
alter table public.project_data_history force row level security;

drop policy if exists project_sync_state_service_role_only on public.project_sync_state;
create policy project_sync_state_service_role_only
  on public.project_sync_state for all to service_role
  using (true) with check (true);

drop policy if exists project_data_history_service_role_only on public.project_data_history;
create policy project_data_history_service_role_only
  on public.project_data_history for all to service_role
  using (true) with check (true);

revoke all on table public.project_sync_state from anon, authenticated;
revoke all on table public.project_data_history from anon, authenticated;
grant select, insert, update, delete on table public.project_sync_state to service_role;
grant select, insert on table public.project_data_history to service_role;

create or replace function private.append_project_change(
  p_tenant_id uuid,
  p_project_id uuid,
  p_table_name text,
  p_entity_id text,
  p_operation text,
  p_before_data jsonb,
  p_after_data jsonb
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_revision bigint;
  v_actor text;
begin
  if p_tenant_id is null or p_project_id is null then
    return;
  end if;

  v_actor := coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    'system'
  );

  insert into public.project_sync_state as sync_state (
    tenant_id,
    project_id,
    revision,
    updated_at,
    last_table,
    last_entity_id,
    last_operation
  ) values (
    p_tenant_id,
    p_project_id,
    1,
    now(),
    p_table_name,
    p_entity_id,
    p_operation
  )
  on conflict (tenant_id, project_id) do update
  set revision = sync_state.revision + 1,
      updated_at = excluded.updated_at,
      last_table = excluded.last_table,
      last_entity_id = excluded.last_entity_id,
      last_operation = excluded.last_operation
  returning revision into v_revision;

  insert into public.project_data_history (
    tenant_id,
    project_id,
    revision,
    table_name,
    entity_id,
    operation,
    actor_user_id,
    before_data,
    after_data
  ) values (
    p_tenant_id,
    p_project_id,
    v_revision,
    p_table_name,
    p_entity_id,
    p_operation,
    v_actor,
    p_before_data,
    p_after_data
  );
end;
$$;

create or replace function private.record_project_change()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_before jsonb;
  v_after jsonb;
  v_scope jsonb;
  v_tenant_id uuid;
  v_project_id uuid;
begin
  -- Vector values are reproducible derivatives and can dwarf the source text.
  -- Keep the extracted text and all business fields, but omit vector payloads.
  if tg_op <> 'INSERT' then
    v_before := to_jsonb(old) - 'embedding' - 'fts' - 'vectors';
  end if;
  if tg_op <> 'DELETE' then
    v_after := to_jsonb(new) - 'embedding' - 'fts' - 'vectors';
  end if;

  v_scope := coalesce(v_after, v_before);
  v_tenant_id := nullif(v_scope ->> 'tenant_id', '')::uuid;
  v_project_id := case
    when tg_table_name = 'projects' then nullif(v_scope ->> 'id', '')::uuid
    else nullif(v_scope ->> 'project_id', '')::uuid
  end;

  perform private.append_project_change(
    v_tenant_id,
    v_project_id,
    tg_table_name,
    v_scope ->> 'id',
    lower(tg_op),
    v_before,
    v_after
  );

  -- If a row is reassigned, also invalidate its former project.
  if tg_op = 'UPDATE'
     and (v_before ->> 'project_id') is distinct from (v_after ->> 'project_id')
     and nullif(v_before ->> 'project_id', '') is not null then
    perform private.append_project_change(
      nullif(v_before ->> 'tenant_id', '')::uuid,
      nullif(v_before ->> 'project_id', '')::uuid,
      tg_table_name,
      to_jsonb(old) ->> 'id',
      'delete',
      v_before,
      null
    );
  end if;

  return coalesce(new, old);
end;
$$;

create or replace function private.record_document_child_change()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_before jsonb;
  v_after jsonb;
  v_scope jsonb;
  v_tenant_id uuid;
  v_project_id uuid;
begin
  if tg_op <> 'INSERT' then
    v_before := to_jsonb(old) - 'embedding' - 'fts' - 'vectors';
  end if;
  if tg_op <> 'DELETE' then
    v_after := to_jsonb(new) - 'embedding' - 'fts' - 'vectors';
  end if;
  v_scope := coalesce(v_after, v_before);

  select d.tenant_id, d.project_id
    into v_tenant_id, v_project_id
  from public.documents d
  where d.id = nullif(v_scope ->> 'document_id', '');

  perform private.append_project_change(
    v_tenant_id,
    v_project_id,
    tg_table_name,
    v_scope ->> 'id',
    lower(tg_op),
    v_before,
    v_after
  );
  return coalesce(new, old);
end;
$$;

create or replace function private.record_message_change()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_before jsonb;
  v_after jsonb;
  v_scope jsonb;
  v_tenant_id uuid;
  v_project_id uuid;
begin
  if tg_op <> 'INSERT' then v_before := to_jsonb(old); end if;
  if tg_op <> 'DELETE' then v_after := to_jsonb(new); end if;
  v_scope := coalesce(v_after, v_before);

  select c.tenant_id, c.project_id
    into v_tenant_id, v_project_id
  from public.conversations c
  where c.id = nullif(v_scope ->> 'conversation_id', '')::uuid;

  perform private.append_project_change(
    v_tenant_id,
    v_project_id,
    tg_table_name,
    v_scope ->> 'id',
    lower(tg_op),
    v_before,
    v_after
  );
  return coalesce(new, old);
end;
$$;

revoke all on function private.append_project_change(uuid, uuid, text, text, text, jsonb, jsonb) from public, anon, authenticated;
revoke all on function private.record_project_change() from public, anon, authenticated;
revoke all on function private.record_document_child_change() from public, anon, authenticated;
revoke all on function private.record_message_change() from public, anon, authenticated;
grant execute on function private.append_project_change(uuid, uuid, text, text, text, jsonb, jsonb) to service_role;
grant execute on function private.record_project_change() to service_role;
grant execute on function private.record_document_child_change() to service_role;
grant execute on function private.record_message_change() to service_role;

-- Attach to every current project-scoped table. This intentionally excludes
-- append-only audit/history tables to prevent audit-of-audit recursion.
do $$
declare
  rel record;
begin
  for rel in
    select c.relname as table_name
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('r', 'p')
      and (
        c.relname = 'projects'
        or (
          exists (
            select 1 from pg_catalog.pg_attribute a
            where a.attrelid = c.oid and a.attname = 'tenant_id' and not a.attisdropped
          )
          and exists (
            select 1 from pg_catalog.pg_attribute a
            where a.attrelid = c.oid and a.attname = 'project_id' and not a.attisdropped
          )
        )
      )
      and c.relname not in (
        'project_sync_state',
        'project_data_history',
        'project_events',
        'audit_logs',
        'estimate_audit_log',
        'estimate_sync_outbox',
        'manual_takeoff_history',
        'sheet_calibration_history',
        'takeoff_item_history'
      )
  loop
    execute format('drop trigger if exists project_sync_change on public.%I', rel.table_name);
    execute format(
      'create trigger project_sync_change after insert or update or delete on public.%I for each row execute function private.record_project_change()',
      rel.table_name
    );
  end loop;
end;
$$;

-- Project scope inherited through documents.
do $$
declare
  table_name text;
begin
  foreach table_name in array array['document_pages', 'pages', 'document_chunks']
  loop
    if to_regclass(format('public.%I', table_name)) is not null then
      execute format('drop trigger if exists project_sync_document_child on public.%I', table_name);
      execute format(
        'create trigger project_sync_document_child after insert or update or delete on public.%I for each row execute function private.record_document_child_change()',
        table_name
      );
    end if;
  end loop;
end;
$$;

-- Chat messages inherit scope through their conversation.
-- Some deployments may not have chat enabled yet; keep the project sync backbone deployable.
do $$
begin
  if to_regclass('public.messages') is not null then
    drop trigger if exists project_sync_message on public.messages;
    create trigger project_sync_message
      after insert or update or delete on public.messages
      for each row execute function private.record_message_change();
  end if;
end;
$$;

-- Existing projects start from a known clock without fabricating history.
insert into public.project_sync_state (tenant_id, project_id, revision, updated_at, last_table, last_entity_id, last_operation)
select p.tenant_id, p.id, 0, coalesce(p.updated_at, p.created_at, now()), 'projects', p.id::text, null
from public.projects p
on conflict (tenant_id, project_id) do nothing;

comment on table public.project_sync_state is
  'One monotonically increasing revision per tenant/project. Used for cross-tab and cross-worker cache invalidation.';
comment on table public.project_data_history is
  'Append-only before/after history for project-scoped data, including background extraction writes.';
