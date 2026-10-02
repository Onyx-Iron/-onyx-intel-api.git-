"""
Onyx Intel — Per-Tenant Rate Limiting
======================================

Allows admin/owner accounts to bypass rate limits while enforcing
quotas on other users. Useful for controlling multi-tenant API usage
without restricting internal or premium accounts.

Configuration via environment:
  RATE_LIMIT_ENABLED       Set to "true" to enable (default: true)
  RATE_LIMIT_ADMIN_SECRET  Shared secret that grants unlimited access
  RATE_LIMIT_REQUESTS_PER_MIN   Requests per minute per tenant (default: 10)
  RATE_LIMIT_UPLOAD_MB_PER_HOUR Megabytes uploadable per hour (default: 500)

Usage:
  from rate_limiting import check_rate_limit, RateLimitExceeded
  
  try:
      check_rate_limit(tenant_id, file_size_mb, is_admin=True)
  except RateLimitExceeded as e:
      raise HTTPException(status_code=429, detail=str(e))
"""

from __future__ import annotations

import logging
import os
import sqlite3
import tempfile
from datetime import datetime, timedelta, timezone

logger = logging.getLogger(__name__)

# ────────────────────────────────────────────────────────────────────────────
# Configuration
# ────────────────────────────────────────────────────────────────────────────

RATE_LIMIT_ENABLED = os.getenv("RATE_LIMIT_ENABLED", "true").lower() == "true"
RATE_LIMIT_ADMIN_SECRET = os.getenv("RATE_LIMIT_ADMIN_SECRET", "")
REQUESTS_PER_MIN = int(os.getenv("RATE_LIMIT_REQUESTS_PER_MIN", "10"))
UPLOAD_MB_PER_HOUR = float(os.getenv("RATE_LIMIT_UPLOAD_MB_PER_HOUR", "500"))

# ────────────────────────────────────────────────────────────────────────────
# Shared store
# ────────────────────────────────────────────────────────────────────────────
# sqlite file so uvicorn --workers 2 on one host share counters.
# A second Railway replica still has its own disk; this does not replace Redis
# across machines. Set RATE_LIMIT_DB to pin the file (tests do).


def _db_path() -> str:
    configured = os.environ.get("RATE_LIMIT_DB", "").strip()
    if configured:
        return configured
    return os.path.join(tempfile.gettempdir(), "onyx_rate_limit.sqlite")


def _connect() -> sqlite3.Connection:
    path = _db_path()
    parent = os.path.dirname(path)
    if parent:
        os.makedirs(parent, exist_ok=True)
    conn = sqlite3.connect(path, timeout=5, isolation_level=None)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS quotas (
            tenant_id TEXT PRIMARY KEY,
            request_count INTEGER NOT NULL,
            request_window_start TEXT NOT NULL,
            bytes_uploaded INTEGER NOT NULL,
            upload_window_start TEXT NOT NULL
        )
        """
    )
    return conn


def _iso(moment: datetime) -> str:
    return moment.astimezone(timezone.utc).isoformat()


def _parse(value: str) -> datetime:
    parsed = datetime.fromisoformat(value)
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone.utc)
    return parsed


class RateLimitExceeded(Exception):
    """Raised when a tenant exceeds their rate limit."""

    def __init__(
        self,
        reason: str,
        tenant_id: str,
        limit_type: str,
        current: int | float,
        limit: int | float,
    ) -> None:
        self.reason = reason
        self.tenant_id = tenant_id
        self.limit_type = limit_type
        self.current = current
        self.limit = limit
        super().__init__(reason)


# ────────────────────────────────────────────────────────────────────────────
# Rate Limit Check
# ────────────────────────────────────────────────────────────────────────────


def is_admin(secret: str | None) -> bool:
    """Check if the provided secret grants admin privileges (bypass limits)."""
    if not RATE_LIMIT_ADMIN_SECRET:
        return False  # no admin secret configured
    return secret == RATE_LIMIT_ADMIN_SECRET


def check_rate_limit(
    tenant_id: str | None,
    file_size_mb: float = 0.0,
    secret: str | None = None,
) -> dict[str, int | float]:
    """
    Enforce per-tenant rate limits on requests and uploads.

    Args:
        tenant_id: UUID identifying the tenant. If None, uses "anonymous".
        file_size_mb: Size of uploaded file in MB. Defaults to 0 (API call with no upload).
        secret: Optional X-Onyx-Secret header. If it matches RATE_LIMIT_ADMIN_SECRET, bypass limits.

    Returns:
        Dict with current usage stats for logging/monitoring.

    Raises:
        RateLimitExceeded: If any limit exceeded (and not admin).

    Example:
        try:
            stats = check_rate_limit("tenant-uuid", file_size_mb=10.5, secret=header_secret)
            logger.info(f"Quota usage: {stats}")
        except RateLimitExceeded as e:
            raise HTTPException(status_code=429, detail=e.reason)
    """
    if not RATE_LIMIT_ENABLED:
        return {"status": "disabled"}

    # Admin bypass
    if is_admin(secret):
        logger.debug(f"[RateLimit] Admin secret recognized — bypass for {tenant_id}")
        return {"status": "admin_bypass"}

    tid = tenant_id or "anonymous"
    now = datetime.now(timezone.utc)
    exceeded: RateLimitExceeded | None = None

    conn = _connect()
    try:
        conn.execute("BEGIN IMMEDIATE")
        row = conn.execute(
            """
            SELECT request_count, request_window_start, bytes_uploaded, upload_window_start
            FROM quotas WHERE tenant_id = ?
            """,
            (tid,),
        ).fetchone()
        if row is None:
            request_count = 0
            request_window_start = now
            bytes_uploaded = 0
            upload_window_start = now
        else:
            request_count = int(row[0])
            request_window_start = _parse(row[1])
            bytes_uploaded = int(row[2])
            upload_window_start = _parse(row[3])

        min_window_elapsed = now - request_window_start
        if min_window_elapsed >= timedelta(minutes=1):
            request_count = 1
            request_window_start = now
        else:
            request_count += 1
            if request_count > REQUESTS_PER_MIN:
                exceeded = RateLimitExceeded(
                    reason=f"Request limit exceeded: {REQUESTS_PER_MIN} requests per minute. "
                    f"Retry in {(timedelta(minutes=1) - min_window_elapsed).total_seconds():.0f}s.",
                    tenant_id=tid,
                    limit_type="requests_per_minute",
                    current=request_count,
                    limit=REQUESTS_PER_MIN,
                )

        if exceeded is None and file_size_mb > 0:
            hour_window_elapsed = now - upload_window_start
            add_bytes = int(file_size_mb * 1024 * 1024)
            if hour_window_elapsed >= timedelta(hours=1):
                bytes_uploaded = add_bytes
                upload_window_start = now
            else:
                new_total_bytes = bytes_uploaded + add_bytes
                limit_bytes = int(UPLOAD_MB_PER_HOUR * 1024 * 1024)
                if new_total_bytes > limit_bytes:
                    exceeded = RateLimitExceeded(
                        reason=f"Upload quota exceeded: {UPLOAD_MB_PER_HOUR} MB per hour. "
                        f"Current: {new_total_bytes / (1024 * 1024):.1f} MB. "
                        f"Retry in {(timedelta(hours=1) - hour_window_elapsed).total_seconds():.0f}s.",
                        tenant_id=tid,
                        limit_type="upload_mb_per_hour",
                        current=new_total_bytes / (1024 * 1024),
                        limit=UPLOAD_MB_PER_HOUR,
                    )
                else:
                    bytes_uploaded = new_total_bytes

        conn.execute(
            """
            INSERT INTO quotas (
                tenant_id, request_count, request_window_start, bytes_uploaded, upload_window_start
            ) VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(tenant_id) DO UPDATE SET
                request_count = excluded.request_count,
                request_window_start = excluded.request_window_start,
                bytes_uploaded = excluded.bytes_uploaded,
                upload_window_start = excluded.upload_window_start
            """,
            (tid, request_count, _iso(request_window_start), bytes_uploaded, _iso(upload_window_start)),
        )
        conn.execute("COMMIT")
    except Exception:
        conn.execute("ROLLBACK")
        raise
    finally:
        conn.close()

    if exceeded is not None:
        raise exceeded

    current_requests = request_count
    current_bytes = bytes_uploaded

    logger.info(
        f"[RateLimit] tenant={tid} requests={current_requests}/{REQUESTS_PER_MIN} "
        f"upload_mb={current_bytes / (1024 * 1024):.1f}/{UPLOAD_MB_PER_HOUR}"
    )

    return {
        "tenant_id": tid,
        "requests_current": current_requests,
        "requests_limit": REQUESTS_PER_MIN,
        "upload_mb_current": round(current_bytes / (1024 * 1024), 2),
        "upload_mb_limit": UPLOAD_MB_PER_HOUR,
    }


def reset_tenant_quota(tenant_id: str) -> None:
    """Reset quota for a specific tenant (admin use only)."""
    now = datetime.now(timezone.utc)
    conn = _connect()
    try:
        conn.execute("BEGIN IMMEDIATE")
        conn.execute(
            """
            INSERT INTO quotas (
                tenant_id, request_count, request_window_start, bytes_uploaded, upload_window_start
            ) VALUES (?, 0, ?, 0, ?)
            ON CONFLICT(tenant_id) DO UPDATE SET
                request_count = 0,
                request_window_start = excluded.request_window_start,
                bytes_uploaded = 0,
                upload_window_start = excluded.upload_window_start
            """,
            (tenant_id, _iso(now), _iso(now)),
        )
        conn.execute("COMMIT")
    except Exception:
        conn.execute("ROLLBACK")
        raise
    finally:
        conn.close()
    logger.info(f"[RateLimit] Reset quota for tenant {tenant_id}")


def get_tenant_quota(tenant_id: str) -> dict:
    """Get current quota status for a tenant."""
    conn = _connect()
    try:
        row = conn.execute(
            """
            SELECT request_count, request_window_start, bytes_uploaded, upload_window_start
            FROM quotas WHERE tenant_id = ?
            """,
            (tenant_id,),
        ).fetchone()
    finally:
        conn.close()

    now = datetime.now(timezone.utc)
    if row is None:
        request_count = 0
        request_window_start = now
        bytes_uploaded = 0
        upload_window_start = now
    else:
        request_count = int(row[0])
        request_window_start = _parse(row[1])
        bytes_uploaded = int(row[2])
        upload_window_start = _parse(row[3])

    return {
        "tenant_id": tenant_id,
        "requests_current": request_count,
        "requests_limit": REQUESTS_PER_MIN,
        "upload_mb_current": round(bytes_uploaded / (1024 * 1024), 2),
        "upload_mb_limit": UPLOAD_MB_PER_HOUR,
        "request_window_reset_in_seconds": (
            (request_window_start + timedelta(minutes=1) - now).total_seconds()
        ),
        "upload_window_reset_in_seconds": (
            (upload_window_start + timedelta(hours=1) - now).total_seconds()
        ),
    }
