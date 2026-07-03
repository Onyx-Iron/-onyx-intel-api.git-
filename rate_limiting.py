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
from collections import defaultdict
from dataclasses import dataclass, field
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
# In-Memory Store (use Redis for production)
# ────────────────────────────────────────────────────────────────────────────

@dataclass
class TenantQuota:
    """Mutable quota usage for a single tenant in current window.

    Was previously a NamedTuple, which caused AttributeError on
    ``quota.request_count += 1`` since NamedTuple fields are immutable.
    """
    request_count: int = 0
    request_window_start: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    bytes_uploaded: int = 0
    upload_window_start: datetime = field(default_factory=lambda: datetime.now(timezone.utc))


# In-memory store: tenant_id -> TenantQuota
# For production, replace with Redis.
_quota_store: dict[str, TenantQuota] = defaultdict(TenantQuota)


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
    quota = _quota_store[tid]

    # ── Request rate limit (per minute) ──
    min_window_elapsed = now - quota.request_window_start
    if min_window_elapsed >= timedelta(minutes=1):
        # Reset window
        _quota_store[tid] = TenantQuota(
            request_count=1,
            request_window_start=now,
            bytes_uploaded=quota.bytes_uploaded,
            upload_window_start=quota.upload_window_start,
        )
    else:
        # Check current window
        _quota_store[tid].request_count += 1
        if _quota_store[tid].request_count > REQUESTS_PER_MIN:
            raise RateLimitExceeded(
                reason=f"Request limit exceeded: {REQUESTS_PER_MIN} requests per minute. "
                f"Retry in {(timedelta(minutes=1) - min_window_elapsed).total_seconds():.0f}s.",
                tenant_id=tid,
                limit_type="requests_per_minute",
                current=_quota_store[tid].request_count,
                limit=REQUESTS_PER_MIN,
            )

    # ── Upload size limit (per hour) ──
    if file_size_mb > 0:
        hour_window_elapsed = now - quota.upload_window_start
        if hour_window_elapsed >= timedelta(hours=1):
            # Reset window
            _quota_store[tid] = TenantQuota(
                request_count=_quota_store[tid].request_count,
                request_window_start=_quota_store[tid].request_window_start,
                bytes_uploaded=int(file_size_mb * 1024 * 1024),
                upload_window_start=now,
            )
        else:
            # Check current window
            new_total_bytes = quota.bytes_uploaded + int(file_size_mb * 1024 * 1024)
            limit_bytes = int(UPLOAD_MB_PER_HOUR * 1024 * 1024)
            if new_total_bytes > limit_bytes:
                raise RateLimitExceeded(
                    reason=f"Upload quota exceeded: {UPLOAD_MB_PER_HOUR} MB per hour. "
                    f"Current: {new_total_bytes / (1024 * 1024):.1f} MB. "
                    f"Retry in {(timedelta(hours=1) - hour_window_elapsed).total_seconds():.0f}s.",
                    tenant_id=tid,
                    limit_type="upload_mb_per_hour",
                    current=new_total_bytes / (1024 * 1024),
                    limit=UPLOAD_MB_PER_HOUR,
                )
            _quota_store[tid] = TenantQuota(
                request_count=_quota_store[tid].request_count,
                request_window_start=_quota_store[tid].request_window_start,
                bytes_uploaded=new_total_bytes,
                upload_window_start=_quota_store[tid].upload_window_start,
            )

    logger.info(
        f"[RateLimit] tenant={tid} requests={_quota_store[tid].request_count}/{REQUESTS_PER_MIN} "
        f"upload_mb={_quota_store[tid].bytes_uploaded / (1024 * 1024):.1f}/{UPLOAD_MB_PER_HOUR}"
    )

    return {
        "tenant_id": tid,
        "requests_current": _quota_store[tid].request_count,
        "requests_limit": REQUESTS_PER_MIN,
        "upload_mb_current": round(_quota_store[tid].bytes_uploaded / (1024 * 1024), 2),
        "upload_mb_limit": UPLOAD_MB_PER_HOUR,
    }


def reset_tenant_quota(tenant_id: str) -> None:
    """Reset quota for a specific tenant (admin use only)."""
    _quota_store[tenant_id] = TenantQuota(
        request_count=0,
        request_window_start=datetime.now(timezone.utc),
        bytes_uploaded=0,
        upload_window_start=datetime.now(timezone.utc),
    )
    logger.info(f"[RateLimit] Reset quota for tenant {tenant_id}")


def get_tenant_quota(tenant_id: str) -> dict:
    """Get current quota status for a tenant."""
    quota = _quota_store.get(
        tenant_id,
        TenantQuota(
            request_count=0,
            request_window_start=datetime.now(timezone.utc),
            bytes_uploaded=0,
            upload_window_start=datetime.now(timezone.utc),
        ),
    )
    return {
        "tenant_id": tenant_id,
        "requests_current": quota.request_count,
        "requests_limit": REQUESTS_PER_MIN,
        "upload_mb_current": round(quota.bytes_uploaded / (1024 * 1024), 2),
        "upload_mb_limit": UPLOAD_MB_PER_HOUR,
        "request_window_reset_in_seconds": (
            (quota.request_window_start + timedelta(minutes=1) - datetime.now(timezone.utc))
            .total_seconds()
        ),
        "upload_window_reset_in_seconds": (
            (quota.upload_window_start + timedelta(hours=1) - datetime.now(timezone.utc))
            .total_seconds()
        ),
    }
