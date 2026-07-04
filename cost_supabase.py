"""
Onyx Intel — Supabase-backed cost catalog client

Talks to the Portal's `/api/cost-catalog/v2` endpoint (which fronts Supabase
RLS-protected tables). Used by `enhanced_takeoff_system.CostDatabase` when
running in "supabase" mode.

Env:
    SUPABASE_URL          — e.g. https://xyz.supabase.co
    SUPABASE_SERVICE_KEY  — service-role key (server-only)
    ONYX_PORTAL_URL       — e.g. https://onyx-intel.vercel.app (optional;
                            defaults to SUPABASE_URL host or localhost:3000)

All lookups go through the portal (not Supabase directly) so that tenant
isolation, audit logging, and the location-based resolution logic stay in
one place. This client is a thin transport + cache.
"""

from __future__ import annotations

import logging
import os
import threading
import time
from typing import Any

import requests

logger = logging.getLogger(__name__)

# ────────────────────────────────────────────────────────────────────────────
# Config
# ────────────────────────────────────────────────────────────────────────────

_DEFAULT_TIMEOUT = 8.0
_CACHE_TTL_SECONDS = 300  # 5 minutes


_portal_url_warned = False


def _portal_base_url() -> str:
    global _portal_url_warned
    explicit = os.environ.get("ONYX_PORTAL_URL")
    if explicit:
        return explicit.rstrip("/")
    fallback = os.environ.get("NEXT_PUBLIC_SITE_URL", "http://localhost:3000").rstrip("/")
    if not _portal_url_warned and ("localhost" in fallback or "127.0.0.1" in fallback):
        logger.warning(
            "[cost_supabase] ONYX_PORTAL_URL is not set — falling back to %s. "
            "Cost lookups will fail in production. Set ONYX_PORTAL_URL to the "
            "public portal URL (e.g. https://app.onyx-iron.com).",
            fallback,
        )
        _portal_url_warned = True
    return fallback


def _service_key() -> str | None:
    return os.environ.get("SUPABASE_SERVICE_KEY") or os.environ.get(
        "SUPABASE_SERVICE_ROLE_KEY"
    )


def is_configured() -> bool:
    """Return True if env is set up for Supabase-mode lookups."""
    return bool(os.environ.get("SUPABASE_URL") and _service_key())


# ────────────────────────────────────────────────────────────────────────────
# In-memory TTL cache
# ────────────────────────────────────────────────────────────────────────────

_cache_lock = threading.Lock()
_cache: dict[tuple[str, str, str], tuple[float, dict[str, Any] | None]] = {}


def _cache_key(csi_code: str, tenant_id: str | None, region: str) -> tuple[str, str, str]:
    return (csi_code.strip().lower(), (tenant_id or "_global").lower(), region.lower())


def _cache_get(key: tuple[str, str, str]) -> dict[str, Any] | None | object:
    sentinel = object()
    with _cache_lock:
        entry = _cache.get(key)
        if entry is None:
            return sentinel
        expires_at, value = entry
        if expires_at < time.time():
            _cache.pop(key, None)
            return sentinel
        return value


def _cache_put(key: tuple[str, str, str], value: dict[str, Any] | None) -> None:
    with _cache_lock:
        _cache[key] = (time.time() + _CACHE_TTL_SECONDS, value)


def clear_cache() -> None:
    """Test / admin hook."""
    with _cache_lock:
        _cache.clear()


# ────────────────────────────────────────────────────────────────────────────
# Region resolution (zip / state → cost region)
# ────────────────────────────────────────────────────────────────────────────

_STATE_TO_REGION = {
    # West
    "CA": "US_WEST", "OR": "US_WEST", "WA": "US_WEST", "NV": "US_WEST",
    "AZ": "US_WEST", "ID": "US_WEST", "UT": "US_WEST", "MT": "US_WEST",
    "WY": "US_WEST", "CO": "US_WEST", "NM": "US_WEST", "AK": "US_WEST",
    "HI": "US_WEST",
    # Midwest
    "ND": "US_MIDWEST", "SD": "US_MIDWEST", "NE": "US_MIDWEST", "KS": "US_MIDWEST",
    "MN": "US_MIDWEST", "IA": "US_MIDWEST", "MO": "US_MIDWEST", "WI": "US_MIDWEST",
    "IL": "US_MIDWEST", "MI": "US_MIDWEST", "IN": "US_MIDWEST", "OH": "US_MIDWEST",
    # South
    "TX": "US_SOUTH", "OK": "US_SOUTH", "AR": "US_SOUTH", "LA": "US_SOUTH",
    "MS": "US_SOUTH", "AL": "US_SOUTH", "TN": "US_SOUTH", "KY": "US_SOUTH",
    "GA": "US_SOUTH", "FL": "US_SOUTH", "SC": "US_SOUTH", "NC": "US_SOUTH",
    "VA": "US_SOUTH", "WV": "US_SOUTH",
    # East / Northeast
    "MD": "US_EAST", "DE": "US_EAST", "DC": "US_EAST", "PA": "US_EAST",
    "NJ": "US_EAST", "NY": "US_EAST", "CT": "US_EAST", "RI": "US_EAST",
    "MA": "US_EAST", "VT": "US_EAST", "NH": "US_EAST", "ME": "US_EAST",
}


def resolve_region(state_code: str | None, zip_code: str | None = None) -> str:
    """Best-effort map of (state, zip) → cost-region key."""
    if state_code:
        region = _STATE_TO_REGION.get(state_code.strip().upper())
        if region:
            return region
    if zip_code:
        # Very rough fallback by first ZIP digit
        first = zip_code.strip()[:1]
        zip_region = {
            "0": "US_EAST", "1": "US_EAST", "2": "US_EAST",
            "3": "US_SOUTH", "4": "US_MIDWEST", "5": "US_MIDWEST",
            "6": "US_MIDWEST", "7": "US_SOUTH",
            "8": "US_WEST", "9": "US_WEST",
        }.get(first)
        if zip_region:
            return zip_region
    return "US_EAST"


# ────────────────────────────────────────────────────────────────────────────
# Portal HTTP calls
# ────────────────────────────────────────────────────────────────────────────


def _headers(tenant_id: str | None) -> dict[str, str]:
    key = _service_key() or ""
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {key}",
        "apikey": key,
    }
    if tenant_id:
        headers["X-Onyx-Tenant"] = tenant_id
    return headers


_CONFIDENCE_TO_FLOAT = {"high": 0.95, "medium": 0.75, "low": 0.5}


def _normalize(item: dict[str, Any] | None) -> dict[str, Any] | None:
    """Normalize one portal `CostResolveResult` item into the legacy shape."""
    if not isinstance(item, dict):
        return None
    if item.get("source") == "none":
        return None
    base = float(item.get("unit_cost") or 0.0)
    if base <= 0:
        return None
    labor = float(item.get("labor_cost") or 0.0)
    material = float(item.get("material_cost") or 0.0)
    equipment = float(item.get("equipment_cost") or 0.0)
    if labor == 0.0 and material == 0.0 and equipment == 0.0:
        labor, material, equipment = base * 0.40, base * 0.45, base * 0.15
    conf = item.get("confidence")
    if isinstance(conf, str):
        conf_val = _CONFIDENCE_TO_FLOAT.get(conf, 0.75)
    else:
        try:
            conf_val = float(conf) if conf is not None else 0.75
        except (TypeError, ValueError):
            conf_val = 0.75
    return {
        "csi_code": item.get("cost_code") or "",
        "trade": "",
        "description": item.get("detail") or "",
        "region": item.get("region_code") or "US_EAST",
        "base_unit_cost": base,
        "labor_cost": labor,
        "material_cost": material,
        "equipment_cost": equipment,
        "supplier_id": None,
        "source_database": item.get("source") or "supabase",
        "last_updated": item.get("observed_at") or "",
        "confidence": conf_val,
    }


def resolve_unit_cost(
    csi_code: str,
    tenant_id: str | None,
    zip_code: str | None = None,
    state_code: str | None = None,
) -> dict[str, Any] | None:
    """Resolve a single CSI code's unit cost via the portal.

    Returns the same shape as `CostResolveResult` on the portal side, or None
    if the catalog has no entry (caller should fall back to manual estimate).
    """
    if not csi_code:
        return None
    region = resolve_region(state_code, zip_code)
    key = _cache_key(csi_code, tenant_id, region)
    with _cache_lock:
        entry = _cache.get(key)
    if entry is not None:
        expires_at, value = entry
        if expires_at >= time.time():
            return value
        # else fall through and refetch

    base = _portal_base_url()
    url = f"{base}/api/cost-catalog/v2"
    params: dict[str, str] = {"cost_codes": csi_code}
    if zip_code:
        params["zip"] = zip_code
    if state_code:
        params["state"] = state_code

    try:
        resp = requests.get(
            url,
            params=params,
            headers=_headers(tenant_id),
            timeout=_DEFAULT_TIMEOUT,
        )
    except requests.RequestException as exc:
        logger.warning("cost-catalog GET failed for %s: %s", csi_code, exc)
        return None

    if resp.status_code == 404:
        _cache_put(key, None)
        return None
    if not resp.ok:
        logger.warning(
            "cost-catalog GET %s returned %s: %s",
            csi_code, resp.status_code, resp.text[:200],
        )
        return None

    try:
        payload = resp.json()
    except ValueError:
        logger.warning("cost-catalog returned non-JSON for %s", csi_code)
        return None

    items = payload.get("items") if isinstance(payload, dict) else None
    item = items[0] if isinstance(items, list) and items else None
    normalized = _normalize(item)

    _cache_put(key, normalized)
    return normalized


def bulk_resolve(
    csi_codes: list[str],
    tenant_id: str | None,
    zip_code: str | None = None,
    state_code: str | None = None,
) -> dict[str, dict[str, Any]]:
    """Batch resolve. Uses the portal's POST batch endpoint if available, else
    falls back to per-code GETs (still benefits from the cache)."""
    if not csi_codes:
        return {}
    region = resolve_region(state_code, zip_code)
    out: dict[str, dict[str, Any]] = {}
    uncached: list[str] = []

    for code in csi_codes:
        key = _cache_key(code, tenant_id, region)
        with _cache_lock:
            entry = _cache.get(key)
        if entry and entry[0] >= time.time():
            if entry[1] is not None:
                out[code] = entry[1]
            continue
        uncached.append(code)

    if not uncached:
        return out

    # Use the GET endpoint with comma-joined codes (route accepts this batch form)
    base = _portal_base_url()
    url = f"{base}/api/cost-catalog/v2"
    params: dict[str, str] = {"cost_codes": ",".join(uncached)}
    if zip_code:
        params["zip"] = zip_code
    if state_code:
        params["state"] = state_code

    try:
        resp = requests.get(
            url,
            params=params,
            headers=_headers(tenant_id),
            timeout=_DEFAULT_TIMEOUT,
        )
    except requests.RequestException as exc:
        logger.warning("cost-catalog batch failed, falling back to singles: %s", exc)
        for code in uncached:
            result = resolve_unit_cost(code, tenant_id, zip_code, state_code)
            if result is not None:
                out[code] = result
        return out

    if not resp.ok:
        logger.warning(
            "cost-catalog batch returned %s: %s",
            resp.status_code, resp.text[:200],
        )
        return out

    try:
        payload = resp.json()
    except ValueError:
        return out

    items = payload.get("items") if isinstance(payload, dict) else None
    if not isinstance(items, list):
        return out
    # Items come back in the same order as the requested codes
    for code, item in zip(uncached, items):
        normalized = _normalize(item if isinstance(item, dict) else None)
        _cache_put(_cache_key(code, tenant_id, region), normalized)
        if normalized is not None:
            out[code] = normalized
    return out
