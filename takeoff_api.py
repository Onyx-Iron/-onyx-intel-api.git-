"""
Onyx Intel — CSI Takeoff Stream API
NDJSON streaming server for the OnyxIntel portal.

Local:      uvicorn takeoff_api:app --host 0.0.0.0 --port 5050 --reload
Production: Railway reads Procfile → uvicorn takeoff_api:app --host 0.0.0.0 --port $PORT

Environment variables:
  ALLOWED_ORIGINS   Comma-separated list of allowed CORS origins
                    e.g. "https://app.onyx-iron.com,http://localhost:3000"
  API_SECRET        Shared secret checked on every request via X-Onyx-Secret header
                    Set this in Railway + Vercel env vars to prevent unauthorized access
"""

from __future__ import annotations

import logging
import os
import tempfile
from pathlib import Path
from typing import AsyncGenerator

from fastapi import FastAPI, HTTPException, Query, UploadFile, File, Header, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
import uvicorn

from takeoff_parser import CSITakeoffStreamProcessor

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)

# ── Configuration ──────────────────────────────────────────────────────────────

_raw_origins = os.getenv("ALLOWED_ORIGINS", "https://app.onyx-iron.com,http://localhost:3000")
ALLOWED_ORIGINS: list[str] = [o.strip() for o in _raw_origins.split(",") if o.strip()]

API_SECRET: str | None = os.getenv("API_SECRET")

# ── App ────────────────────────────────────────────────────────────────────────

app = FastAPI(
    title="Onyx Intel Takeoff Stream",
    description="NDJSON streaming endpoint for CSI MasterFormat takeoff sheets",
    version="2.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
    expose_headers=["X-Onyx-Tenant", "X-Onyx-Project"],
)


# ── Auth dependency ────────────────────────────────────────────────────────────

def verify_secret(x_onyx_secret: str | None = Header(default=None)) -> None:
    """Reject requests missing the shared API secret when one is configured."""
    if API_SECRET and x_onyx_secret != API_SECRET:
        raise HTTPException(status_code=401, detail="Invalid or missing X-Onyx-Secret header")


# ── Stream helpers ─────────────────────────────────────────────────────────────

def _stream_file(
    file_path: str,
    chunk_size: int,
    tenant_id: str | None,
    project_id: str | None,
) -> AsyncGenerator[bytes, None]:
    """
    Wrap CSITakeoffStreamProcessor, injecting tenant_id and project_id into
    every CHUNK_PROCESSED event so the portal can write rows to Supabase
    with correct tenant isolation on the client side.
    """
    import json

    processor = CSITakeoffStreamProcessor(file_path=file_path, chunk_size=chunk_size)

    async def _inject() -> AsyncGenerator[bytes, None]:
        async for raw_frame in processor.parse_and_stream_sheet():
            if tenant_id or project_id:
                try:
                    payload = json.loads(raw_frame.decode("utf-8").strip())
                    if tenant_id:
                        payload["tenant_id"] = tenant_id
                    if project_id:
                        payload["project_id"] = project_id
                    raw_frame = (json.dumps(payload, default=str) + "\n").encode("utf-8")
                except Exception:
                    pass  # emit original frame if JSON manipulation fails
            yield raw_frame

    return _inject()


# ── Endpoints ──────────────────────────────────────────────────────────────────

@app.post(
    "/api/stream/upload",
    summary="Upload a takeoff JSON file and stream validated rows as NDJSON",
    dependencies=[Depends(verify_secret)],
)
async def upload_and_stream(
    file: UploadFile = File(..., description="JSON takeoff file"),
    chunk_size: int = Query(default=15, ge=1, le=500),
    x_onyx_tenant: str | None = Header(default=None),
    x_onyx_project: str | None = Header(default=None),
) -> StreamingResponse:
    """
    Accepts a multipart/form-data upload from the portal, writes to a temp file,
    validates through DeterministicOnyxParser, and streams NDJSON events back.

    Headers consumed:
      X-Onyx-Tenant   tenant_id (UUID) — injected into every outbound event
      X-Onyx-Project  project_id (UUID) — injected into every outbound event
      X-Onyx-Secret   shared API secret
    """
    if not file.filename or not file.filename.lower().endswith(".json"):
        raise HTTPException(status_code=400, detail="Only .json files are accepted")

    content = await file.read()
    if len(content) == 0:
        raise HTTPException(status_code=400, detail="Uploaded file is empty")
    if len(content) > 50 * 1024 * 1024:  # 50 MB hard limit
        raise HTTPException(status_code=413, detail="File exceeds 50 MB limit")

    tmp = tempfile.NamedTemporaryFile(suffix=".json", delete=False)
    try:
        tmp.write(content)
        tmp.flush()
        tmp_path = tmp.name
    finally:
        tmp.close()

    logger.info(
        "[upload] file=%s size=%d tenant=%s project=%s",
        file.filename, len(content), x_onyx_tenant, x_onyx_project,
    )

    async def _stream_and_cleanup() -> AsyncGenerator[bytes, None]:
        try:
            async for frame in _stream_file(tmp_path, chunk_size, x_onyx_tenant, x_onyx_project):
                yield frame
        finally:
            Path(tmp_path).unlink(missing_ok=True)

    return StreamingResponse(
        _stream_and_cleanup(),
        media_type="application/x-ndjson",
        headers={
            "X-Accel-Buffering": "no",
            "Cache-Control": "no-cache, no-store",
        },
    )


@app.get(
    "/api/stream/takeoff/{file_path:path}",
    summary="Stream a server-side takeoff JSON file as NDJSON (local use only)",
    dependencies=[Depends(verify_secret)],
)
async def stream_server_file(
    file_path: str,
    chunk_size: int = Query(default=15, ge=1, le=500),
    x_onyx_tenant: str | None = Header(default=None),
    x_onyx_project: str | None = Header(default=None),
) -> StreamingResponse:
    """Stream a takeoff file that already exists on the server's filesystem."""
    target = Path(file_path)
    if not target.exists() or not target.is_file():
        raise HTTPException(status_code=404, detail=f"File not found: {file_path}")
    if target.suffix.lower() != ".json":
        raise HTTPException(status_code=400, detail="Only .json files are supported")

    return StreamingResponse(
        _stream_file(str(target.resolve()), chunk_size, x_onyx_tenant, x_onyx_project),
        media_type="application/x-ndjson",
        headers={
            "X-Accel-Buffering": "no",
            "Cache-Control": "no-cache, no-store",
        },
    )


@app.get("/api/health")
async def health() -> dict:
    return {
        "status": "ok",
        "service": "onyx-intel-takeoff-stream",
        "version": "2.0.0",
        "origins": ALLOWED_ORIGINS,
        "auth": "enabled" if API_SECRET else "disabled",
    }


# ── Entry point ────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    uvicorn.run(
        "takeoff_api:app",
        host="0.0.0.0",
        port=int(os.getenv("PORT", "5050")),
        reload=True,
        log_level="info",
    )
