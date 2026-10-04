-- Printed scale regions. A sheet can carry more than one scale, and each
-- region keeps its own factor. A printed scale calibrates its region.
-- A manual two-point check still marks that region human-verified.
-- New takeoff rows can store the printed scale string next to the geometry.

create table if not exists public.sheet_scale_regions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  project_id uuid references public.projects(id) on delete cascade,
  page_id uuid not null references public.document_pages(id) on delete cascade,
  scale_text text not null,
  page_space_scale_factor double precision not null check (page_space_scale_factor > 0),
  min_x double precision,
  min_y double precision,
  max_x double precision,
  max_y double precision,
  covers_page boolean not null default false,
  anchor_x double precision,
  anchor_y double precision,
  source text not null check (source in ('stated_on_sheet', 'manual')),
  verified boolean not null default false,
  status text not null default 'stated',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_sheet_scale_regions_page
  on public.sheet_scale_regions (page_id)
  where active = true;

comment on table public.sheet_scale_regions is
  'Page-space scale regions. A printed scale calibrates its own bounds. A manual calibration replaces only the region it was measured in.';

alter table public.sheet_scale_regions enable row level security;
drop policy if exists sheet_scale_regions_service_role_all on public.sheet_scale_regions;
create policy sheet_scale_regions_service_role_all
  on public.sheet_scale_regions for all to service_role
  using (true) with check (true);
revoke all on table public.sheet_scale_regions from anon, authenticated;
grant select, insert, update, delete on table public.sheet_scale_regions to service_role;

alter table public.takeoff_items
  add column if not exists printed_scale text;

comment on column public.takeoff_items.printed_scale is
  'Scale string read off the sheet, such as 1" = 20''. Null when the geometry has no printed scale.';

-- A sheet is calibrated when any active scale region exists, or a verified manual calibration does.
create or replace function public.page_has_scale(p_page_id uuid)
returns boolean
language sql
stable
set search_path = public
as $$
  select
    exists (
      select 1
      from public.sheet_scale_regions r
      where r.page_id = p_page_id
        and r.active = true
        and r.page_space_scale_factor > 0
    )
    or exists (
      select 1
      from public.sheet_calibrations sc
      where sc.page_id = p_page_id
        and sc.active = true
        and sc.verified = true
        and sc.status = 'verified'
        and sc.page_space_scale_factor > 0
    );
$$;

create or replace function public.trg_sheets_set_is_calibrated()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.document_page_id is null then
    new.is_calibrated := false;
  else
    new.is_calibrated := public.page_has_scale(new.document_page_id);
  end if;
  return new;
end;
$$;

create or replace function public.trg_sheet_calibrations_sync_sheets_is_calibrated()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_page_id uuid;
  v_is_calibrated boolean;
begin
  v_page_id := coalesce(new.page_id, old.page_id);
  v_is_calibrated := public.page_has_scale(v_page_id);
  update public.sheets s
  set is_calibrated = v_is_calibrated,
      updated_at = now()
  where s.document_page_id = v_page_id
    and s.is_calibrated is distinct from v_is_calibrated;
  return coalesce(new, old);
end;
$$;

create or replace function public.trg_sheet_scale_regions_sync_sheets_is_calibrated()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_page_id uuid;
  v_is_calibrated boolean;
begin
  v_page_id := coalesce(new.page_id, old.page_id);
  v_is_calibrated := public.page_has_scale(v_page_id);
  update public.sheets s
  set is_calibrated = v_is_calibrated,
      updated_at = now()
  where s.document_page_id = v_page_id
    and s.is_calibrated is distinct from v_is_calibrated;
  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_sheet_scale_regions_sync_sheets_is_calibrated on public.sheet_scale_regions;
create trigger trg_sheet_scale_regions_sync_sheets_is_calibrated
  after insert or update or delete
  on public.sheet_scale_regions
  for each row
  execute function public.trg_sheet_scale_regions_sync_sheets_is_calibrated();

comment on column public.sheets.is_calibrated is
  'True when the linked page has an active printed scale region or a verified manual calibration.';
