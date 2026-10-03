-- Estimate optimistic locking + spatial index optimization
-- Adds row_version to estimate_items and estimate_versions for concurrent-edit
-- detection, and GIN indexes on canvas geometry JSONB columns for spatial queries.

-- ── Optimistic locking on estimate tables ───────────────────────────────────

alter table estimate_items
  add column if not exists row_version integer not null default 1;

alter table estimate_versions
  add column if not exists row_version integer not null default 1;

comment on column estimate_items.row_version is
  'Optimistic concurrency token — increment on every update; PATCH must supply the last-read value.';

comment on column estimate_versions.row_version is
  'Optimistic concurrency token — increment on every update; PATCH must supply the last-read value.';

-- Bump row_version on estimate_items update
create or replace function trg_bump_estimate_items_row_version()
returns trigger language plpgsql as $$
begin
  new.row_version := coalesce(old.row_version, 0) + 1;
  return new;
end;
$$;

drop trigger if exists trg_estimate_items_row_version on estimate_items;
create trigger trg_estimate_items_row_version
  before update on estimate_items
  for each row execute function trg_bump_estimate_items_row_version();

-- Bump row_version on estimate_versions update
create or replace function trg_bump_estimate_versions_row_version()
returns trigger language plpgsql as $$
begin
  new.row_version := coalesce(old.row_version, 0) + 1;
  return new;
end;
$$;

drop trigger if exists trg_estimate_versions_row_version on estimate_versions;
create trigger trg_estimate_versions_row_version
  before update on estimate_versions
  for each row execute function trg_bump_estimate_versions_row_version();

-- ── Spatial / geometry index optimization ───────────────────────────────────

-- GIN index on manual_takeoffs geometry JSONB for point-in-bbox and path queries
create index if not exists idx_manual_takeoffs_geometry_gin
  on manual_takeoffs using gin (geometry jsonb_path_ops);

-- GIN index on civil utility run geometry
create index if not exists idx_civil_utility_geometry_gin
  on civil_utility_takeoffs using gin (geometry jsonb_path_ops)
  where geometry is not null;

-- GIN index on canvas topo node geometry
create index if not exists idx_canvas_topo_geometry_gin
  on canvas_topo_nodes using gin (geometry jsonb_path_ops);

-- Composite index for tenant-scoped spatial lookups on takeoff_items PostGIS columns
create index if not exists idx_takeoff_items_geom_sp_tenant
  on takeoff_items using gist (geom_sp)
  where geom_sp is not null;

-- Covering index for estimate_items version-scoped reads (common list pattern)
create index if not exists idx_estimate_items_version_sort
  on estimate_items (estimate_version_id, sort_order)
  where estimate_version_id is not null;
