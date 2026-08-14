-- Cover project/tenant foreign keys identified by the post-migration advisor.
-- Existing composite lookup indexes do not lead with these foreign-key columns.

create index if not exists price_observations_project_id_idx
  on public.price_observations (project_id)
  where project_id is not null;

create index if not exists production_rates_project_id_idx
  on public.production_rates (project_id)
  where project_id is not null;

create index if not exists takeoff_scope_requests_project_id_idx
  on public.takeoff_scope_requests (project_id);

create index if not exists trade_knowledge_items_tenant_id_idx
  on public.trade_knowledge_items (tenant_id)
  where tenant_id is not null;
