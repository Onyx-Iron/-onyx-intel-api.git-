-- Cover every remaining foreign-key lookup identified by the Supabase
-- performance advisor. Nullable relationship indexes stay compact.

create index if not exists idx_bid_opportunities_estimate_version_fk
  on public.bid_opportunities(linked_estimate_version_id)
  where linked_estimate_version_id is not null;
create index if not exists idx_bid_opportunities_project_fk
  on public.bid_opportunities(linked_project_id)
  where linked_project_id is not null;
create index if not exists idx_change_order_items_project_fk
  on public.change_order_items(project_id);
create index if not exists idx_company_users_tenant_fk
  on public.company_users(tenant_id);
create index if not exists idx_cost_overrides_cost_code_fk
  on public.cost_overrides(cost_code_id);
create index if not exists idx_document_processing_events_page_fk
  on public.document_processing_events(document_page_id)
  where document_page_id is not null;
create index if not exists idx_estimate_proposals_estimate_fk
  on public.estimate_proposals(estimate_id);
create index if not exists idx_estimate_sov_estimate_fk
  on public.estimate_sov(estimate_id);
create index if not exists idx_estimate_versions_superseded_by_fk
  on public.estimate_versions(superseded_by)
  where superseded_by is not null;
create index if not exists idx_estimates_current_version_fk
  on public.estimates(current_version_id)
  where current_version_id is not null;
create index if not exists idx_estimates_project_fk
  on public.estimates(project_id);
create index if not exists idx_rfi_items_project_fk
  on public.rfi_items(project_id);
create index if not exists idx_sheets_supersedes_fk
  on public.sheets(supersedes_sheet_id)
  where supersedes_sheet_id is not null;
create index if not exists idx_sheets_superseded_by_fk
  on public.sheets(superseded_by_sheet_id)
  where superseded_by_sheet_id is not null;
create index if not exists idx_submittal_items_project_fk
  on public.submittal_items(project_id);
