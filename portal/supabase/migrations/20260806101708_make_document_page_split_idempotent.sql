-- Required by page-split-worker's retry-safe upsert. Fail loudly if historic
-- duplicates exist rather than deleting construction data automatically.
do $$
begin
  if exists (
    select 1
    from public.document_pages
    group by document_id, page_number
    having count(*) > 1
  ) then
    raise exception 'Cannot enforce document page idempotency: duplicate (document_id, page_number) rows exist';
  end if;
end
$$;

create unique index if not exists idx_document_pages_doc_page_unique
  on public.document_pages(document_id, page_number);
