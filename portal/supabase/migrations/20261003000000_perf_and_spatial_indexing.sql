-- Perf + spatial indexing for estimate loading and canvas takeoff.
--
-- Adapted from the proposed 20261003_perf_and_spatial_indexing.sql to match
-- the live schema:
--   * plan_sheets does not exist → index sheets / sheet_calibrations instead
--   * audit_logs is a plain heap table (not partitioned) → BRIN on created_at
--     instead of CREATE TABLE ... PARTITION OF (which would fail)
--   * bounding_box_geom did not exist → add + backfill from jsonb coords/points
--   * postgis is installed in schema topology (not extensions) on this project

CREATE EXTENSION IF NOT EXISTS postgis;

-- PostGIS types/functions live in topology on this Supabase project.
SET search_path = public, topology;

-- ---------------------------------------------------------------------------
-- 1. Optimistic concurrency columns on estimate drafts
-- ---------------------------------------------------------------------------
ALTER TABLE estimate_versions
  ADD COLUMN IF NOT EXISTS row_version int NOT NULL DEFAULT 1;

ALTER TABLE estimate_items
  ADD COLUMN IF NOT EXISTS row_version int NOT NULL DEFAULT 1;

-- ---------------------------------------------------------------------------
-- 2. Index foreign keys for fast project / sheet loading
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_estimate_items_project_sheet
  ON estimate_items (project_id, source_sheet_id);

-- sheets is the plan-sheet registry (no plan_sheets table).
CREATE INDEX IF NOT EXISTS idx_sheets_document_page
  ON sheets (document_id, document_page_id);

-- Calibrated sheets are tracked in sheet_calibrations (unique on page_id).
CREATE INDEX IF NOT EXISTS idx_sheet_calibrations_project_active
  ON sheet_calibrations (project_id, page_id)
  WHERE active IS TRUE;

-- ---------------------------------------------------------------------------
-- 3. Time-range scans for high-volume audit / outbox (partitioning deferred)
-- ---------------------------------------------------------------------------
-- Native monthly partitions require converting audit_logs into a partitioned
-- parent first. That rewrite is intentionally out of scope here; BRIN gives
-- the same "scan recent months" win without rewriting the heap.
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at_brin
  ON audit_logs USING brin (created_at);

CREATE INDEX IF NOT EXISTS idx_estimate_sync_outbox_created_at_brin
  ON estimate_sync_outbox USING brin (created_at);

-- ---------------------------------------------------------------------------
-- 4. Fast spatial indexing for canvas takeoff shapes
-- ---------------------------------------------------------------------------
ALTER TABLE manual_measurements
  ADD COLUMN IF NOT EXISTS bounding_box_geom topology.geometry;

ALTER TABLE manual_takeoffs
  ADD COLUMN IF NOT EXISTS bounding_box_geom topology.geometry;

-- Envelope helper for a jsonb array of {x,y} points (page space).
-- Single-point counts expand to a tiny box so GIST still has an area.
CREATE OR REPLACE FUNCTION public.bbox_from_xy_points(p_points jsonb)
RETURNS topology.geometry
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, topology
AS $$
DECLARE
  v_geom topology.geometry;
BEGIN
  IF p_points IS NULL OR jsonb_typeof(p_points) <> 'array' OR jsonb_array_length(p_points) = 0 THEN
    RETURN NULL;
  END IF;

  SELECT ST_Collect(ARRAY_AGG(
    ST_MakePoint((pt->>'x')::double precision, (pt->>'y')::double precision)
  ))
  INTO v_geom
  FROM jsonb_array_elements(p_points) AS pt
  WHERE (pt->>'x') IS NOT NULL AND (pt->>'y') IS NOT NULL;

  IF v_geom IS NULL THEN
    RETURN NULL;
  END IF;

  IF ST_NPoints(v_geom) = 1 THEN
    RETURN ST_Envelope(ST_Expand(v_geom, 0.0001));
  END IF;

  RETURN ST_Envelope(v_geom);
END;
$$;

REVOKE ALL ON FUNCTION public.bbox_from_xy_points(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bbox_from_xy_points(jsonb) TO service_role;

-- Backfill legacy measurements (coords is a bare [{x,y}, ...] array).
UPDATE manual_measurements
SET bounding_box_geom = public.bbox_from_xy_points(coords)
WHERE bounding_box_geom IS NULL
  AND coords IS NOT NULL
  AND jsonb_typeof(coords) = 'array';

-- Backfill live canvas takeoffs (geometry.points).
UPDATE manual_takeoffs
SET bounding_box_geom = public.bbox_from_xy_points(geometry->'points')
WHERE bounding_box_geom IS NULL
  AND geometry ? 'points'
  AND jsonb_typeof(geometry->'points') = 'array';

CREATE INDEX IF NOT EXISTS idx_manual_measurements_coords_gist
  ON manual_measurements USING gist (bounding_box_geom);

CREATE INDEX IF NOT EXISTS idx_manual_takeoffs_bbox_gist
  ON manual_takeoffs USING gist (bounding_box_geom)
  WHERE deleted_at IS NULL;

-- Keep bbox in sync when geometry/coords change.
CREATE OR REPLACE FUNCTION public.touch_manual_measurement_bbox()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, topology
AS $$
BEGIN
  NEW.bounding_box_geom := public.bbox_from_xy_points(NEW.coords);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_manual_measurements_bbox ON manual_measurements;
CREATE TRIGGER trg_manual_measurements_bbox
  BEFORE INSERT OR UPDATE OF coords ON manual_measurements
  FOR EACH ROW EXECUTE FUNCTION public.touch_manual_measurement_bbox();

CREATE OR REPLACE FUNCTION public.touch_manual_takeoff_bbox()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, topology
AS $$
BEGIN
  NEW.bounding_box_geom := public.bbox_from_xy_points(NEW.geometry->'points');
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_manual_takeoffs_bbox ON manual_takeoffs;
CREATE TRIGGER trg_manual_takeoffs_bbox
  BEFORE INSERT OR UPDATE OF geometry ON manual_takeoffs
  FOR EACH ROW EXECUTE FUNCTION public.touch_manual_takeoff_bbox();
