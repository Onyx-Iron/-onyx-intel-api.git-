-- Onyx Intel — Production PostGIS Schema
-- Requires: PostgreSQL 15+, PostGIS 3.x extension
-- Run: psql -U postgres -d onyx_intel -f schema.sql
-- Or:  DATABASE_URL=postgresql://localhost/onyx_intel node -e "import('./lib/db.js').then(m=>m.runSchema())"

CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS postgis_topology;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ── Documents ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS documents (
  id           TEXT        PRIMARY KEY,
  file_name    TEXT        NOT NULL,
  page_count   INTEGER     DEFAULT 0,
  status       TEXT        NOT NULL DEFAULT 'pending',
  project_id   TEXT,
  uploaded_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ,
  meta         JSONB       DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_documents_project ON documents(project_id);

-- ── Takeoff Items ─────────────────────────────────────────────────────────
-- geom_local  : plan-pixel coordinates, no CRS (SRID=0)
-- geom_sp     : State Plane TX North Central, EPSG:2276, US Survey Feet
-- geom_wgs84  : WGS84 lat/lng, EPSG:4326, for GeoJSON / web-map export
CREATE TABLE IF NOT EXISTS takeoff_items (
  id            UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  document_id   TEXT        NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  project_id    TEXT,
  page          INTEGER     NOT NULL,
  type          TEXT        NOT NULL CHECK (type IN ('length','area','perim','count','volume')),
  label         TEXT,
  quantity      NUMERIC(18,4),
  unit          TEXT,
  rate          NUMERIC(18,4),
  csi_code      TEXT,
  division      TEXT,
  points        JSONB,
  -- native geometry — populated after geo calibration
  geom_local    GEOMETRY(GEOMETRY, 0),
  geom_sp       GEOMETRY(GEOMETRY, 2276),
  geom_wgs84    GEOMETRY(GEOMETRY, 4326),
  px_per_foot   NUMERIC(12,6),
  geo_calib     JSONB,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  meta          JSONB       DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_takeoff_document  ON takeoff_items(document_id);
CREATE INDEX IF NOT EXISTS idx_takeoff_project   ON takeoff_items(project_id);
CREATE INDEX IF NOT EXISTS idx_takeoff_page      ON takeoff_items(document_id, page);
CREATE INDEX IF NOT EXISTS idx_takeoff_type      ON takeoff_items(type);
CREATE INDEX IF NOT EXISTS idx_takeoff_csi       ON takeoff_items(csi_code);

-- GIST spatial indexes — enable ST_DWithin, ST_Intersects in O(log n) time
CREATE INDEX IF NOT EXISTS idx_geom_sp     ON takeoff_items USING GIST(geom_sp);
CREATE INDEX IF NOT EXISTS idx_geom_wgs84  ON takeoff_items USING GIST(geom_wgs84);
CREATE INDEX IF NOT EXISTS idx_geom_local  ON takeoff_items USING GIST(geom_local);

-- ── Schedule Tasks (CPM) ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS schedule_tasks (
  id           UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id   TEXT        NOT NULL,
  name         TEXT        NOT NULL,
  duration     INTEGER     NOT NULL DEFAULT 1,   -- in working days
  deps         TEXT[]      DEFAULT '{}',          -- predecessor task IDs
  status       TEXT        NOT NULL DEFAULT 'pending'
                           CHECK (status IN ('pending','in_progress','complete','blocked')),
  -- CPM computed fields — recomputed whenever any task in the project changes
  es           INTEGER,    -- Early Start  (working days from project start)
  ef           INTEGER,    -- Early Finish
  ls           INTEGER,    -- Late Start
  lf           INTEGER,    -- Late Finish
  total_float  INTEGER,
  free_float   INTEGER,
  critical     BOOLEAN     DEFAULT false,
  -- Absolute calendar dates derived from CPM + project start
  start_date   DATE,
  end_date     DATE,
  ls_date      DATE,
  lf_date      DATE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  meta         JSONB       DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_tasks_project  ON schedule_tasks(project_id);
CREATE INDEX IF NOT EXISTS idx_tasks_critical ON schedule_tasks(project_id, critical);

-- ── Geo Calibrations ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS geo_calibrations (
  document_id       TEXT PRIMARY KEY REFERENCES documents(id) ON DELETE CASCADE,
  crs               TEXT  NOT NULL DEFAULT 'sp2276',
  control_pts       JSONB NOT NULL DEFAULT '[]',
  fwd_matrix        JSONB,          -- [[a,b,tx],[c,d,ty]] affine plan-px → world
  inv_matrix        JSONB,
  scale_ft_per_px   NUMERIC(12,6),
  angle_deg         NUMERIC(8,4),
  rmse_ft           NUMERIC(10,6),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── items_within_ft() — find all items within N feet of a WGS84 point ────
-- SELECT * FROM items_within_ft('doc-id', -96.797, 32.776, 5.0)
CREATE OR REPLACE FUNCTION items_within_ft(
  p_doc_id TEXT,
  p_lng    DOUBLE PRECISION,
  p_lat    DOUBLE PRECISION,
  p_feet   DOUBLE PRECISION
)
RETURNS SETOF takeoff_items
LANGUAGE SQL STABLE AS $$
  SELECT *
  FROM   takeoff_items
  WHERE  document_id = p_doc_id
    AND  geom_wgs84 IS NOT NULL
    AND  ST_DWithin(
           geom_wgs84::geography,
           ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography,
           p_feet * 0.3048   -- feet → meters (geography uses meters)
         );
$$;

-- ── items_intersecting() — items whose footprint overlaps a polygon ───────
CREATE OR REPLACE FUNCTION items_intersecting(
  p_doc_id TEXT,
  p_geojson TEXT  -- GeoJSON polygon string
)
RETURNS SETOF takeoff_items
LANGUAGE SQL STABLE AS $$
  SELECT *
  FROM   takeoff_items
  WHERE  document_id = p_doc_id
    AND  geom_wgs84 IS NOT NULL
    AND  ST_Intersects(geom_wgs84, ST_GeomFromGeoJSON(p_geojson));
$$;

-- ── Materialized view: pre-computed pairwise spatial relationships ─────────
-- Refreshed after bulk calibration or ingestion:
--   REFRESH MATERIALIZED VIEW CONCURRENTLY item_spatial_summary;
CREATE MATERIALIZED VIEW IF NOT EXISTS item_spatial_summary AS
SELECT
  a.id           AS item_id_a,
  b.id           AS item_id_b,
  a.document_id,
  a.type         AS type_a,
  b.type         AS type_b,
  a.label        AS label_a,
  b.label        AS label_b,
  ROUND((ST_Distance(a.geom_wgs84::geography, b.geom_wgs84::geography) * 3.28084)::NUMERIC, 2)
                 AS dist_ft,
  ST_Intersects(a.geom_wgs84, b.geom_wgs84) AS intersects
FROM   takeoff_items a
JOIN   takeoff_items b
  ON   a.document_id = b.document_id
 AND   a.id < b.id
WHERE  a.geom_wgs84 IS NOT NULL
  AND  b.geom_wgs84 IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uidx_spatial_summary
  ON item_spatial_summary(item_id_a, item_id_b);
CREATE INDEX IF NOT EXISTS idx_spatial_summary_doc
  ON item_spatial_summary(document_id, dist_ft);

-- ── updated_at trigger ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION _set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='trg_takeoff_updated_at') THEN
    CREATE TRIGGER trg_takeoff_updated_at
      BEFORE UPDATE ON takeoff_items
      FOR EACH ROW EXECUTE FUNCTION _set_updated_at();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='trg_tasks_updated_at') THEN
    CREATE TRIGGER trg_tasks_updated_at
      BEFORE UPDATE ON schedule_tasks
      FOR EACH ROW EXECUTE FUNCTION _set_updated_at();
  END IF;
END $$;
