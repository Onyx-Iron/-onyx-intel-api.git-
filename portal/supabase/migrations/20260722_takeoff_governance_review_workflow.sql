-- Takeoff governance: source traceability + AI-suggestion review/approval
-- workflow. Existing rows (manual/deterministic, pre-dating this migration)
-- default to 'approved' since they were either human-created or produced by
-- grounded deterministic math, not an unverified AI guess.
alter table takeoff_items
  add column if not exists created_by text,
  add column if not exists review_status text not null default 'approved'
    check (review_status in ('pending_review','approved','rejected')),
  add column if not exists reviewed_by text,
  add column if not exists reviewed_at timestamptz,
  add column if not exists rejected_reason text,
  add column if not exists geometry jsonb,
  add column if not exists document_revision text,
  add column if not exists sheet_revision text,
  add column if not exists assembly text;

create index if not exists idx_takeoff_items_review_status on takeoff_items(tenant_id, project_id, review_status);

-- Append-only lifecycle audit trail for takeoff items (created/updated/
-- deleted/approved/rejected). Deliberately no FK cascade on takeoff_item_id
-- so history survives even if the item is later hard-deleted.
create table if not exists takeoff_item_history (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  project_id uuid,
  takeoff_item_id uuid,
  action text not null check (action in ('created','updated','deleted','approved','rejected')),
  actor_user_id text,
  before jsonb,
  after jsonb,
  created_at timestamptz not null default now()
);

alter table takeoff_item_history enable row level security;

create policy tenant_isolation_select on takeoff_item_history
  for select using (tenant_id = current_tenant_id());
create policy tenant_isolation_insert on takeoff_item_history
  for insert with check (tenant_id = current_tenant_id());

create index if not exists idx_takeoff_item_history_item on takeoff_item_history(takeoff_item_id);
create index if not exists idx_takeoff_item_history_project on takeoff_item_history(tenant_id, project_id);
