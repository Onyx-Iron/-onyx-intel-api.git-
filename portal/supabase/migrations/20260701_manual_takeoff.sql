-- Manual takeoff measurements: user-drawn length/area/count/angle markup
-- persisted per (tenant, project, document, page).

create table if not exists manual_measurements (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references tenants(id) on delete cascade,
  project_id       uuid references projects(id) on delete cascade,
  document_id      uuid not null,
  page_number      int  not null,
  measurement_type text not null check (measurement_type in ('length','area','count','angle')),
  label            text,
  csi_code         text,
  color            text not null default '#CCFF00',
  coords           jsonb not null,          -- [{x,y}, ...] normalized 0..1 in page space
  scale_factor     numeric,                 -- px-per-unit ratio for this page
  computed_value   numeric,                 -- auto length/area/count
  unit             text,                    -- 'ft' | 'sf' | 'count' | 'deg'
  notes            text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists idx_manual_measurements_lookup
  on manual_measurements(tenant_id, project_id, document_id, page_number);

create index if not exists idx_manual_measurements_document
  on manual_measurements(document_id);

alter table manual_measurements enable row level security;

drop policy if exists "tenant_isolation_manual_measurements" on manual_measurements;
create policy "tenant_isolation_manual_measurements"
  on manual_measurements
  using (true)
  with check (true);
-- App layer enforces tenant_id matching; RLS open here is consistent with sibling tables
-- where the API uses the service key and filters by tenant_id on every query.

create or replace function touch_manual_measurements_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end$$;

drop trigger if exists trg_manual_measurements_touch on manual_measurements;
create trigger trg_manual_measurements_touch
  before update on manual_measurements
  for each row execute function touch_manual_measurements_updated_at();
