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
    version="2.1.0",
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


@app.post(
    "/api/parse/document",
    summary="Parse a document file and return extracted text, metadata, and page count",
    dependencies=[Depends(verify_secret)],
)
async def parse_document(
    file: UploadFile = File(...),
    x_onyx_tenant: str | None = Header(default=None),
    x_onyx_project: str | None = Header(default=None),
    document_id: str | None = Query(default=None),
) -> dict:
    """
    Accepts PDF, TIFF, JPEG, PNG files. Extracts text and metadata.
    Returns JSON with: page_count, text_preview (first 2000 chars), metadata, file_type.

    For PDFs: uses pdfplumber to extract text page by page.
    For images (TIFF, JPEG, PNG): returns metadata only (dimensions, mode, format).
    For other files (.dwg, .dxf, .xlsx): returns file metadata only.
    """
    import json as _json

    filename = file.filename or "unknown"
    ext = Path(filename).suffix.lower()
    content = await file.read()

    if len(content) == 0:
        raise HTTPException(status_code=400, detail="Uploaded file is empty")
    if len(content) > 100 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="File exceeds 100 MB limit")

    result: dict = {
        "file_name": filename,
        "file_type": ext.lstrip("."),
        "size_bytes": len(content),
        "tenant_id": x_onyx_tenant,
        "project_id": x_onyx_project,
        "document_id": document_id,
        "page_count": None,
        "text_preview": None,
        "metadata": {},
        "status": "parsed",
    }

    tmp = tempfile.NamedTemporaryFile(suffix=ext, delete=False)
    try:
        tmp.write(content)
        tmp.flush()
        tmp_path = tmp.name
    finally:
        tmp.close()

    try:
        if ext == ".pdf":
            import pdfplumber
            with pdfplumber.open(tmp_path) as pdf:
                result["page_count"] = len(pdf.pages)
                texts = []
                for page in pdf.pages[:10]:  # preview first 10 pages
                    t = page.extract_text()
                    if t:
                        texts.append(t)
                full_text = "\n\n".join(texts)
                result["text_preview"] = full_text[:3000] if full_text else None
                result["metadata"] = {
                    "pdf_info": {k: str(v) for k, v in (pdf.metadata or {}).items()},
                }

        elif ext in (".tiff", ".tif", ".jpg", ".jpeg", ".png"):
            from PIL import Image as PILImage
            with PILImage.open(tmp_path) as img:
                result["page_count"] = getattr(img, "n_frames", 1)
                result["metadata"] = {
                    "width": img.width,
                    "height": img.height,
                    "mode": img.mode,
                    "format": img.format,
                }

        elif ext in (".dwg", ".dxf"):
            result["status"] = "pending_specialized"
            result["metadata"] = {"note": "CAD parsing requires specialized processing"}

        elif ext in (".xlsx", ".xls"):
            result["status"] = "pending_specialized"
            result["metadata"] = {"note": "Spreadsheet parsing queued"}

        else:
            result["status"] = "unsupported"

    except Exception as e:
        logger.warning("[parse_document] error parsing %s: %s", filename, e)
        result["status"] = "parse_error"
        result["metadata"] = {"error": str(e)}

    finally:
        Path(tmp_path).unlink(missing_ok=True)

    logger.info(
        "[parse_document] file=%s type=%s pages=%s status=%s",
        filename, ext, result["page_count"], result["status"],
    )
    return result


@app.post(
    "/api/takeoff/extract",
    summary="Deterministically extract CSI-coded takeoff rows from PDF/DXF/DWG/IFC/XLSX (no AI)",
    dependencies=[Depends(verify_secret)],
)
async def extract_takeoff(
    file: UploadFile = File(...),
    x_onyx_tenant: str | None = Header(default=None),
    x_onyx_project: str | None = Header(default=None),
) -> dict:
    """
    Build-once, run-free extraction. Routes by extension:
      .pdf            schedule/spec tables  (pdfplumber)
      .dxf / .dwg     real geometry         (ezdxf — exact lengths/areas/counts)
      .ifc            BIM base quantities   (ifcopenshell)
      .xlsx / .xls    tabular estimate/BOM  (openpyxl)

    Returns: { source_type, rows[], coverage{}, ai_candidate_pages[] }.
    For PDFs, ai_candidate_pages lists drawing pages with no machine-readable
    table — the portal may optionally run the AI vision path on just those.
    """
    from takeoff_extract import extract as _extract

    filename = file.filename or "unknown"
    ext = Path(filename).suffix.lower()
    allowed = {".pdf", ".dxf", ".dwg", ".ifc", ".xlsx", ".xls"}
    if ext not in allowed:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported type '{ext}'. Accepts: {', '.join(sorted(allowed))}",
        )

    content = await file.read()
    if len(content) == 0:
        raise HTTPException(status_code=400, detail="Uploaded file is empty")
    if len(content) > 100 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="File exceeds 100 MB limit")

    tmp = tempfile.NamedTemporaryFile(suffix=ext, delete=False)
    try:
        tmp.write(content)
        tmp.flush()
        tmp_path = tmp.name
    finally:
        tmp.close()

    try:
        result = _extract(tmp_path)
    except ValueError as e:
        # Expected, user-actionable errors (e.g. binary DWG, missing IFC lib).
        raise HTTPException(status_code=422, detail=str(e))
    except Exception as e:
        logger.exception("[extract_takeoff] failed for %s", filename)
        raise HTTPException(status_code=500, detail=f"Extraction failed: {e}")
    finally:
        Path(tmp_path).unlink(missing_ok=True)

    result["file_name"] = filename
    result["tenant_id"] = x_onyx_tenant
    result["project_id"] = x_onyx_project
    logger.info(
        "[extract_takeoff] file=%s type=%s rows=%d",
        filename, result.get("source_type"), len(result.get("rows", [])),
    )
    return result


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
        "version": "2.1.0",
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
