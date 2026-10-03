-- Onyx Intel — Schema Migration v3
-- Daily Logs (field reports + photos) and Generated Documents (AI document creation)

-- ── Daily Logs ────────────────────────────────────────────────────────────────
create table if not exists daily_logs (
  id             uuid primary key default uuid_generate_v4(),
  tenant_id      uuid not null references tenants(id) on delete cascade,
  project_id     uuid not null references projects(id) on delete cascade,
  log_date       date not null default current_date,
  weather        text,
  temperature    text,
  crew_count     integer,
  work_performed text,
  notes          text,
  photo_urls     jsonb not null default '[]',
  created_by     text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists idx_daily_logs_tenant  on daily_logs(tenant_id);
create index if not exists idx_daily_logs_project on daily_logs(project_id, log_date desc);

-- ── Generated Documents (AI document creation) ────────────────────────────────
create table if not exists generated_documents (
  id          uuid primary key default uuid_generate_v4(),
  tenant_id   uuid not null references tenants(id) on delete cascade,
  project_id  uuid not null references projects(id) on delete cascade,
  doc_type    text not null,            -- rfi | submittal | scope | summary | other
  title       text not null,
  content     text not null,
  provider    text,                     -- which AI model produced it
  meta        jsonb not null default '{}',
  created_by  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists idx_gendocs_tenant  on generated_documents(tenant_id);
create index if not exists idx_gendocs_project on generated_documents(project_id, created_at desc);

-- ── Triggers ──────────────────────────────────────────────────────────────────
do $$ begin
  if not exists (select 1 from pg_trigger where tgname='trg_daily_logs_updated_at') then
    create trigger trg_daily_logs_updated_at before update on daily_logs
      for each row execute function _set_updated_at();
  end if;
  if not exists (select 1 from pg_trigger where tgname='trg_gendocs_updated_at') then
    create trigger trg_gendocs_updated_at before update on generated_documents
      for each row execute function _set_updated_at();
  end if;
end $$;

-- ── RLS ───────────────────────────────────────────────────────────────────────
alter table daily_logs          enable row level security;
alter table generated_documents enable row level security;

create policy "tenant_isolation_daily_logs" on daily_logs
  for all using (tenant_id in (
    select id from tenants where clerk_org_id = current_setting('app.clerk_org_id', true)
  ));

create policy "tenant_isolation_gendocs" on generated_documents
  for all using (tenant_id in (
    select id from tenants where clerk_org_id = current_setting('app.clerk_org_id', true)
  ));
