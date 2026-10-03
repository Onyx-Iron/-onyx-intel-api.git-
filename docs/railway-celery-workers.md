# Railway Celery / Redis Worker Pool

## Why
Vercel/Next.js stays the UI. Railway owns dedicated CPU/RAM for multi-hundred-MB
CAD/PDF extracts and large cut/fill grids — without serverless timeouts.

## Topology

```
[ Upload DWG / PDF ] ──► FastAPI (web) ──► Redis Queue ──► Celery worker (×N cores)
                                                          ├── ProcessPool PDF pages (spawn)
                                                          ├── ProcessPool DXF entities (spawn)
                                                          ├── ezdxf + Shapely/GEOS areas
                                                          └── NumPy vectorized cut/fill
```

## CPU acceleration (python-engine)

| Layer | Mechanism |
|-------|-----------|
| Multi-page PDF | `ProcessPoolExecutor` (`spawn`) in `services.parallel_pdf` — page chunks across cores; set `PDF_EXTRACT_WORKERS` |
| Large DXF modelspace | `ProcessPoolExecutor` (`spawn`) in `services.parallel_dxf` — entity index chunks; set `DXF_EXTRACT_WORKERS` |
| Cross-job queue | Celery + Redis (unchanged) |
| Polygon / trench buffers | Shapely 2 → GEOS C (`services.geos_geometry`) |
| Cut/fill grids | NumPy corner-slice mean + masked sums (`services.terrain_numpy`) |

## Railway setup

1. In the existing takeoff project, **Add Redis** (Railway plugin). Copy `REDIS_URL`.
2. Keep the existing **web** service start command:
   `uvicorn takeoff_api:app --host 0.0.0.0 --port $PORT --workers 2`
3. **New service** from the same repo, name it `worker`, start command:
   ```
   celery -A celery_app.celery worker --loglevel=INFO --concurrency=${CELERY_CONCURRENCY:-4} -Q onyx.compute
   ```
4. Set on **both** web and worker:
   - `REDIS_URL` (or `CELERY_BROKER_URL` + `CELERY_RESULT_BACKEND`)
   - existing `API_SECRET`, `ALLOWED_ORIGINS`, etc.
5. Optional: `CELERY_CONCURRENCY=4`, `ASYNC_EXTRACT_MAX_BYTES=524288000`

## API

| Endpoint | Role |
|----------|------|
| `POST /api/takeoff/extract` | Sync (unchanged) |
| `POST /api/takeoff/extract-async` | Multipart file **or** `?source_url=` → `{ job_id }` |
| `POST /api/earthwork/cutfill-async` | `{ existing, proposed }` grids → `{ job_id }` |
| `GET /api/jobs/{job_id}` | Poll status / result |
| `GET /api/health` | Includes `celery.redis` probe |

## Local

```bash
docker compose -f docker-compose.workers.yml up
# or eager mode for unit tests:
CELERY_TASK_ALWAYS_EAGER=1 pytest test_celery_workers.py -q
```
