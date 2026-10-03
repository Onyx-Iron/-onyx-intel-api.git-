-- SP-GiST spatial indexing on takeoff geometry columns.
-- Adds native PostgreSQL geometric columns (point + box) to manual_measurements
-- and estimate_items, backfills from existing JSONB geometry, and indexes both
-- with Space-Partitioned GiST for fast viewport / containment queries.

-- ── Helper functions ──────────────────────────────────────────────────────────

create or replace function public.jsonb_points_to_centroid(pts jsonb)
returns point
language plpgsql
immutable
parallel safe
set search_path = public
as $$
declare
  cx float8;
  cy float8;
begin
  if pts is null or jsonb_typeof(pts) <> 'array' or jsonb_array_length(pts) = 0 then
    return null;
  end if;

  select
    avg((elem->>'x')::float8),
    avg((elem->>'y')::float8)
  into cx, cy
  from jsonb_array_elements(pts) as elem
  where (elem ? 'x') and (elem ? 'y')
    and (elem->>'x') ~ '^-?\d'
    and (elem->>'y') ~ '^-?\d';

  if cx is null or cy is null then
    return null;
  end if;

  return point(cx, cy);
end;
$$;

create or replace function public.jsonb_points_to_box(pts jsonb)
returns box
language plpgsql
immutable
parallel safe
set search_path = public
as $$
declare
  min_x float8;
  min_y float8;
  max_x float8;
  max_y float8;
begin
  if pts is null or jsonb_typeof(pts) <> 'array' or jsonb_array_length(pts) = 0 then
    return null;
  end if;

  select
    min((elem->>'x')::float8),
    min((elem->>'y')::float8),
    max((elem->>'x')::float8),
    max((elem->>'y')::float8)
  into min_x, min_y, max_x, max_y
  from jsonb_array_elements(pts) as elem
  where (elem ? 'x') and (elem ? 'y')
    and (elem->>'x') ~ '^-?\d'
    and (elem->>'y') ~ '^-?\d';

  if min_x is null then
    return null;
  end if;

  return box(point(min_x, min_y), point(max_x, max_y));
end;
$$;

-- ── manual_measurements ─────────────────────────────────────────────────────

alter table manual_measurements
  add column if not exists coordinates point,
  add column if not exists bounding_box box;

comment on column manual_measurements.coordinates is
  'Centroid of coords JSONB vertices — maintained by trg_manual_measurements_spatial.';

comment on column manual_measurements.bounding_box is
  'Axis-aligned bounds of coords JSONB vertices — indexed with SP-GiST for viewport queries.';

-- Backfill from legacy coords JSONB
update manual_measurements
set
  coordinates = public.jsonb_points_to_centroid(coords),
  bounding_box = public.jsonb_points_to_box(coords)
where coordinates is null
  and bounding_box is null
  and coords is not null;

create or replace function public.trg_manual_measurements_spatial()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.coordinates := public.jsonb_points_to_centroid(new.coords);
  new.bounding_box := public.jsonb_points_to_box(new.coords);
  return new;
end;
$$;

drop trigger if exists trg_manual_measurements_spatial on manual_measurements;
create trigger trg_manual_measurements_spatial
  before insert or update of coords on manual_measurements
  for each row execute function public.trg_manual_measurements_spatial();

create index if not exists idx_measurements_bbox
  on manual_measurements using spgist (bounding_box);

create index if not exists idx_measurements_coordinates
  on manual_measurements using spgist (coordinates);

-- ── estimate_items ──────────────────────────────────────────────────────────

alter table estimate_items
  add column if not exists coordinates point,
  add column if not exists bounding_box box;

comment on column estimate_items.coordinates is
  'Centroid of linked takeoff geometry — populated from source_takeoff_id when available.';

comment on column estimate_items.bounding_box is
  'Axis-aligned bounds of linked takeoff geometry — indexed with SP-GiST for spatial joins.';

-- Backfill from takeoff_items.geometry when a source takeoff link exists
update estimate_items ei
set
  coordinates = public.jsonb_points_to_centroid(ti.geometry->'points'),
  bounding_box = public.jsonb_points_to_box(ti.geometry->'points')
from takeoff_items ti
where ei.source_takeoff_id = ti.id
  and ei.coordinates is null
  and ei.bounding_box is null
  and ti.geometry->'points' is not null;

create or replace function public.trg_estimate_items_spatial()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  geom jsonb;
begin
  if new.source_takeoff_id is null then
    return new;
  end if;

  select geometry into geom
  from takeoff_items
  where id = new.source_takeoff_id;

  if geom is null or geom->'points' is null then
    return new;
  end if;

  new.coordinates := public.jsonb_points_to_centroid(geom->'points');
  new.bounding_box := public.jsonb_points_to_box(geom->'points');
  return new;
end;
$$;

drop trigger if exists trg_estimate_items_spatial on estimate_items;
create trigger trg_estimate_items_spatial
  before insert or update of source_takeoff_id on estimate_items
  for each row execute function public.trg_estimate_items_spatial();

create index if not exists idx_estimate_items_bbox
  on estimate_items using spgist (bounding_box);

create index if not exists idx_estimate_items_coordinates
  on estimate_items using spgist (coordinates);
