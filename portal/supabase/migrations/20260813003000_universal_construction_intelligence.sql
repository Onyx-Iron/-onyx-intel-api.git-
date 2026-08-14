-- Universal construction knowledge, localized pricing, production intelligence,
-- and required scope preflight for takeoff/estimating automation.

create table if not exists public.trade_knowledge_packs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references public.tenants(id) on delete cascade,
  trade_key text not null,
  name text not null,
  masterformat_divisions text[] not null default '{}',
  uniformat_codes text[] not null default '{}',
  version integer not null default 1 check (version > 0),
  status text not null default 'draft' check (status in ('draft', 'provisional', 'certified', 'retired')),
  geography jsonb not null default '{"country":"US"}',
  effective_from date,
  effective_to date,
  certified_at timestamptz,
  certified_by text,
  source_manifest jsonb not null default '[]',
  content jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique nulls not distinct (tenant_id, trade_key, version)
);

create table if not exists public.trade_knowledge_items (
  id uuid primary key default gen_random_uuid(),
  pack_id uuid not null references public.trade_knowledge_packs(id) on delete cascade,
  tenant_id uuid references public.tenants(id) on delete cascade,
  item_kind text not null check (item_kind in ('scope', 'assembly', 'material', 'labor', 'equipment', 'production', 'means_method', 'sequence', 'quality', 'safety', 'code', 'procurement', 'risk', 'closeout')),
  item_key text not null,
  title text not null,
  body jsonb not null default '{}',
  unit text,
  confidence numeric(5,4) check (confidence between 0 and 1),
  status text not null default 'draft' check (status in ('draft', 'provisional', 'certified', 'retired')),
  source_manifest jsonb not null default '[]',
  certified_at timestamptz,
  certified_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (pack_id, item_kind, item_key)
);

create table if not exists public.price_observations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references public.tenants(id) on delete cascade,
  project_id uuid references public.projects(id) on delete cascade,
  trade_key text,
  cost_code text,
  description text not null,
  source_kind text not null check (source_kind in ('project_quote', 'company_actual', 'historical_project', 'licensed_dataset', 'public_index', 'local_market', 'ai_estimate')),
  source_ref text,
  effective_date date not null,
  expires_at date,
  country_code text not null default 'US',
  state_code text,
  metro_code text,
  postal_code text,
  unit text not null,
  currency text not null default 'USD',
  labor_cost numeric not null default 0 check (labor_cost >= 0),
  material_cost numeric not null default 0 check (material_cost >= 0),
  equipment_cost numeric not null default 0 check (equipment_cost >= 0),
  subcontract_cost numeric not null default 0 check (subcontract_cost >= 0),
  other_cost numeric not null default 0 check (other_cost >= 0),
  tax_cost numeric not null default 0 check (tax_cost >= 0),
  freight_cost numeric not null default 0 check (freight_cost >= 0),
  waste_cost numeric not null default 0 check (waste_cost >= 0),
  escalation_cost numeric not null default 0 check (escalation_cost >= 0),
  confidence numeric(5,4) not null default 0 check (confidence between 0 and 1),
  approval_status text not null default 'unreviewed' check (approval_status in ('unreviewed', 'approved', 'rejected', 'expired')),
  assumptions jsonb not null default '[]',
  created_by text,
  approved_by text,
  approved_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.production_rates (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references public.tenants(id) on delete cascade,
  project_id uuid references public.projects(id) on delete cascade,
  trade_key text not null,
  cost_code text,
  activity_key text not null,
  description text not null,
  source_kind text not null check (source_kind in ('theoretical', 'benchmark', 'company_historical', 'project_observed')),
  output_unit text not null,
  output_per_shift numeric not null check (output_per_shift > 0),
  shift_hours numeric not null default 8 check (shift_hours > 0),
  crew jsonb not null default '[]',
  equipment jsonb not null default '[]',
  conditions jsonb not null default '{}',
  confidence numeric(5,4) not null default 0 check (confidence between 0 and 1),
  approval_status text not null default 'unreviewed' check (approval_status in ('unreviewed', 'approved', 'rejected', 'expired')),
  effective_date date not null,
  source_manifest jsonb not null default '[]',
  created_by text,
  approved_by text,
  approved_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.takeoff_scope_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  requested_by text not null,
  mode text not null check (mode in ('all_scopes', 'selected_trades', 'bid_packages', 'selected_documents', 'alternates')),
  division_codes text[] not null default '{}',
  trade_keys text[] not null default '{}',
  bid_package_ids text[] not null default '{}',
  document_ids uuid[] not null default '{}',
  sheet_ids uuid[] not null default '{}',
  alternate_keys text[] not null default '{}',
  estimated_work_units integer not null check (estimated_work_units > 0),
  status text not null default 'confirmed' check (status in ('draft', 'confirmed', 'running', 'completed', 'cancelled', 'failed')),
  confirmed_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists trade_knowledge_packs_lookup_idx on public.trade_knowledge_packs (trade_key, status, effective_from desc);
create index if not exists trade_knowledge_items_pack_status_idx on public.trade_knowledge_items (pack_id, status, item_kind);
create index if not exists price_observations_lookup_idx on public.price_observations (tenant_id, project_id, cost_code, effective_date desc);
create index if not exists price_observations_market_idx on public.price_observations (state_code, metro_code, trade_key, effective_date desc);
create index if not exists production_rates_lookup_idx on public.production_rates (tenant_id, project_id, trade_key, activity_key, effective_date desc);
create index if not exists takeoff_scope_requests_project_idx on public.takeoff_scope_requests (tenant_id, project_id, created_at desc);

alter table public.trade_knowledge_packs enable row level security;
alter table public.trade_knowledge_items enable row level security;
alter table public.price_observations enable row level security;
alter table public.production_rates enable row level security;
alter table public.takeoff_scope_requests enable row level security;

alter table public.trade_knowledge_packs force row level security;
alter table public.trade_knowledge_items force row level security;
alter table public.price_observations force row level security;
alter table public.production_rates force row level security;
alter table public.takeoff_scope_requests force row level security;

do $$
declare table_name text;
begin
  foreach table_name in array array['trade_knowledge_packs','trade_knowledge_items','price_observations','production_rates','takeoff_scope_requests']
  loop
    execute format('drop policy if exists %I on public.%I', table_name || '_service_role_only', table_name);
    execute format('create policy %I on public.%I for all to service_role using (true) with check (true)', table_name || '_service_role_only', table_name);
    execute format('revoke all on table public.%I from anon, authenticated', table_name);
    execute format('grant select, insert, update, delete on table public.%I to service_role', table_name);
  end loop;
end;
$$;

comment on table public.trade_knowledge_packs is 'Versioned trade knowledge. Only certified versions with certified_at set may be presented as authoritative.';
comment on table public.price_observations is 'Source-level price evidence; deterministic application code resolves precedence, locality, freshness, and profitability.';
comment on table public.takeoff_scope_requests is 'Confirmed processing scope required before expensive automated takeoff or estimate work.';
