-- Worker queue hardening: partial indexes on live poll paths, sheet claim
-- mechanics (FOR UPDATE SKIP LOCKED), and document sheet_index_status rollup.

-- ── 1. Refine unparsed-sheets index + add worker-claim index ───────────────

drop index if exists public.idx_unparsed_sheets;

create index if not exists idx_unparsed_sheets
  on public.sheets (tenant_id, document_id, updated_at)
  where is_calibrated = false;

comment on index public.idx_unparsed_sheets is
  'Partial index for UI and worker polling — all uncalibrated plan sheets, tenant-scoped.';

create index if not exists idx_sheets_claimable
  on public.sheets (created_at)
  where is_calibrated = false
    and processing_status in ('pending', 'needs_review');

create index if not exists idx_sheets_pending_processing
  on public.sheets (tenant_id, document_id)
  where processing_status in ('pending', 'needs_review');

-- ── 2. Partial indexes on document_pages worker queues ──────────────────────

create index if not exists idx_document_pages_pending_takeoff
  on public.document_pages (tenant_id, document_id)
  where takeoff_status = 'pending';

create index if not exists idx_document_pages_pending_ocr
  on public.document_pages (tenant_id, document_id)
  where status = 'pending';

create index if not exists idx_document_pages_stuck_takeoff
  on public.document_pages (updated_at)
  where takeoff_status = 'processing';

create index if not exists idx_document_pages_stuck_ocr
  on public.document_pages (updated_at)
  where status = 'processing';

-- ── 3. Sheet worker claim columns ───────────────────────────────────────────

alter table public.sheets
  add column if not exists claimed_at timestamptz,
  add column if not exists claimed_by text;

create index if not exists idx_sheets_stuck_processing
  on public.sheets (claimed_at)
  where processing_status = 'processing';

-- ── 4. Sheet claim / complete / fail RPCs ───────────────────────────────────

create or replace function public.claim_unparsed_sheets(
  p_limit integer,
  p_worker_id text,
  p_visibility_timeout_seconds integer default 120
)
returns setof public.sheets
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  update public.sheets s
  set processing_status = 'processing',
      claimed_at = now(),
      claimed_by = p_worker_id,
      updated_at = now()
  where s.id in (
    select id
    from public.sheets
    where is_calibrated = false
      and (
        processing_status in ('pending', 'needs_review')
        or (
          processing_status = 'processing'
          and claimed_at is not null
          and claimed_at < now() - make_interval(secs => p_visibility_timeout_seconds)
        )
      )
    order by created_at
    limit p_limit
    for update skip locked
  )
  returning *;
end;
$$;

create or replace function public.complete_sheet_processing(p_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.sheets
  set processing_status = 'done',
      claimed_at = null,
      claimed_by = null,
      updated_at = now()
  where id = p_id;
$$;

create or replace function public.fail_sheet_processing(p_id uuid, p_error text default null)
returns void
language sql
security definer
set search_path = public
as $$
  update public.sheets
  set processing_status = 'error',
      claimed_at = null,
      claimed_by = null,
      updated_at = now()
  where id = p_id;
$$;

revoke all on function public.claim_unparsed_sheets(integer, text, integer) from public;
revoke all on function public.complete_sheet_processing(uuid) from public;
revoke all on function public.fail_sheet_processing(uuid, text) from public;
grant execute on function public.claim_unparsed_sheets(integer, text, integer) to service_role;
grant execute on function public.complete_sheet_processing(uuid) to service_role;
grant execute on function public.fail_sheet_processing(uuid, text) to service_role;

-- ── 5. Roll up documents.sheet_index_status from child sheets ───────────────

create or replace function public.refresh_sheet_index_status(p_document_id text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_total int := 0;
  v_done int := 0;
  v_error int := 0;
  v_status text;
begin
  select
    count(*),
    count(*) filter (where processing_status = 'done'),
    count(*) filter (where processing_status = 'error')
  into v_total, v_done, v_error
  from public.sheets
  where document_id = p_document_id;

  v_status := case
    when v_total = 0 then 'pending'
    when v_error > 0 and v_done > 0 then 'partially_completed'
    when v_error > 0 then 'error'
    when v_done = v_total then 'done'
    else 'processing'
  end;

  update public.documents
  set sheet_index_status = v_status
  where id = p_document_id;

  return v_status;
end;
$$;

revoke all on function public.refresh_sheet_index_status(text) from public;
grant execute on function public.refresh_sheet_index_status(text) to service_role;

-- ── 6. pg_cron sweep for sheet-index worker (Vercel Hobby allows one daily cron) ──

create extension if not exists pg_cron;
create extension if not exists pg_net schema extensions;

do $$
begin
  perform cron.unschedule('sheet-index-worker-minutely');
exception when others then
  null;
end $$;

select cron.schedule(
  'sheet-index-worker-minutely',
  '* * * * *',
  $$
  select net.http_post(
    url := 'https://app.onyx-iron.com/api/internal/sheets/process',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-worker-secret', (
        select decrypted_secret from vault.decrypted_secrets where name = 'internal_worker_secret'
      )
    ),
    body := '{"batch_size":20}'::jsonb
  ) as request_id;
  $$
);
