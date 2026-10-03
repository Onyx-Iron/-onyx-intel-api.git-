-- Spatial bounding boxes, partial indexes for unfinished sheets, and an
-- unlogged stage for transient outbox traffic.
--
-- The requested names (manual_measurements.bounding_box, plan_sheets.file_id,
-- plan_sheets.is_calibrated, estimate_items geometry) are not columns in this
-- schema. This migration uses the tables that actually store polygons and the
-- queues the workers actually poll.
--
-- estimate_items is a money table. It has no coordinates. Bounding-box lookup
-- stays on the takeoff geometry those lines point at through source_takeoff_id.
-- takeoff_items.geom_local / geom_sp / geom_wgs84 already have GiST indexes;
-- those stay. The new SP-GiST indexes cover the JSON point rings the canvas
-- writes, which had no spatial index.
--
-- estimate_sync_outbox stays LOGGED. It is written in the same transaction as
-- the canvas save, and a crash must not drop those events. UNLOGGED tables are
-- emptied on crash and are not replicated. The new stage is only for transient
-- event traffic that can be lost.

CREATE OR REPLACE FUNCTION public.jsonb_points_box(p_points jsonb)
RETURNS box
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = pg_catalog
AS $$
  SELECT CASE
    WHEN p_points IS NULL
      OR jsonb_typeof(p_points) IS DISTINCT FROM 'array'
      OR jsonb_array_length(p_points) = 0
    THEN NULL::box
    ELSE (
      SELECT CASE
        WHEN min(x) IS NULL OR min(y) IS NULL THEN NULL::box
        ELSE box(point(min(x), min(y)), point(max(x), max(y)))
      END
      FROM (
        SELECT x, y
        FROM (
          SELECT
            CASE
              WHEN jsonb_typeof(pt -> 'x') = 'number' THEN (pt ->> 'x')::float8
              WHEN (pt ->> 'x') ~ '^[+-]?[0-9]+(\.[0-9]+)?([eE][+-]?[0-9]+)?$' THEN (pt ->> 'x')::float8
            END AS x,
            CASE
              WHEN jsonb_typeof(pt -> 'y') = 'number' THEN (pt ->> 'y')::float8
              WHEN (pt ->> 'y') ~ '^[+-]?[0-9]+(\.[0-9]+)?([eE][+-]?[0-9]+)?$' THEN (pt ->> 'y')::float8
            END AS y
          FROM jsonb_array_elements(p_points) AS pt
        ) raw
        WHERE x IS NOT NULL AND y IS NOT NULL
      ) coords
    )
  END;
$$;

COMMENT ON FUNCTION public.jsonb_points_box(jsonb) IS
  'Axis-aligned box around a JSON array of {x,y} points. Invalid points are ignored. Empty or non-array input returns null.';

REVOKE ALL ON FUNCTION public.jsonb_points_box(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.jsonb_points_box(jsonb) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.jsonb_points_box(jsonb) TO service_role;

ALTER TABLE public.manual_takeoffs
  ADD COLUMN IF NOT EXISTS bounding_box box
  GENERATED ALWAYS AS (
    public.jsonb_points_box(
      CASE
        WHEN jsonb_typeof(geometry) = 'array' THEN geometry
        ELSE geometry -> 'points'
      END
    )
  ) STORED;

ALTER TABLE public.manual_measurements
  ADD COLUMN IF NOT EXISTS bounding_box box
  GENERATED ALWAYS AS (public.jsonb_points_box(coords)) STORED;

ALTER TABLE public.takeoff_items
  ADD COLUMN IF NOT EXISTS bounding_box box
  GENERATED ALWAYS AS (
    public.jsonb_points_box(
      CASE
        WHEN jsonb_typeof(geometry) = 'array' THEN geometry
        WHEN jsonb_typeof(geometry -> 'points') = 'array' THEN geometry -> 'points'
        WHEN jsonb_typeof(points) = 'array' THEN points
        ELSE NULL::jsonb
      END
    )
  ) STORED;

COMMENT ON COLUMN public.manual_takeoffs.bounding_box IS
  'Stored box around geometry.points. Overlap queries use && against this column.';
COMMENT ON COLUMN public.manual_measurements.bounding_box IS
  'Stored box around the coords point array.';
COMMENT ON COLUMN public.takeoff_items.bounding_box IS
  'Stored box around geometry.points, or the points column when geometry has no ring.';

-- SP-GiST box_ops accelerates &&, <<, >>, and the other box operators.
CREATE INDEX IF NOT EXISTS idx_manual_takeoffs_bbox
  ON public.manual_takeoffs USING spgist (bounding_box)
  WHERE bounding_box IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_manual_measurements_bbox
  ON public.manual_measurements USING spgist (bounding_box)
  WHERE bounding_box IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_takeoff_items_bbox
  ON public.takeoff_items USING spgist (bounding_box)
  WHERE bounding_box IS NOT NULL;

-- Canvas and projected geometry that is already a PostGIS value. GiST indexes
-- on these columns stay in place for operators SP-GiST does not cover.
CREATE INDEX IF NOT EXISTS idx_takeoff_items_geom_local_spgist
  ON public.takeoff_items USING spgist (geom_local topology.spgist_geometry_ops_2d)
  WHERE geom_local IS NOT NULL;

-- document_pages is the sheet file the OCR and takeoff workers poll.
-- document_id is the file id. Rows leave this index once both workers are done.
CREATE INDEX IF NOT EXISTS idx_unparsed_sheets
  ON public.document_pages (document_id)
  WHERE status IS DISTINCT FROM 'done'
     OR takeoff_status IS DISTINCT FROM 'done';

-- Classified plan sheets that still need the sheet worker.
CREATE INDEX IF NOT EXISTS idx_sheets_unprocessed
  ON public.sheets (document_id)
  WHERE processing_status IS DISTINCT FROM 'done';

-- Pages whose calibration has not been verified. There is no is_calibrated flag.
CREATE INDEX IF NOT EXISTS idx_sheet_calibrations_unverified
  ON public.sheet_calibrations (page_id)
  WHERE verified IS NOT TRUE;

-- Transient event buffer. Crash recovery truncates this table. Do not put the
-- canvas save's estimate_sync_outbox row here.
CREATE UNLOGGED TABLE IF NOT EXISTS public.outbox_event_stage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  manual_takeoff_id uuid NOT NULL,
  event_type text NOT NULL CHECK (event_type IN ('upsert', 'delete')),
  payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_outbox_event_stage_created
  ON public.outbox_event_stage (created_at);

COMMENT ON TABLE public.outbox_event_stage IS
  'UNLOGGED buffer for transient outbox traffic. Emptied on crash and not replicated. Durable estimate sync stays in estimate_sync_outbox.';

ALTER TABLE public.outbox_event_stage ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS outbox_event_stage_service_role_all ON public.outbox_event_stage;
CREATE POLICY outbox_event_stage_service_role_all
  ON public.outbox_event_stage
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

REVOKE ALL ON TABLE public.outbox_event_stage FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.outbox_event_stage TO service_role;
