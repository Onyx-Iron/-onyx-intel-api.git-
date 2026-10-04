-- refresh_document_processing_summary is SECURITY DEFINER and rewrites a
-- document's status by id, with no tenant check. Creating it granted EXECUTE
-- to anon and authenticated through default privileges. Revoking PUBLIC
-- leaves those grants, so a browser key can mark another tenant's plan
-- complete or clear its processing error.

REVOKE EXECUTE ON FUNCTION public.refresh_document_processing_summary(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_document_processing_summary(text) TO service_role;
