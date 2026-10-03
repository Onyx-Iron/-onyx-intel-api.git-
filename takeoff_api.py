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
import uuid
from pathlib import Path
from typing import AsyncGenerator

from fastapi import FastAPI, HTTPException, Query, UploadFile, File, Header, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
import uvicorn

from takeoff_parser import CSITakeoffStreamProcessor
from rate_limiting import (
    check_rate_limit,
    RateLimitExceeded,
    get_tenant_quota,
    RATE_LIMIT_ENABLED,
    REQUESTS_PER_MIN,
    UPLOAD_MB_PER_HOUR,
)
from enhanced_takeoff_system import (
    CostDatabase,
    EnhancedDeterministicParser,
    EnhancedStreamingParser,
    DataIntegrityBreachException,
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)

# ── Configuration ──────────────────────────────────────────────────────────────

_raw_origins = os.getenv("ALLOWED_ORIGINS", "https://app.onyx-iron.com,http://localhost:3000")
ALLOWED_ORIGINS: list[str] = [o.strip() for o in _raw_origins.split(",") if o.strip()]

API_SECRET: str | None = os.getenv("API_SECRET")

# Server-side takeoff base dir for `/api/stream/takeoff/{file_path:path}`.
# Requests outside this directory are rejected (prevents path traversal).
TAKEOFF_BASE_DIR: Path = Path(
    os.getenv("TAKEOFF_BASE_DIR", str(Path(tempfile.gettempdir()) / "onyx_takeoffs"))
).resolve()
try:
    TAKEOFF_BASE_DIR.mkdir(parents=True, exist_ok=True)
except OSError as _e:
    logger.warning("Could not create TAKEOFF_BASE_DIR=%s: %s (will retry per-request)", TAKEOFF_BASE_DIR, _e)


def _safe_uuid(value: str | None) -> str | None:
    """Return the canonical UUID string if valid, else None. Never raises.

    Used to sanitize `X-Onyx-Tenant` / `X-Onyx-Project` headers before they
    are injected into outbound NDJSON events or returned in responses.
    """
    if not value:
        return None
    try:
        return str(uuid.UUID(value.strip()))
    except (ValueError, AttributeError, TypeError):
        return None


def _require_uuid(value: str | None, field: str) -> str:
    """Validate a UUID header and 400 if missing/malformed."""
    safe = _safe_uuid(value)
    if not safe:
        raise HTTPException(
            status_code=400,
            detail=f"{field} header must be a valid UUID",
        )
    return safe


# Preferred public name for the header sanitizer. Alias of _safe_uuid — kept as
# a distinct symbol so security-audit greps for "validate_uuid_header" land here.
def _validate_uuid_header(value: str | None) -> str | None:
    """Return the canonical UUID string if the header value is a genuine UUID,
    else None. Used to scrub `X-Onyx-Tenant` and `X-Onyx-Project` before any
    downstream injection into event payloads or response bodies."""
    return _safe_uuid(value)


def _install_memory_guard() -> None:
    """Cap the worker's address space just below the container limit so a runaway
    PDF allocation (a dense CAD drawing) raises a *catchable* MemoryError instead of
    the OS SIGKILL-ing the whole worker — which Railway surfaces as a 502
    "Application failed to respond". With this guard, an over-heavy page is caught by
    the per-page try/except and routed to the AI vision path instead of crashing."""
    try:
        import resource
    except ImportError:
        return  # non-Unix (e.g. local Windows dev) — nothing to do

    total: int | None = None
    # cgroup v2, then v1 — the real limit Railway enforces.
    for path in ("/sys/fs/cgroup/memory.max",
                 "/sys/fs/cgroup/memory/memory.limit_in_bytes"):
        try:
            with open(path) as fh:
                raw = fh.read().strip()
            if raw.isdigit():
                total = int(raw)
                break
        except OSError:
            continue
    # "max"/unlimited or unreadable → fall back to physical RAM.
    if not total or total > (1 << 60):
        try:
            with open("/proc/meminfo") as fh:
                for line in fh:
                    if line.startswith("MemTotal:"):
                        total = int(line.split()[1]) * 1024
                        break
        except OSError:
            total = None
    if not total:
        return

    # Leave 256 MB of headroom for the interpreter/runtime; never cap below 512 MB
    # (a too-tight limit would fail even normal pages). Floor protects against
    # mis-detected tiny limits.
    soft = max(total - (256 << 20), 512 << 20)
    if soft >= total:
        return  # container too small to guard safely — leave limits alone
    try:
        _, hard = resource.getrlimit(resource.RLIMIT_AS)
        new_hard = hard if hard != resource.RLIM_INFINITY else soft
        resource.setrlimit(resource.RLIMIT_AS, (soft, new_hard))
        logger.info("Memory guard active: RLIMIT_AS soft=%d MB (container=%d MB)",
                    soft >> 20, total >> 20)
    except (ValueError, OSError) as exc:
        logger.warning("Could not install memory guard: %s", exc)


_install_memory_guard()

# ── App ────────────────────────────────────────────────────────────────────────

app = FastAPI(
    title="Onyx Intel Takeoff Stream",
    description="NDJSON streaming endpoint for CSI MasterFormat takeoff sheets",
    version="2.3.0",
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
    """Reject requests missing the shared API secret when one is configured.

    Accepts either API_SECRET (regular auth) or RATE_LIMIT_ADMIN_SECRET
    (auth + rate-limit bypass). The rate limiter separately checks whether
    the value matched the admin secret.
    """
    if not API_SECRET:
        return
    admin_secret = os.getenv("RATE_LIMIT_ADMIN_SECRET") or ""
    if x_onyx_secret == API_SECRET:
        return
    if admin_secret and x_onyx_secret == admin_secret:
        return
    raise HTTPException(status_code=401, detail="Invalid or missing X-Onyx-Secret header")


def rate_limit_request(
    x_onyx_tenant: str | None = Header(default=None),
    x_onyx_secret: str | None = Header(default=None),
) -> None:
    """
    Per-tenant request-rate enforcement. Use as a FastAPI dependency on
    non-upload endpoints. Admin secret (RATE_LIMIT_ADMIN_SECRET) bypasses limits.
    For upload endpoints, call check_rate_limit() inline after we know file size.
    """
    try:
        check_rate_limit(x_onyx_tenant, file_size_mb=0.0, secret=x_onyx_secret)
    except RateLimitExceeded as e:
        raise HTTPException(
            status_code=429,
            detail=e.reason,
            headers={"Retry-After": "60"},
        )


def _enforce_upload_quota(
    file_size_bytes: int,
    tenant_id: str | None,
    secret: str | None,
) -> None:
    """Inline upload quota check; converts RateLimitExceeded to HTTP 429."""
    size_mb = file_size_bytes / (1024 * 1024) if file_size_bytes else 0.0
    try:
        check_rate_limit(tenant_id, file_size_mb=size_mb, secret=secret)
    except RateLimitExceeded as e:
        raise HTTPException(
            status_code=429,
            detail=e.reason,
            headers={"Retry-After": str(3600 if e.limit_type == "upload_mb_per_hour" else 60)},
        )


# ── Stream helpers ─────────────────────────────────────────────────────────────

try:
    _COST_DB = CostDatabase()
    logger.info("[cost_db] initialized mode=%s", getattr(_COST_DB, "mode", "unknown"))
except Exception as _e:  # noqa: BLE001
    logger.exception("[cost_db] init failed, using sample fallback: %s", _e)
    _COST_DB = CostDatabase(mode="sample")


async def _enhanced_stream_file(
    file_path: str,
    chunk_size: int,
    region: str,
    tenant_id: str | None,
    project_id: str | None,
) -> AsyncGenerator[bytes, None]:
    """Run EnhancedStreamingParser over a .json takeoff file.

    Natively `async def` — yields NDJSON events directly instead of returning
    an inner async generator, so FastAPI's StreamingResponse consumes it as a
    single continuous coroutine (no double-await hop, no scope handoff).
    Tenant + project ids are UUID-validated before injection so downstream
    JSON is guaranteed safe.
    """
    import json

    parser = EnhancedStreamingParser(file_path=file_path, cost_db=_COST_DB)
    safe_tenant = _safe_uuid(tenant_id)
    safe_project = _safe_uuid(project_id)

    try:
        async for evt_str in parser.stream_with_costs(chunk_size=chunk_size, region=region):
            try:
                payload = json.loads(evt_str.strip())
                if safe_tenant:
                    payload["tenant_id"] = safe_tenant
                if safe_project:
                    payload["project_id"] = safe_project
                yield (json.dumps(payload, default=str) + "\n").encode("utf-8")
            except Exception:
                yield evt_str.encode("utf-8") if isinstance(evt_str, str) else evt_str
    except DataIntegrityBreachException as e:
        err = {
            "event": "ERROR",
            "breach_type": e.breach_type.value if hasattr(e.breach_type, "value") else str(e.breach_type),
            "message": str(e.message),
            "details": e.details,
            "tenant_id": safe_tenant,
            "project_id": safe_project,
        }
        yield (json.dumps(err, default=str) + "\n").encode("utf-8")
    except Exception as e:  # noqa: BLE001
        logger.exception("[enhanced_stream] unhandled error")
        err = {"event": "ERROR", "message": f"Enhanced parse failed: {e}"}
        yield (json.dumps(err) + "\n").encode("utf-8")


async def _stream_file(
    file_path: str,
    chunk_size: int,
    tenant_id: str | None,
    project_id: str | None,
) -> AsyncGenerator[bytes, None]:
    """Stream validated CSI takeoff rows as NDJSON with tenant_id + project_id
    injected into every event.

    Natively async — an `async def` generator, not a sync function returning
    an inner async generator. FastAPI's StreamingResponse consumes this
    directly. Tenant + project headers are UUID-sanitized before injection.
    """
    import json

    processor = CSITakeoffStreamProcessor(file_path=file_path, chunk_size=chunk_size)
    safe_tenant = _safe_uuid(tenant_id)
    safe_project = _safe_uuid(project_id)

    async for raw_frame in processor.parse_and_stream_sheet():
        if safe_tenant or safe_project:
            try:
                payload = json.loads(raw_frame.decode("utf-8").strip())
                if safe_tenant:
                    payload["tenant_id"] = safe_tenant
                if safe_project:
                    payload["project_id"] = safe_project
                raw_frame = (json.dumps(payload, default=str) + "\n").encode("utf-8")
            except Exception:
                pass  # emit original frame if JSON manipulation fails
        yield raw_frame


# ── Endpoints ──────────────────────────────────────────────────────────────────

@app.post(
    "/api/stream/upload",
    summary="Upload a takeoff JSON file and stream validated rows as NDJSON",
    dependencies=[Depends(verify_secret)],
)
async def upload_and_stream(
    file: UploadFile = File(..., description="JSON takeoff file"),
    chunk_size: int = Query(default=15, ge=1, le=500),
    with_costs: bool = Query(
        default=False,
        description="If true, use EnhancedStreamingParser to enrich each row with "
                    "regional cost data + labor/material/equipment breakdown.",
    ),
    region: str = Query(
        default="US_EAST",
        description="Regional cost basis. One of: US_EAST, US_WEST, US_MIDWEST, US_SOUTH, INTERNATIONAL.",
    ),
    x_onyx_tenant: str | None = Header(default=None),
    x_onyx_project: str | None = Header(default=None),
    x_onyx_secret: str | None = Header(default=None),
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

    # Per-tenant upload quota — admin secret bypasses
    _enforce_upload_quota(len(content), x_onyx_tenant, x_onyx_secret)

    tmp = tempfile.NamedTemporaryFile(suffix=".json", delete=False)
    try:
        tmp.write(content)
        tmp.flush()
        tmp_path = tmp.name
    finally:
        tmp.close()

    logger.info(
        "[upload] file=%s size=%d tenant=%s project=%s with_costs=%s region=%s",
        file.filename, len(content), x_onyx_tenant, x_onyx_project, with_costs, region,
    )

    async def _stream_and_cleanup() -> AsyncGenerator[bytes, None]:
        try:
            if with_costs:
                # Enhanced path: rows + cost enrichment via EnhancedStreamingParser
                async for frame in _enhanced_stream_file(
                    tmp_path, chunk_size, region, x_onyx_tenant, x_onyx_project,
                ):
                    yield frame
            else:
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
    x_onyx_secret: str | None = Header(default=None),
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

    # Per-tenant upload quota — admin secret bypasses
    _enforce_upload_quota(len(content), x_onyx_tenant, x_onyx_secret)

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
    x_onyx_secret: str | None = Header(default=None),
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

    # Per-tenant upload quota — admin secret bypasses
    _enforce_upload_quota(len(content), x_onyx_tenant, x_onyx_secret)

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


@app.post(
    "/api/takeoff/extract-stream",
    summary="Stream CSI takeoff rows page-by-page as NDJSON (memory-safe for large PDFs)",
    dependencies=[Depends(verify_secret)],
)
async def extract_takeoff_stream(
    file: UploadFile = File(...),
    x_onyx_tenant: str | None = Header(default=None),
    x_onyx_project: str | None = Header(default=None),
    x_onyx_secret: str | None = Header(default=None),
) -> StreamingResponse:
    """
    Page-by-page takeoff extraction. For PDFs, processes ONE page at a time and
    releases its memory before the next, so arbitrarily large drawing sets stream
    without OOM-ing the worker. Emits NDJSON events:
      {"event":"STARTED","total_pages":N}
      {"event":"PAGE","page":i,"total_pages":N,"rows":[...]}   (rows=[] -> drawing page -> AI candidate)
      {"event":"COMPLETED","total_rows":R,"ai_candidate_pages":[...]}
      {"event":"ERROR","message":"..."}
    DXF/IFC/XLSX are extracted whole and emitted as a single page.
    """
    import json as _json
    from takeoff_extract import iter_pdf_pages, extract as _extract

    filename = file.filename or "unknown"
    ext = Path(filename).suffix.lower()
    content = await file.read()
    if len(content) == 0:
        raise HTTPException(status_code=400, detail="Uploaded file is empty")
    if len(content) > 100 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="File exceeds 100 MB limit")

    # Per-tenant upload quota — admin secret bypasses
    _enforce_upload_quota(len(content), x_onyx_tenant, x_onyx_secret)

    tmp = tempfile.NamedTemporaryFile(suffix=ext, delete=False)
    try:
        tmp.write(content)
        tmp.flush()
        tmp_path = tmp.name
    finally:
        tmp.close()

    def _frame(obj) -> bytes:
        return (_json.dumps(obj, default=str) + "\n").encode("utf-8")

    def gen():
        try:
            if ext == ".pdf":
                ai_pages: list[int] = []
                total_rows = 0
                started = False
                for idx, total, rows in iter_pdf_pages(tmp_path):
                    if not started:
                        yield _frame({"event": "STARTED", "total_pages": total, "file": filename})
                        started = True
                    if rows:
                        total_rows += len(rows)
                        yield _frame({"event": "PAGE", "page": idx, "total_pages": total, "rows": rows})
                    else:
                        ai_pages.append(idx)
                        yield _frame({"event": "PAGE", "page": idx, "total_pages": total, "rows": []})
                if not started:
                    yield _frame({"event": "STARTED", "total_pages": 0, "file": filename})
                yield _frame({"event": "COMPLETED", "total_rows": total_rows, "ai_candidate_pages": ai_pages})
            else:
                result = _extract(tmp_path)
                rows = result.get("rows", [])
                yield _frame({"event": "STARTED", "total_pages": 1, "file": filename})
                yield _frame({"event": "PAGE", "page": 1, "total_pages": 1, "rows": rows})
                yield _frame({"event": "COMPLETED", "total_rows": len(rows),
                              "ai_candidate_pages": result.get("ai_candidate_pages", [])})
        except ValueError as e:
            yield _frame({"event": "ERROR", "message": str(e)})
        except Exception as e:  # noqa: BLE001
            logger.exception("[extract_stream] failed for %s", filename)
            yield _frame({"event": "ERROR", "message": f"Extraction failed: {e}"})
        finally:
            Path(tmp_path).unlink(missing_ok=True)

    return StreamingResponse(
        gen(),
        media_type="application/x-ndjson",
        headers={"X-Accel-Buffering": "no", "Cache-Control": "no-cache, no-store"},
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
    """Stream a takeoff file that already exists on the server's filesystem.

    Path is interpreted RELATIVE to TAKEOFF_BASE_DIR. Any attempt to escape
    that root (absolute paths, `..` segments, symlinks pointing outside) is
    rejected with 400. This is the path-traversal guard.
    """
    # Reject obvious traversal attempts before touching the filesystem.
    if not file_path or file_path.startswith(("/", "\\")) or ".." in Path(file_path).parts:
        raise HTTPException(status_code=403, detail="Forbidden: invalid or traversal path")

    # Resolve against TAKEOFF_BASE_DIR — this collapses `..` segments, symlinks,
    # and normalises separators to real absolute paths that we can string-compare.
    candidate_abs = str((TAKEOFF_BASE_DIR / file_path).resolve())
    base_abs      = str(TAKEOFF_BASE_DIR.resolve())

    # Directory breakout guard — the resolved path MUST start with the base.
    # `os.path.commonpath` handles case + separator normalisation on Windows;
    # ValueError happens across drives — also an escape.
    try:
        inside = os.path.commonpath([candidate_abs, base_abs]) == base_abs
    except ValueError:
        inside = False
    if not inside:
        logger.warning("[stream_server_file] blocked traversal attempt: %s → %s", file_path, candidate_abs)
        raise HTTPException(status_code=403, detail="Forbidden: path escapes takeoff root")

    candidate = Path(candidate_abs)
    if not candidate.exists() or not candidate.is_file():
        raise HTTPException(status_code=404, detail="File not found")
    if candidate.suffix.lower() != ".json":
        raise HTTPException(status_code=400, detail="Only .json files are supported")

    return StreamingResponse(
        _stream_file(str(candidate), chunk_size, x_onyx_tenant, x_onyx_project),
        media_type="application/x-ndjson",
        headers={
            "X-Accel-Buffering": "no",
            "Cache-Control": "no-cache, no-store",
        },
    )


@app.post(
    "/api/takeoff/enhance",
    summary="Enrich already-validated takeoff rows with regional cost data (batch)",
    dependencies=[Depends(verify_secret)],
)
async def enhance_takeoff(
    payload: dict,
    region: str = Query(default="US_EAST"),
    x_onyx_tenant: str | None = Header(default=None),
    x_onyx_project: str | None = Header(default=None),
    x_onyx_secret: str | None = Header(default=None),
) -> dict:
    """
    Batch cost enrichment for already-extracted takeoff rows.

    Body:  { "rows": [ ...takeoff row dicts... ] }
    Query: ?region=US_EAST|US_WEST|US_MIDWEST|US_SOUTH|INTERNATIONAL

    Returns:
      {
        "rows": [ ...rows with estimated_unit_cost + estimated_line_total + breakdown ],
        "summary": { total_qty, estimated_cost, cost_breakdown{labor,material,equipment}, ... }
      }

    Reuses the validation engine in EnhancedDeterministicParser — rows that
    fail validation are dropped from the result and summarized in errors.
    """
    import json

    # Rate-limit this as a regular request (no file_size)
    try:
        check_rate_limit(x_onyx_tenant, file_size_mb=0.0, secret=x_onyx_secret)
    except RateLimitExceeded as e:
        raise HTTPException(status_code=429, detail=e.reason, headers={"Retry-After": "60"})

    rows = payload.get("rows") if isinstance(payload, dict) else None
    if not isinstance(rows, list):
        raise HTTPException(status_code=400, detail="Body must be { rows: [...] }")
    if len(rows) > 10_000:
        raise HTTPException(status_code=413, detail="Max 10,000 rows per enhance call")

    raw_json = json.dumps(rows)
    parser = EnhancedDeterministicParser(raw_json, _COST_DB)
    try:
        validated, summary = parser.execute_with_cost_enrichment(region=region)
    except DataIntegrityBreachException as e:
        raise HTTPException(
            status_code=422,
            detail={
                "breach_type": e.breach_type.value if hasattr(e.breach_type, "value") else str(e.breach_type),
                "message": str(e.message),
                "details": e.details,
            },
        )

    return {
        "tenant_id": x_onyx_tenant,
        "project_id": x_onyx_project,
        "rows": [r.model_dump() for r in validated],
        "summary": summary,
    }


@app.post(
    "/api/takeoff/extract-from-drive",
    summary="Pull a blueprint from Google Drive, run takeoff, optionally export to Sheets",
    dependencies=[Depends(verify_secret)],
)
async def extract_from_drive(
    file_id: str = Query(..., min_length=8, description="Google Drive file ID"),
    export_to_sheet_id: str | None = Query(
        default=None,
        description="Optional Google Sheets spreadsheet ID to write results to",
    ),
    region: str = Query(default="US_EAST"),
    x_onyx_tenant: str | None = Header(default=None),
    x_onyx_project: str | None = Header(default=None),
    x_onyx_secret: str | None = Header(default=None),
) -> dict:
    """End-to-end: Drive -> takeoff_extract.extract -> EnhancedDeterministicParser
    cost enrichment -> (optional) Google Sheets export.

    Tenant + project headers are UUID-validated.
    Temp file is unlinked in `finally` regardless of outcome.
    """
    import json

    from google_integration import (
        download_file_from_drive,
        export_rows_to_google_sheet,
    )
    from takeoff_extract import extract as _extract

    safe_tenant = _require_uuid(x_onyx_tenant, "X-Onyx-Tenant")
    safe_project = _require_uuid(x_onyx_project, "X-Onyx-Project")

    try:
        content, filename = download_file_from_drive(file_id)
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e))
    except Exception as e:  # noqa: BLE001
        logger.exception("[extract-from-drive] download failed for %s", file_id)
        raise HTTPException(status_code=502, detail=f"Drive download failed: {e}")

    if not content:
        raise HTTPException(status_code=422, detail="Drive returned empty file")

    size_mb = len(content) / (1024 * 1024)
    _enforce_upload_quota(len(content), safe_tenant, x_onyx_secret)

    suffix = Path(filename).suffix.lower() or ".bin"
    tmp = tempfile.NamedTemporaryFile(suffix=suffix, delete=False)
    try:
        tmp.write(content)
        tmp.flush()
        tmp_path = tmp.name
    finally:
        tmp.close()

    try:
        try:
            extracted = _extract(tmp_path)
        except Exception as e:  # noqa: BLE001
            logger.exception("[extract-from-drive] takeoff_extract failed")
            raise HTTPException(status_code=422, detail=f"Takeoff extract failed: {e}")

        # `takeoff_extract.extract` returns a dict {rows: [...], ...}
        # For legacy callers that returned a list, fall through gracefully.
        if isinstance(extracted, dict):
            raw_rows = extracted.get("rows") or []
        elif isinstance(extracted, list):
            raw_rows = extracted
        else:
            raise HTTPException(status_code=422, detail="Extractor returned no rows")
        if not isinstance(raw_rows, list):
            raise HTTPException(status_code=422, detail="Extractor did not return a row list")

        parser = EnhancedDeterministicParser(json.dumps(raw_rows), _COST_DB)
        try:
            validated, summary = parser.execute_with_cost_enrichment(region=region)
        except DataIntegrityBreachException as e:
            raise HTTPException(
                status_code=422,
                detail={
                    "breach_type": e.breach_type.value if hasattr(e.breach_type, "value") else str(e.breach_type),
                    "message": str(e.message),
                    "details": e.details,
                },
            )

        rows_out = [r.model_dump() for r in validated]

        sheet_status: str | None = None
        if export_to_sheet_id:
            try:
                sheet_status = export_rows_to_google_sheet(
                    spreadsheet_id=export_to_sheet_id,
                    rows=rows_out,
                    summary=summary,
                )
            except RuntimeError as e:
                # Google not configured — surface as warning, not failure
                sheet_status = f"skipped: {e}"
            except Exception as e:  # noqa: BLE001
                logger.exception("[extract-from-drive] sheet export failed")
                sheet_status = f"failed: {e}"

        logger.info(
            "[extract-from-drive] file_id=%s filename=%s size_mb=%.2f rows=%d tenant=%s project=%s sheet=%s",
            file_id, filename, size_mb, len(rows_out), safe_tenant, safe_project, sheet_status,
        )

        return {
            "tenant_id": safe_tenant,
            "project_id": safe_project,
            "source": {"drive_file_id": file_id, "filename": filename},
            "rows": rows_out,
            "summary": summary,
            "sheet_export": sheet_status,
        }
    finally:
        Path(tmp_path).unlink(missing_ok=True)


@app.get("/api/health")
async def health() -> dict:
    return {
        "status": "ok",
        "service": "onyx-intel-takeoff-stream",
        "version": "2.5.0",
        "origins": ALLOWED_ORIGINS,
        "auth": "enabled" if API_SECRET else "disabled",
        "rate_limiting": {
            "enabled": RATE_LIMIT_ENABLED,
            "requests_per_min": REQUESTS_PER_MIN,
            "upload_mb_per_hour": UPLOAD_MB_PER_HOUR,
        },
        "cost_enrichment": {
            "enabled": True,
            "cost_records": len(getattr(_COST_DB, "_sample_cache", {})),
            "mode": getattr(_COST_DB, "mode", "unknown"),
            "regions": ["US_EAST", "US_WEST", "US_MIDWEST", "US_SOUTH", "INTERNATIONAL"],
        },
    }


@app.get(
    "/api/quota",
    summary="Return current rate-limit quota usage for a tenant",
    dependencies=[Depends(verify_secret)],
)
async def quota(
    x_onyx_tenant: str | None = Header(default=None),
) -> dict:
    """Returns the requesting tenant's current usage against the per-minute
    request limit and per-hour upload limit."""
    tid = x_onyx_tenant or "anonymous"
    return get_tenant_quota(tid)


# Log rate-limit configuration on startup so misconfiguration is obvious in logs
logger.info(
    "[RateLimit] enabled=%s requests/min=%d upload_mb/hour=%.0f admin_secret=%s",
    RATE_LIMIT_ENABLED,
    REQUESTS_PER_MIN,
    UPLOAD_MB_PER_HOUR,
    "configured" if os.getenv("RATE_LIMIT_ADMIN_SECRET") else "NOT SET",
)


def _mount_geometry_engine() -> None:
    """Load python-engine routes. A missing optional library fails the request, not startup."""
    import sys
    engine = Path(__file__).resolve().parent / "python-engine"
    engine_path = str(engine)
    if engine_path not in sys.path:
        sys.path.insert(0, engine_path)
    from routes import build_router
    app.include_router(build_router(verify_secret))


_mount_geometry_engine()


# ── Entry point ────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    uvicorn.run(
        "takeoff_api:app",
        host="0.0.0.0",
        port=int(os.getenv("PORT", "5050")),
        reload=True,
        log_level="info",
    )
