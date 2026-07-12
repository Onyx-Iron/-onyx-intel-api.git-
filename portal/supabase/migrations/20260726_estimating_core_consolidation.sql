-- Estimating Core Consolidation (milestone: estimating-core-consolidation)
--
-- Makes `estimate_items` the single authoritative estimating system.
-- `project_estimates` / `project_financial_settings` (the "Pricing Matrix")
-- are preserved as read-only legacy tables, not dropped — see
-- docs/milestones/estimating-core-consolidation/DATA_MIGRATION_PLAN.md for
-- the full rationale and rollback instructions.
--
-- Adds: estimate header (`estimates`) + version (`estimate_versions`) +
-- audit trail (`estimate_audit_log`) tables; cost-category/versioning
-- columns on `estimate_items`; a trigger enforcing that approved/superseded
-- versions cannot be mutated through normal writes; and a one-time data
-- migration that wraps every project's existing `estimate_items` rows in a
-- migrated "Version 1 (approved)", and imports `project_estimates` rows as
-- a separate migrated draft version so no existing data is lost.

-- ── 1. Estimate header ──────────────────────────────────────────────────
create table if not exists estimates (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references tenants(id) on delete cascade,
  project_id         uuid not null references projects(id) on delete cascade,
  estimate_number    text not null,
  name               text not null,
  description        text,
  estimate_type      text not null default 'construction',
  buyer_type         text not null default 'general_contractor'
                     check (buyer_type in (
                       'general_contractor','developer','owner','homeowner',
                       'municipality','public_entity','property_manager','capital_partner'
                     )),
  status             text not null default 'draft'
                     check (status in ('draft','active','closed','void')),
  current_version_id uuid, -- FK added after estimate_versions exists (below)
  created_by         text,
  updated_by         text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (tenant_id, estimate_number)
);
create index if not exists idx_estimates_project on estimates(tenant_id, project_id);

-- ── 2. Estimate version ──────────────────────────────────────────────────
create table if not exists estimate_versions (
  id              uuid primary key default gen_random_uuid(),
  estimate_id     uuid not null references estimates(id) on delete cascade,
  version_number  integer not null,
  version_name    text,
  status          text not null default 'draft'
                  check (status in ('draft','review','approved','superseded','void')),
  -- Calculation inputs (percentages), stored so the version's totals are
  -- reproducible from inputs, not just as opaque stored outputs (STEP 3).
  contingency_pct numeric,
  overhead_pct    numeric,
  profit_pct      numeric,
  created_by      text,
  created_at      timestamptz not null default now(),
  approved_by     text,
  approved_at     timestamptz,
  superseded_by   uuid references estimate_versions(id),
  notes           text,
  unique (estimate_id, version_number)
);
create index if not exists idx_estimate_versions_estimate on estimate_versions(estimate_id);

alter table estimates
  add constraint estimates_current_version_fk
  foreign key (current_version_id) references estimate_versions(id);

-- ── 3. Estimate item — versioning + separated cost categories ──────────
alter table estimate_items
  add column if not exists estimate_version_id uuid references estimate_versions(id) on delete cascade,
  -- cost_code is distinct from the existing csi_code: csi_code is the
  -- classification code, cost_code is the contractor's own billing/cost
  -- code (may differ, e.g. a company-specific cost code scheme).
  add column if not exists cost_code           text,
  add column if not exists scope_category      text,
  add column if not exists source_document_id  uuid,
  add column if not exists source_sheet_id     uuid,
  add column if not exists assembly_id         uuid,
  add column if not exists labor_cost          numeric not null default 0,
  add column if not exists material_cost       numeric not null default 0,
  add column if not exists equipment_cost      numeric not null default 0,
  add column if not exists trucking_cost       numeric not null default 0,
  add column if not exists subcontract_cost    numeric not null default 0,
  add column if not exists disposal_cost       numeric not null default 0,
  add column if not exists testing_cost        numeric not null default 0,
  add column if not exists other_direct_cost   numeric not null default 0,
  add column if not exists total_direct_cost   numeric not null default 0,
  add column if not exists indirect_cost       numeric not null default 0,
  add column if not exists contingency         numeric not null default 0,
  add column if not exists overhead            numeric not null default 0,
  add column if not exists profit              numeric not null default 0,
  add column if not exists total_price         numeric not null default 0,
  add column if not exists unit_price          numeric,
  add column if not exists assumptions         text,
  add column if not exists exclusions          text,
  add column if not exists is_allowance        boolean not null default false,
  add column if not exists is_alternate        boolean not null default false,
  add column if not exists alternate_accepted  boolean not null default false,
  add column if not exists created_by          text,
  add column if not exists updated_by          text,
  -- Tags which legacy path (if any) this row was migrated from — informational only.
  add column if not exists legacy_source        text;

create index if not exists idx_estimate_items_version on estimate_items(estimate_version_id);

-- ── 4. Audit trail for financial changes (mirrors takeoff_item_history) ──
create table if not exists estimate_audit_log (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null,
  project_id       uuid,
  estimate_id      uuid,
  estimate_version_id uuid,
  entity_type      text not null, -- 'estimate' | 'version' | 'item' | 'proposal' | 'sov'
  entity_id        uuid,
  action           text not null, -- created|updated|deleted|imported|approved|superseded|generated|buyer_adjustment
  actor_user_id    text,
  before           jsonb,
  after            jsonb,
  created_at       timestamptz not null default now()
);
create index if not exists idx_estimate_audit_log_estimate on estimate_audit_log(estimate_id, created_at);
create index if not exists idx_estimate_audit_log_tenant on estimate_audit_log(tenant_id, created_at);

-- ── 5. Proposal + SOV snapshots (reference exactly one approved version) ─
create table if not exists estimate_proposals (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            uuid not null,
  project_id           uuid not null,
  estimate_id          uuid not null references estimates(id) on delete cascade,
  estimate_version_id  uuid not null references estimate_versions(id),
  proposal_number      text not null,
  contractor_info      jsonb not null default '{}',
  customer_info        jsonb not null default '{}',
  project_info         jsonb not null default '{}',
  scope                text,
  alternates           jsonb not null default '[]',
  allowances           jsonb not null default '[]',
  assumptions          text,
  exclusions           text,
  clarifications       text,
  payment_terms        text,
  schedule_assumptions text,
  validity_days        integer not null default 30,
  total_price          numeric not null,
  created_by           text,
  created_at           timestamptz not null default now()
);
create index if not exists idx_estimate_proposals_version on estimate_proposals(estimate_version_id);

create table if not exists estimate_sov (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            uuid not null,
  project_id           uuid not null,
  estimate_id          uuid not null references estimates(id) on delete cascade,
  estimate_version_id  uuid not null references estimate_versions(id),
  group_by             text not null default 'cost_code'
                       check (group_by in ('cost_code','division','scope_category','phase','custom')),
  rows                 jsonb not null,
  total_price          numeric not null,
  created_by           text,
  created_at           timestamptz not null default now()
);
create index if not exists idx_estimate_sov_version on estimate_sov(estimate_version_id);

-- ── 6. Immutability trigger — approved/superseded/void versions cannot be
--       mutated through normal INSERT/UPDATE/DELETE on estimate_items.
--       Defense-in-depth: the API layer is expected to block this first
--       (and produce a friendlier error), but this makes it a hard DB
--       guarantee regardless of which code path writes the row.
create or replace function prevent_locked_estimate_item_write() returns trigger
language plpgsql as $$
declare
  v_status text;
begin
  if tg_op = 'INSERT' then
    -- A brand-new row being added directly into an already-locked version
    -- is itself a silent edit to that version — block it. (Rows migrated
    -- into a version at the moment it's first created, e.g. the initial
    -- data migration inserting into a fresh 'draft' version, are unaffected.)
    if new.estimate_version_id is null then
      return new;
    end if;
    select status into v_status from estimate_versions where id = new.estimate_version_id;
    if v_status in ('approved', 'superseded', 'void') then
      raise exception 'Cannot insert an estimate_item into a % estimate version (id=%)', v_status, new.estimate_version_id;
    end if;
    return new;
  end if;

  -- UPDATE/DELETE: only block if the row's PRIOR state already belonged to
  -- a locked version. This intentionally does NOT look at NEW's version —
  -- it must not block the one-time backfill that assigns a version_id to a
  -- previously-unversioned row (OLD.estimate_version_id is null there),
  -- while still blocking any edit to a row that was already locked.
  if old.estimate_version_id is null then
    return coalesce(new, old);
  end if;
  select status into v_status from estimate_versions where id = old.estimate_version_id;
  if v_status in ('approved', 'superseded', 'void') then
    raise exception 'Cannot % an estimate_item belonging to a % estimate version (id=%)',
      lower(tg_op), v_status, old.estimate_version_id;
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_lock_estimate_items on estimate_items;
create trigger trg_lock_estimate_items
  before insert or update or delete on estimate_items
  for each row execute function prevent_locked_estimate_item_write();

-- ── 7. Data migration — wrap existing estimate_items in a migrated,
--       approved "Version 1", per project. Must run before the trigger
--       would apply to these rows (their estimate_version_id is currently
--       null, so the trigger no-ops for existing rows until this backfill
--       assigns them a version — see the trigger's null-guard above).
do $$
declare
  proj record;
  new_estimate_id uuid;
  new_version_id uuid;
  legacy_direct_total numeric;
  migrated_direct_total numeric;
begin
  for proj in
    select distinct tenant_id, project_id
    from estimate_items
    where estimate_version_id is null
  loop
    select coalesce(sum(coalesce(quantity, 0) * coalesce(unit_cost, 0)), 0)
      into legacy_direct_total
      from estimate_items
      where tenant_id = proj.tenant_id and project_id = proj.project_id
        and estimate_version_id is null;

    insert into estimates (tenant_id, project_id, estimate_number, name, description, status)
    values (
      proj.tenant_id, proj.project_id,
      'EST-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8),
      'Migrated Estimate', 'Auto-created during estimating-core-consolidation migration to wrap pre-existing estimate_items.',
      'active'
    )
    returning id into new_estimate_id;

    insert into estimate_versions (estimate_id, version_number, version_name, status, created_at, approved_by, approved_at, notes)
    values (
      new_estimate_id, 1, 'Version 1 (migrated)', 'approved', now(), 'system_migration', now(),
      'Migrated from pre-versioning estimate_items. Original rows unit_cost preserved as other_direct_cost (no cost-category breakdown existed pre-migration).'
    )
    returning id into new_version_id;

    update estimates set current_version_id = new_version_id where id = new_estimate_id;

    update estimate_items
    set estimate_version_id = new_version_id,
        other_direct_cost = coalesce(quantity, 0) * coalesce(unit_cost, 0),
        total_direct_cost = coalesce(quantity, 0) * coalesce(unit_cost, 0),
        total_price = coalesce(quantity, 0) * coalesce(unit_cost, 0),
        unit_price = unit_cost,
        legacy_source = 'estimate_items_pre_versioning'
    where tenant_id = proj.tenant_id and project_id = proj.project_id
      and estimate_version_id is null;

    select coalesce(sum(total_price), 0) into migrated_direct_total
      from estimate_items where estimate_version_id = new_version_id;

    if abs(legacy_direct_total - migrated_direct_total) > 0.01 then
      raise exception 'Reconciliation failure for project %: legacy total % != migrated total %',
        proj.project_id, legacy_direct_total, migrated_direct_total;
    end if;
  end loop;
end $$;

-- ── 8. Data migration — import project_estimates (Pricing Matrix) rows as
--       a separate migrated DRAFT version per project (draft, not approved,
--       since the matrix had no approval concept — a human should review
--       and approve it explicitly through the new workflow).
do $$
declare
  proj record;
  target_estimate_id uuid;
  new_version_id uuid;
  next_version_number integer;
  settings record;
  legacy_total numeric;
  migrated_total numeric;
  r record;
  v_labor numeric; v_material numeric; v_equipment numeric; v_sub numeric; v_trucking numeric; v_disposal numeric;
  v_direct numeric; v_contingency numeric; v_overhead numeric; v_profit numeric; v_price numeric;
  v_source_takeoff_id uuid;
begin
  for proj in
    select distinct tenant_id, project_id from project_estimates
  loop
    select id into target_estimate_id from estimates
      where tenant_id = proj.tenant_id and project_id = proj.project_id
      order by created_at asc limit 1;

    if target_estimate_id is null then
      insert into estimates (tenant_id, project_id, estimate_number, name, description, status)
      values (
        proj.tenant_id, proj.project_id,
        'EST-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8),
        'Migrated Estimate', 'Auto-created during estimating-core-consolidation migration to wrap pre-existing project_estimates.',
        'active'
      )
      returning id into target_estimate_id;
    end if;

    select coalesce(max(version_number), 0) + 1 into next_version_number
      from estimate_versions where estimate_id = target_estimate_id;

    select * into settings from project_financial_settings
      where tenant_id = proj.tenant_id and project_id = proj.project_id;

    insert into estimate_versions (
      estimate_id, version_number, version_name, status, created_at, notes,
      contingency_pct, overhead_pct, profit_pct
    ) values (
      target_estimate_id, next_version_number, 'Migrated Pricing Matrix (draft)', 'draft', now(),
      'Migrated from project_estimates (legacy Pricing Matrix). Left as a draft — the matrix had no approval workflow, so this must be reviewed and explicitly approved.',
      coalesce(settings.contingency_pct, 5), coalesce(settings.overhead_pct, 10), coalesce(settings.profit_pct, 15)
    )
    returning id into new_version_id;

    select coalesce(sum(
      coalesce(quantity,0) * (coalesce(labor_unit,0) + coalesce(material_unit,0) + coalesce(equipment_unit,0)
        + coalesce(subcontractor_unit,0) + coalesce(trucking_unit,0) + coalesce(disposal_unit,0))
    ), 0) into legacy_total
    from project_estimates where tenant_id = proj.tenant_id and project_id = proj.project_id;

    migrated_total := 0;
    for r in select * from project_estimates where tenant_id = proj.tenant_id and project_id = proj.project_id
    loop
      v_labor := coalesce(r.quantity,0) * coalesce(r.labor_unit,0);
      v_material := coalesce(r.quantity,0) * coalesce(r.material_unit,0);
      v_equipment := coalesce(r.quantity,0) * coalesce(r.equipment_unit,0);
      v_sub := coalesce(r.quantity,0) * coalesce(r.subcontractor_unit,0);
      v_trucking := coalesce(r.quantity,0) * coalesce(r.trucking_unit,0);
      v_disposal := coalesce(r.quantity,0) * coalesce(r.disposal_unit,0);
      v_direct := v_labor + v_material + v_equipment + v_sub + v_trucking + v_disposal;
      v_contingency := v_direct * (coalesce(settings.contingency_pct, 5) / 100);
      v_overhead := (v_direct + v_contingency) * (coalesce(settings.overhead_pct, 10) / 100);
      v_profit := (v_direct + v_contingency + v_overhead) * (coalesce(settings.profit_pct, 15) / 100);
      v_price := v_direct + v_contingency + v_overhead + v_profit;
      migrated_total := migrated_total + v_direct;

      -- takeoff_id on project_estimates is an unconstrained uuid column (no
      -- FK) — only carry it over as source_takeoff_id if it actually
      -- resolves to a real takeoff_items row, since estimate_items.
      -- source_takeoff_id DOES have a FK and would otherwise abort the
      -- whole migration on a single stale/garbage reference.
      select id into v_source_takeoff_id from takeoff_items where id = r.takeoff_id;

      insert into estimate_items (
        tenant_id, project_id, estimate_version_id, cost_code, csi_code, description, item_type,
        quantity, uom, source_takeoff_id, labor_cost, material_cost, equipment_cost,
        subcontract_cost, trucking_cost, disposal_cost, total_direct_cost, contingency, overhead,
        profit, total_price, unit_price, notes, pricing_status, legacy_source, sort_order
      ) values (
        proj.tenant_id, proj.project_id, new_version_id, r.cost_code, r.cost_code, coalesce(r.description, 'Migrated line item'), 'material',
        r.quantity, r.unit, v_source_takeoff_id, v_labor, v_material, v_equipment,
        v_sub, v_trucking, v_disposal, v_direct, v_contingency, v_overhead,
        v_profit, v_price, case when coalesce(r.quantity,0) <> 0 then v_price / r.quantity else null end,
        r.notes, 'priced', 'project_estimates_pricing_matrix', coalesce(r.sort_order, 0)
      );
    end loop;

    if abs(legacy_total - migrated_total) > 0.01 then
      raise exception 'Reconciliation failure (project_estimates) for project %: legacy direct total % != migrated %',
        proj.project_id, legacy_total, migrated_total;
    end if;
  end loop;
end $$;

-- ── 9. Mark legacy tables ────────────────────────────────────────────────
comment on table project_estimates is
  'DEPRECATED (estimating-core-consolidation migration). Superseded by estimate_items + estimate_versions. Left in place, read-only in the application layer, for historical reference. Do not add new writes here — see docs/milestones/estimating-core-consolidation/.';
comment on table project_financial_settings is
  'DEPRECATED (estimating-core-consolidation migration). Values were migrated onto the corresponding estimate_versions row (contingency_pct/overhead_pct/profit_pct). Left in place for historical reference only.';
