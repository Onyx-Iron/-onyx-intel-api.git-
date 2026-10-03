-- XD-02: first-class chunk provenance for RAG.
--
-- document_chunks (async page-processor) and chunks (sync portal ingest)
-- gain a meta jsonb bag for parser_id, heading_path, bbox, confidence.
-- page_number stays a real column; meta carries parser provenance.
--
-- match_document_chunks returns meta so /api/documents/ask can cite
-- headings / parser without a second round-trip.

alter table public.document_chunks
  add column if not exists meta jsonb not null default '{}'::jsonb;

alter table public.chunks
  add column if not exists meta jsonb not null default '{}'::jsonb;

create index if not exists idx_document_chunks_meta_parser
  on public.document_chunks ((meta->>'parser_id'));

create index if not exists idx_chunks_meta_parser
  on public.chunks ((meta->>'parser_id'));

-- CREATE OR REPLACE cannot change RETURNS TABLE shape (42P13). Drop first.
drop function if exists public.match_document_chunks(vector, uuid, text, integer);

create function public.match_document_chunks(
  query_embedding vector,
  match_tenant_id uuid,
  match_document_id text,
  match_count integer default 8
)
returns table(
  content text,
  page_number integer,
  similarity double precision,
  meta jsonb
)
language plpgsql
set search_path to 'public'
as $function$
begin
  return query
  select
    u.content,
    u.page_number,
    1 - (u.embedding <=> query_embedding) as similarity,
    u.meta
  from (
    select c.content, c.page_number, c.embedding, c.meta
    from chunks c
    where c.tenant_id = match_tenant_id
      and c.document_id = match_document_id
      and c.embedding is not null
    union all
    select dc.content, dc.page_number, dc.embedding, dc.meta
    from document_chunks dc
    where dc.tenant_id = match_tenant_id
      and dc.document_id = match_document_id
      and dc.embedding is not null
  ) u
  order by u.embedding <=> query_embedding
  limit match_count;
end;
$function$;

revoke all on function public.match_document_chunks(vector, uuid, text, integer) from public;
grant execute on function public.match_document_chunks(vector, uuid, text, integer) to service_role;
