-- Fast lookup for idempotent takeoff saves/imports.
-- source_fingerprint lives in meta so older rows keep working without a table rewrite.
create index if not exists takeoff_items_source_fingerprint_idx
  on public.takeoff_items (
    tenant_id,
    project_id,
    ((meta ->> 'source_fingerprint'))
  )
  where meta ? 'source_fingerprint';
