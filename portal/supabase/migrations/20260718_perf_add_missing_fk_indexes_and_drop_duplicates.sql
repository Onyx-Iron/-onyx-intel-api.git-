-- Performance advisor cleanup: 9 foreign-key columns had no covering index
-- (slow joins and ON DELETE CASCADE/SET NULL sweeps), and 5 indexes were
-- exact duplicates of another index already covering the same columns
-- (pure write-overhead + storage waste with zero benefit). Verified via
-- pg_constraint/pg_index which duplicate in each pair backed a UNIQUE
-- constraint before dropping — kept the constraint-backed one in every case.
CREATE INDEX IF NOT EXISTS idx_document_intelligence_document_id ON public.document_intelligence(document_id);
CREATE INDEX IF NOT EXISTS idx_memories_source_document_id ON public.memories(source_document_id);
CREATE INDEX IF NOT EXISTS idx_conversations_tenant_id ON public.conversations(tenant_id);
CREATE INDEX IF NOT EXISTS idx_messages_tenant_id ON public.messages(tenant_id);
CREATE INDEX IF NOT EXISTS idx_cost_actuals_cost_code_id ON public.cost_actuals(cost_code_id);
CREATE INDEX IF NOT EXISTS idx_civil_pipe_runs_page_id ON public.civil_pipe_runs(page_id);
CREATE INDEX IF NOT EXISTS idx_company_users_role_id ON public.company_users(role_id);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_vendor_bid_id ON public.purchase_orders(vendor_bid_id);
CREATE INDEX IF NOT EXISTS idx_marketing_campaigns_company_id ON public.marketing_campaigns(company_id);

DROP INDEX IF EXISTS public.idx_contacts_project;
DROP INDEX IF EXISTS public.idx_contacts_tenant;
DROP INDEX IF EXISTS public.idx_notes_project;
DROP INDEX IF EXISTS public.idx_document_pages_document;
DROP INDEX IF EXISTS public.idx_companies_tenant;
