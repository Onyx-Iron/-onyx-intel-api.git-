# Onyx Intel API — Complete Debugging Report

**Generated:** 2026-06-30  
**Repo:** Onyx-Iron/-onyx-intel-api.git- (ID: 1282470309)  
**Status:** ⚠️ **INTEGRATION REQUIRED** — New rate limiting module created but NOT wired into API

---

## 🔴 Critical Issues

### 1. **Rate Limiting Module Created But Disconnected**
**Severity:** HIGH  
**File:** `rate_limiting.py` (new)  
**Problem:** The `rate_limiting.py` module was created but **no endpoints call it**. 

**Current State:**
```python
# rate_limiting.py exists but is orphaned
# takeoff_api.py still has NO rate limit checks
```

**Evidence:** 
- `takeoff_api.py` line 101–157: `/api/stream/upload` has **zero rate limit enforcement**
- No import of `rate_limiting` anywhere in the API
- No `check_rate_limit()` calls in any endpoint

**Impact:** Users can upload unlimited data regardless of configuration.

**Fix Required:**
```python
# At top of takeoff_api.py, add:
from rate_limiting import check_rate_limit, RateLimitExceeded

# In upload_and_stream, BEFORE processing file:
try:
    check_rate_limit(
        tenant_id=x_onyx_tenant,
        file_size_mb=len(content) / (1024 * 1024),
        secret=x_onyx_secret,
    )
except RateLimitExceeded as e:
    logger.warning(f"Rate limit exceeded: {e.reason}")
    raise HTTPException(status_code=429, detail=e.reason)
```

---

### 2. **Path Traversal Vulnerability in `/api/stream/takeoff/{file_path}`**
**Severity:** CRITICAL  
**File:** `takeoff_api.py`, lines 414–439  
**Problem:** No base directory validation. Attacker can request `/api/stream/takeoff/../../etc/passwd`

**Current Code:**
```python
@app.get("/api/stream/takeoff/{file_path:path}")
async def stream_server_file(file_path: str, ...):
    target = Path(file_path)  # ← VULNERABLE: no base directory check
    if not target.exists():
        raise HTTPException(status_code=404, ...)
```

**Attack:** 
```bash
curl -H "X-Onyx-Secret: secret" \
  "http://localhost:5050/api/stream/takeoff/../../etc/passwd"
# ✗ Could leak system files
```

**Fix:**
```python
import os

BASE_DIR = Path(os.getenv("TAKEOFF_BASE_DIR", "/var/takeoffs"))

@app.get("/api/stream/takeoff/{file_path:path}")
async def stream_server_file(file_path: str, ...):
    target = (BASE_DIR / file_path).resolve()
    
    # Verify resolved path is under BASE_DIR
    if not str(target).startswith(str(BASE_DIR.resolve())):
        raise HTTPException(status_code=403, detail="Access denied")
    
    if not target.exists() or not target.is_file():
        raise HTTPException(status_code=404, detail="File not found")
```

---

### 3. **No Input Validation on Tenant/Project IDs**
**Severity:** HIGH  
**File:** `takeoff_api.py`, lines 84–90  
**Problem:** Headers not validated as UUIDs. Can be any string, including SQL injection attempts.

**Current Code:**
```python
if tenant_id or project_id:
    payload["tenant_id"] = tenant_id  # ← Could be "'; DROP TABLE--"
    payload["project_id"] = project_id
```

**Fix:**
```python
import uuid

def _validate_uuid_header(value: str | None, field_name: str) -> str | None:
    if not value:
        return None
    try:
        uuid.UUID(value)
        return value
    except ValueError:
        logger.warning(f"Invalid {field_name} format (not UUID): {value[:20]}")
        return None

# In stream endpoints:
x_onyx_tenant_clean = _validate_uuid_header(x_onyx_tenant, "X-Onyx-Tenant")
x_onyx_project_clean = _validate_uuid_header(x_onyx_project, "X-Onyx-Project")
```

---

### 4. **Async/Sync Mismatch in `_stream_file()`**
**Severity:** MEDIUM  
**File:** `takeoff_api.py`, lines 67–96  
**Problem:** `CSITakeoffStreamProcessor.parse_and_stream_sheet()` is async but called from sync context

**Current Code:**
```python
def _stream_file(...) -> AsyncGenerator[bytes, None]:
    processor = CSITakeoffStreamProcessor(...)
    async def _inject() -> AsyncGenerator[bytes, None]:
        async for raw_frame in processor.parse_and_stream_sheet():  # ← Called in async context
            ...
    return _inject()
```

**Problem:** `_inject()` is async but defined inside a sync function.

**Fix:**
```python
async def _stream_file(...) -> AsyncGenerator[bytes, None]:
    processor = CSITakeoffStreamProcessor(...)
    async for raw_frame in processor.parse_and_stream_sheet():
        # process frame
        yield raw_frame
```

---

### 5. **No Error Recovery for Large PDFs**
**Severity:** MEDIUM  
**File:** `takeoff_extract.py`, lines 250–344  
**Problem:** If a PDF page fails to extract, the entire file operation fails with no fallback

**Current Code:**
```python
try:
    tables = page.extract_tables() or []
except Exception:
    tables = []  # Silent skip — no logging
```

**Better:**
```python
try:
    tables = page.extract_tables() or []
except Exception as e:
    logger.warning(f"[PDF] Page {idx} table extraction failed: {e}")
    tables = []  # Still skip, but logged
```

---

## 🟡 High Priority Issues

### 6. **Rate Limiting Module Bug: NamedTuple Reassignment**
**Severity:** MEDIUM  
**File:** `rate_limiting.py`, line 142–191  
**Problem:** Trying to reassign immutable NamedTuple fields

**Current Code:**
```python
_quota_store[tid] = TenantQuota(...)
# ... later:
_quota_store[tid].request_count += 1  # ← FAILS! NamedTuple is immutable
```

**Fix:** Replace with mutable dataclass or just reconstruct:
```python
from dataclasses import dataclass, field

@dataclass
class TenantQuota:
    request_count: int = 0
    request_window_start: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    bytes_uploaded: int = 0
    upload_window_start: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
```

Or always create new instances:
```python
_quota_store[tid] = TenantQuota(
    request_count=_quota_store[tid].request_count + 1,  # ← Create new
    request_window_start=_quota_store[tid].request_window_start,
    ...
)
```

---

### 7. **No Error Categorization Fallback for Pydantic v2**
**Severity:** MEDIUM  
**File:** `takeoff_validator.py`, lines 419–427  
**Problem:** String-matching error classification is fragile and won't work with Pydantic v2.10

**Current:**
```python
category = (
    "NEGATIVE_QUANTITY"  if "negative"       in err_lower else
    "INVALID_COST_CODE"  if "cost_code"      in err_lower or "pattern" in err_lower else
    ...
)
```

**Will Break With Pydantic v2.10+** error messages are different.

**Better:**
```python
from pydantic_core import ValidationError

try:
    validated = SecureTakeoffRow(**raw_row)
except ValidationError as exc:
    for error in exc.errors():
        field = error.get("loc", [None])[0]
        error_type = error.get("type")
        
        category_map = {
            ("total_qty", "less_than"): "NEGATIVE_QUANTITY",
            ("cost_code", "string_pattern"): "INVALID_COST_CODE",
            ...
        }
        category = category_map.get((field, error_type), "SCHEMA_VIOLATION")
        break
```

---

### 8. **IFC Import Still in requirements.txt Despite "Optional"**
**Severity:** LOW  
**File:** `requirements.txt`, line 12  
**Problem:** `ifcopenshell==0.8.5` listed as required, but fails on many systems (Alpine, Windows without C++).

**Current:**
```
ifcopenshell==0.8.5  # ← Required, but many systems can't install
```

**Better:**
```
# requirements.txt
# Core dependencies
fastapi==0.115.5
...

# Optional for IFC support (may require C++ build tools)
# Uncomment to enable: ifcopenshell==0.8.5
```

---

### 9. **No Health Check Dependency Verification**
**Severity:** LOW  
**File:** `takeoff_api.py`, lines 442–450  
**Problem:** `/api/health` doesn't verify that critical libraries are importable

**Current:**
```python
@app.get("/api/health")
async def health() -> dict:
    return {
        "status": "ok",  # ← Always "ok" even if pdfplumber not installed
        ...
    }
```

**Fix:**
```python
@app.get("/api/health")
async def health() -> dict:
    missing_deps = []
    
    for lib in ["pdfplumber", "ezdxf", "openpyxl"]:
        try:
            __import__(lib)
        except ImportError:
            missing_deps.append(lib)
    
    return {
        "status": "degraded" if missing_deps else "ok",
        "missing_dependencies": missing_deps,
        "service": "onyx-intel-takeoff-stream",
        "version": "2.3.0",
        "auth": "enabled" if API_SECRET else "disabled",
    }
```

---

### 10. **DWG Error Handling Not User-Friendly**
**Severity:** LOW  
**File:** `takeoff_extract.py`, lines 351–362  
**Problem:** Error message for binary DWG files is technical, not actionable

**Current:**
```python
except (ezdxf.DXFStructureError, IOError) as e:
    raise ValueError(
        f"Could not read as DXF ({e}). For binary .dwg, export to DXF "
        f"from your CAD tool (Save As → AutoCAD DXF) and re-upload."
    )
```

**Better:**
```python
except (ezdxf.DXFStructureError, IOError) as e:
    if ".dwg" in str(e).lower() or Path(path).suffix.lower() == ".dwg":
        raise ValueError(
            "📋 **Binary DWG Format Not Supported**\n\n"
            "Your file appears to be a binary AutoCAD DWG. To extract takeoff data:\n\n"
            "1. Open the file in AutoCAD or LibreOffice Draw\n"
            "2. Go to **File → Save As** (or Export)\n"
            "3. Select **AutoCAD DXF (*.dxf)** as the format\n"
            "4. Re-upload the .dxf file to this API\n\n"
            f"Technical: {e}"
        )
    raise ValueError(f"Could not parse file: {e}")
```

---

## 🟢 Working Well

### ✅ Zero-Skip Validation Engine
**File:** `takeoff_validator.py`  
**Status:** Excellent  
- Structural invariants [I-1] through [I-6] properly enforced
- Balance audit correctly reconciles source↔destination checksums
- Every failed row captured in `ValidationErrorRecord`
- `PipelineGuard` prevents downstream contamination

### ✅ Deterministic Extraction
**File:** `takeoff_extract.py`  
**Status:** Strong  
- 104 CSI MasterFormat rules cover most trades
- UOM normalization robust (16+ variants)
- PDF drawing-vs-schedule detection working
- Page-by-page release prevents OOM on large files

### ✅ CORS & Auth
**File:** `takeoff_api.py`, lines 48–62  
**Status:** Good  
- CORS configured per environment variable
- `X-Onyx-Secret` header checked on all upload endpoints
- Properly rejects unauthorized requests

---

## 🛠️ Action Items (Prioritized)

### Phase 1 — **DO IMMEDIATELY** (Security)
- [ ] **Wire rate limiting into all endpoints** (`takeoff_api.py`)
- [ ] **Fix path traversal vulnerability** in `/api/stream/takeoff/{path}`
- [ ] **Validate UUID headers** (tenant/project IDs)

### Phase 2 — **Before Production** (Stability)
- [ ] Fix `NamedTuple` mutation bug in `rate_limiting.py`
- [ ] Use Pydantic error introspection instead of string matching
- [ ] Make `_stream_file()` truly async
- [ ] Add dependency checks to `/api/health`

### Phase 3 — **Polish** (UX/Ops)
- [ ] Improve DWG error messages
- [ ] Make ifcopenshell truly optional
- [ ] Add structured logging (structlog)
- [ ] Add request correlation IDs
- [ ] Write integration tests

---

## 📋 Deployment Checklist

Before deploying to Railway:

```bash
# 1. Set environment variables
RATE_LIMIT_ENABLED=true
RATE_LIMIT_ADMIN_SECRET=your-super-secret-key
RATE_LIMIT_REQUESTS_PER_MIN=10
RATE_LIMIT_UPLOAD_MB_PER_HOUR=500
TAKEOFF_BASE_DIR=/var/takeoffs  # NEW: for path traversal fix

# 2. Test locally
python -m pytest tests/  # (no tests exist yet!)

# 3. Run health check
curl http://localhost:5050/api/health

# 4. Test rate limiting
for i in {1..15}; do
  curl -X POST http://localhost:5050/api/stream/upload \
    -H "X-Onyx-Secret: $RATE_LIMIT_ADMIN_SECRET" \
    -F "file=@dummy.json"
done
# Should see 429 after 10 requests (if rate limit wired in)
```

---

## 📊 Overall Health Score

| Component | Score | Status |
|-----------|-------|--------|
| Validation Engine | 9/10 | ✅ Production-ready |
| Extraction Logic | 8/10 | ✅ Solid, minor edge cases |
| API Endpoints | 5/10 | ⚠️ Rate limiting not wired |
| Security | 3/10 | 🔴 Path traversal, no input validation |
| Error Handling | 6/10 | ⚠️ Brittle classification |
| **Overall** | **6/10** | ⚠️ **Needs integration fixes** |

---

## 📞 Next Steps

1. **Review this report** with your team
2. **Implement Phase 1 fixes** (security-critical)
3. **Wire rate limiting** into `takeoff_api.py`
4. **Add unit tests** for all extractors
5. **Deploy to Railway** with new env vars

Need help implementing any of these fixes? Let me know!

