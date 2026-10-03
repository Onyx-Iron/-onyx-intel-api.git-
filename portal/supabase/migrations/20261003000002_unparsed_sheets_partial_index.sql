-- Partial index for worker queue polling on uncalibrated plan sheets.
--
-- Schema mapping (design name → production table):
--   plan_sheets.file_id  → sheets.document_id  (parent document / file)
--   plan_sheets.is_calibrated → sheets.is_calibrated (denormalized from sheet_calibrations)
--
-- Workers poll `WHERE is_calibrated = false` to find sheets that still need
-- calibration before takeoff math can run. The partial index keeps the btree
-- small by excluding already-calibrated rows.

alter table public.sheets
  add column if not exists is_calibrated boolean not null default false;

comment on column public.sheets.is_calibrated is
  'Denormalized flag: true when the linked document_page has a verified, active sheet_calibration. Maintained by triggers on sheets and sheet_calibrations.';

-- Backfill from existing verified calibrations.
update public.sheets s
set is_calibrated = true
where s.document_page_id is not null
  and exists (
    select 1
    from public.sheet_calibrations sc
    where sc.page_id = s.document_page_id
      and sc.verified = true
      and sc.status = 'verified'
      and sc.active = true
  );

-- Keep is_calibrated in sync when a sheet row is inserted or its page link changes.
create or replace function public.trg_sheets_set_is_calibrated()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.document_page_id is null then
    new.is_calibrated := false;
  else
    new.is_calibrated := exists (
      select 1
      from public.sheet_calibrations sc
      where sc.page_id = new.document_page_id
        and sc.verified = true
        and sc.status = 'verified'
        and sc.active = true
    );
  end if;
  return new;
end;
$$;

drop trigger if exists trg_sheets_set_is_calibrated on public.sheets;
create trigger trg_sheets_set_is_calibrated
  before insert or update of document_page_id
  on public.sheets
  for each row
  execute function public.trg_sheets_set_is_calibrated();

-- Propagate calibration changes to all sheets linked to the affected page.
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

  select exists (
    select 1
    from public.sheet_calibrations sc
    where sc.page_id = v_page_id
      and sc.verified = true
      and sc.status = 'verified'
      and sc.active = true
  )
  into v_is_calibrated;

  update public.sheets s
  set is_calibrated = v_is_calibrated,
      updated_at = now()
  where s.document_page_id = v_page_id
    and s.is_calibrated is distinct from v_is_calibrated;

  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_sheet_calibrations_sync_sheets_is_calibrated on public.sheet_calibrations;
create trigger trg_sheet_calibrations_sync_sheets_is_calibrated
  after insert or update or delete
  on public.sheet_calibrations
  for each row
  execute function public.trg_sheet_calibrations_sync_sheets_is_calibrated();

-- Partial index: only rows still needing calibration (worker queue poll target).
create index if not exists idx_unparsed_sheets
  on public.sheets (document_id)
  where is_calibrated = false;

comment on index public.idx_unparsed_sheets is
  'Partial index for worker queue polling — uncalibrated plan sheets keyed by document (file) id.';
