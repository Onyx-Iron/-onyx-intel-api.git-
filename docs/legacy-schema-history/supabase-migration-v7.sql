-- Onyx Intel - Schema Migration v7
-- Strengthens estimate auditability for takeoff-derived estimates.

alter table estimate_items
  add column if not exists source_takeoff_id uuid references takeoff_items(id) on delete set null,
  add column if not exists source_fingerprint text,
  add column if not exists quantity_basis text,
  add column if not exists drawing_ref text,
  add column if not exists location_tag text,
  add column if not exists pricing_status text not null default 'manual'
    check (pricing_status in ('manual','priced','unpriced','review'));

create index if not exists idx_estimate_source_takeoff on estimate_items(source_takeoff_id);
create index if not exists idx_estimate_source_fingerprint on estimate_items(tenant_id, project_id, source_fingerprint);
