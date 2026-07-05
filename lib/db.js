// PostgreSQL / PostGIS connection pool.
// Requires pg npm package and DATABASE_URL env var.
// The app runs fine without this — all DB operations degrade gracefully.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let pool = null;
let _available = null; // cached availability check

async function getPool() {
  if (pool) return pool;
  try {
    const { default: pkg } = await import('pg');
    const Pool = pkg.Pool;
    pool = new Pool({
      connectionString: process.env.DATABASE_URL || 'postgresql://localhost/onyx_intel',
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 3000,
    });
    pool.on('error', (err) => console.warn('[pg] idle client error:', err.message));
    return pool;
  } catch (e) {
    console.warn('[pg] pg package not available — spatial storage disabled');
    return null;
  }
}

export async function pgAvailable() {
  if (_available !== null) return _available;
  try {
    const p = await getPool();
    if (!p) return (_available = false);
    await p.query('SELECT PostGIS_Version()');
    console.log('[pg] PostGIS connected');
    return (_available = true);
  } catch {
    return (_available = false);
  }
}

export async function query(sql, params = []) {
  const p = await getPool();
  if (!p) throw new Error('PostgreSQL not available');
  const client = await p.connect();
  try {
    return await client.query(sql, params);
  } finally {
    client.release();
  }
}

// Run schema.sql — call once during server startup or via CLI.
export async function runSchema() {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8');
  const p = await getPool();
  if (!p) throw new Error('No pg connection');
  await p.query(sql);
  console.log('[pg] schema applied');
}

// ── Takeoff Items ──────────────────────────────────────────────────────────

export async function upsertTakeoffItem(item) {
  const geomJson = pointsToGeoJSON(item.type, item.points);
  return query(`
    INSERT INTO takeoff_items
      (id, document_id, project_id, page, type, label, quantity, unit, rate,
       csi_code, division, points, geom_local, px_per_foot, geo_calib, meta)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,
            ST_SetSRID(ST_GeomFromGeoJSON($13),0),
            $14,$15,$16)
    ON CONFLICT (id) DO UPDATE SET
      quantity    = EXCLUDED.quantity,
      unit        = EXCLUDED.unit,
      rate        = EXCLUDED.rate,
      points      = EXCLUDED.points,
      geom_local  = EXCLUDED.geom_local,
      px_per_foot = EXCLUDED.px_per_foot,
      geo_calib   = EXCLUDED.geo_calib,
      updated_at  = now()
  `, [
    item.id, item.documentId, item.projectId ?? null, item.page,
    item.type, item.label ?? null, item.quantity ?? null, item.unit ?? null,
    item.rate ?? null, item.csiCode ?? null, item.division ?? null,
    JSON.stringify(item.points ?? []),
    geomJson,
    item.pxPerFoot ?? null,
    item.geoCalib ? JSON.stringify(item.geoCalib) : null,
    JSON.stringify(item.meta ?? {}),
  ]);
}

// After geo calibration: apply the affine transform fwd matrix to convert
// geom_local (plan pixels) → geom_sp (State Plane 2276) → geom_wgs84 (4326).
// fwdMatrix: [[a,b,tx],[c,d,ty]]  — plan-px → State Plane TX feet
export async function applyCalibToGeometry(documentId, fwdMatrix) {
  const [[a, b, tx], [c, d, ty]] = fwdMatrix;
  return query(`
    UPDATE takeoff_items SET
      geom_sp = ST_SetSRID(
        ST_Affine(ST_Force2D(geom_local), $1,$2,0, $3,$4,0, 0,0,1, $5,$6,0),
        2276
      ),
      geom_wgs84 = ST_Transform(
        ST_SetSRID(
          ST_Affine(ST_Force2D(geom_local), $1,$2,0, $3,$4,0, 0,0,1, $5,$6,0),
          2276
        ),
        4326
      ),
      updated_at = now()
    WHERE document_id = $7
      AND geom_local IS NOT NULL
  `, [a, b, c, d, tx, ty, documentId]);
}

export async function itemsNearPoint(documentId, lng, lat, feet = 5) {
  const { rows } = await query(
    'SELECT * FROM items_within_ft($1,$2,$3,$4)',
    [documentId, lng, lat, feet]
  );
  return rows;
}

export async function itemsInBbox(documentId, minLng, minLat, maxLng, maxLat) {
  const { rows } = await query(`
    SELECT * FROM takeoff_items
    WHERE document_id = $1
      AND geom_wgs84 IS NOT NULL
      AND geom_wgs84 && ST_MakeEnvelope($2,$3,$4,$5,4326)
  `, [documentId, minLng, minLat, maxLng, maxLat]);
  return rows;
}

// ── Schedule Tasks ─────────────────────────────────────────────────────────

export async function upsertScheduleTask(task) {
  return query(`
    INSERT INTO schedule_tasks
      (id, project_id, name, duration, deps, status,
       es, ef, ls, lf, total_float, free_float, critical,
       start_date, end_date, ls_date, lf_date, meta)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
    ON CONFLICT (id) DO UPDATE SET
      name        = EXCLUDED.name,
      duration    = EXCLUDED.duration,
      deps        = EXCLUDED.deps,
      status      = EXCLUDED.status,
      es          = EXCLUDED.es,
      ef          = EXCLUDED.ef,
      ls          = EXCLUDED.ls,
      lf          = EXCLUDED.lf,
      total_float = EXCLUDED.total_float,
      free_float  = EXCLUDED.free_float,
      critical    = EXCLUDED.critical,
      start_date  = EXCLUDED.start_date,
      end_date    = EXCLUDED.end_date,
      ls_date     = EXCLUDED.ls_date,
      lf_date     = EXCLUDED.lf_date,
      updated_at  = now()
  `, [
    task.id, task.projectId, task.name, task.duration ?? 1,
    task.deps ?? [], task.status ?? 'pending',
    task.ES ?? null, task.EF ?? null, task.LS ?? null, task.LF ?? null,
    task.totalFloat ?? null, task.freeFloat ?? null, task.critical ?? false,
    task.startDate ?? null, task.endDate ?? null,
    task.lsDate ?? null, task.lfDate ?? null,
    JSON.stringify(task.meta ?? {}),
  ]);
}

export async function getProjectTasks(projectId) {
  const { rows } = await query(
    'SELECT * FROM schedule_tasks WHERE project_id=$1 ORDER BY es NULLS LAST, created_at',
    [projectId]
  );
  return rows;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function pointsToGeoJSON(type, points) {
  if (!points || !points.length) {
    return JSON.stringify({ type: 'GeometryCollection', geometries: [] });
  }
  if (type === 'count') {
    return JSON.stringify({
      type: 'MultiPoint',
      coordinates: points.map(p => [p.x, p.y]),
    });
  }
  if (type === 'length') {
    return JSON.stringify({
      type: 'LineString',
      coordinates: points.map(p => [p.x, p.y]),
    });
  }
  // area, perim, volume → closed polygon ring
  const coords = points.map(p => [p.x, p.y]);
  const [fx, fy] = coords[0];
  const [lx, ly] = coords[coords.length - 1];
  if (fx !== lx || fy !== ly) coords.push(coords[0]);
  return JSON.stringify({ type: 'Polygon', coordinates: [coords] });
}
