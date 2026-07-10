-- Takeoff integrity milestone: align takeoff_items with the required data
-- model (ownership/source/measurement/estimating/control fields) without
-- creating duplicate sources of truth. See
-- docs/milestones/takeoff-integrity/TARGET_DATA_MODEL.md for the full
-- field-by-field justification of what was added vs. deliberately NOT
-- duplicated (e.g. no takeoff_items.estimate_item_id, since
-- estimate_items.source_takeoff_id already captures that relationship).

-- 1) Expand review_status to the canonical 4-state lifecycle
--    (suggested -> reviewed -> approved | rejected). Backfill any existing
--    'pending_review' rows (none exist today, verified before writing this
--    migration, but handled defensively) to 'suggested' before tightening
--    the CHECK constraint.
alter table takeoff_items drop constraint if exists takeoff_items_review_status_check;
update takeoff_items set review_status = 'suggested' where review_status = 'pending_review';
alter table takeoff_items add constraint takeoff_items_review_status_check
  check (review_status in ('suggested','reviewed','approved','rejected'));

-- 2) Control fields the spec requires as first-class columns rather than
--    buried in the `meta` jsonb blob.
alter table takeoff_items
  add column if not exists updated_by text,
  add column if not exists approved_by text,
  add column if not exists approved_at timestamptz,
  add column if not exists source_method text,
  add column if not exists confidence_score numeric;

-- Backfill source_method from existing meta.extraction_method where present;
-- rows with no extraction_method recorded (created before that field
-- existed) are marked 'legacy_unknown' rather than guessing — never
-- fabricate a source we can't actually verify.
update takeoff_items
set source_method = coalesce(meta->>'extraction_method', 'legacy_unknown')
where source_method is null;

-- Backfill confidence_score from meta.confidence where it's a parseable
-- number; otherwise left NULL (an explicit "not available" state — most
-- existing rows predate this field and never had a confidence value).
update takeoff_items
set confidence_score = (meta->>'confidence')::numeric
where confidence_score is null
  and meta->>'confidence' is not null
  and meta->>'confidence' ~ '^\d+(\.\d+)?$';

-- 3) Measurement/source fields: a real FK to the originating page (sheet),
-- plus documented drawing-space/scale metadata. takeoff_items already has
-- geom_local/geom_sp/geom_wgs84 (three coordinate representations) and
-- px_per_foot (the existing scale value for canvas-drawn geometry) — we
-- add labels rather than duplicate columns for those.
alter table takeoff_items
  add column if not exists sheet_id uuid references document_pages(id) on delete set null,
  add column if not exists coordinate_system text not null default 'canvas_px',
  add column if not exists scale_unit text not null default 'ft';

create index if not exists idx_takeoff_items_sheet_id on takeoff_items(sheet_id);
create index if not exists idx_takeoff_items_source_method on takeoff_items(tenant_id, project_id, source_method);

comment on column takeoff_items.type is 'measurement_type (length|area|count|volume|general|takeoff_import) — existing column, not duplicated under a new name.';
comment on column takeoff_items.unit is 'quantity_unit — existing column, not duplicated under a new name.';
comment on column takeoff_items.csi_code is 'Natural-key reference into cost_codes.csi_code (UNIQUE). A surrogate cost_code_id FK was deliberately deferred — see TARGET_DATA_MODEL.md.';
comment on column takeoff_items.px_per_foot is 'The existing "scale" value for canvas-drawn geometry (pixels per real-world foot). scale_unit documents the unit that ratio resolves to.';
comment on column takeoff_items.document_revision is 'Best-effort text snapshot of the filename-derived revision label at creation time — no document_versions table exists yet (see DOCUMENT_PIPELINE_AUDIT.md); not a surrogate FK.';
comment on column takeoff_items.sheet_revision is 'Best-effort text snapshot, same caveat as document_revision — no sheet_revisions table exists yet.';

-- 4) takeoff_item_history: approval context is already covered by the
-- existing action + actor_user_id + after columns (action='approved' +
-- actor_user_id IS the approval record) — no new columns needed there.
