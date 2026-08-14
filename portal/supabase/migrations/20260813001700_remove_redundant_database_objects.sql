-- Earlier replay migrations created equivalent tenant policies twice and an
-- explicit unique index already supplied by the document-pages constraint.

drop policy if exists tenant_isolation_contacts on public.contacts;
drop policy if exists tenant_isolation_project_notes on public.project_notes;
drop index if exists public.idx_document_pages_doc_page_unique;
