"""
fetch_bls_ppi.py — Pull BLS Producer Price Index (PPI) series and POST to
Onyx Intel's `/api/cost-catalog/ingest/bls` endpoint.

The PPI tracks the prices producers receive for their output. For construction
cost estimating we care about the input commodity series (concrete, lumber,
steel, copper, asphalt, ...). These series are the canonical "raw material"
price signal RSMeans-style services internally trend against.

API: https://api.bls.gov/publicAPI/v2/timeseries/data/
Docs: https://www.bls.gov/developers/api_signature_v2.htm

Env vars:
    BLS_API_KEY            — optional, registration is free at
                             https://data.bls.gov/registrationEngine/
                             Without a key you're limited to 25 series/day,
                             10y range; with a key it's 500 series/day.
    ONYX_PORTAL_URL        — e.g. https://onyx-intel.vercel.app
    ONYX_INGEST_TOKEN      — bearer token for the ingest endpoint
                             (provisioned in portal admin)

Run:
    python scripts/fetch_bls_ppi.py
    python scripts/fetch_bls_ppi.py --series WPU0811 WPU101
    python scripts/fetch_bls_ppi.py --dry-run
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime, timezone
from typing import Any

import requests

# ────────────────────────────────────────────────────────────────────────────
# Seed: 20 common construction PPI series, mapped to CSI divisions
# ────────────────────────────────────────────────────────────────────────────

SEED_SERIES: list[dict[str, str]] = [
    # Division 03 — Concrete
    {"series_id": "WPU132",   "csi_div": "03", "description": "Concrete products"},
    {"series_id": "WPU1322",  "csi_div": "03", "description": "Ready-mixed concrete"},
    {"series_id": "WPU1321",  "csi_div": "03", "description": "Concrete block & brick"},
    # Division 04 — Masonry
    {"series_id": "WPU133",   "csi_div": "04", "description": "Brick & structural clay tile"},
    # Division 05 — Metals
    {"series_id": "WPU101",   "csi_div": "05", "description": "Iron and steel"},
    {"series_id": "WPU1017",  "csi_div": "05", "description": "Steel mill products"},
    {"series_id": "WPU102",   "csi_div": "05", "description": "Nonferrous metals (copper, aluminum)"},
    {"series_id": "WPU10250105", "csi_div": "05", "description": "Aluminum mill shapes"},
    # Division 06 — Wood
    {"series_id": "WPU081",   "csi_div": "06", "description": "Lumber"},
    {"series_id": "WPU0811",  "csi_div": "06", "description": "Softwood lumber"},
    {"series_id": "WPU083",   "csi_div": "06", "description": "Plywood"},
    {"series_id": "WPU0851",  "csi_div": "06", "description": "Millwork"},
    # Division 07 — Thermal & moisture
    {"series_id": "WPU0571",  "csi_div": "07", "description": "Asphalt paving mixtures"},
    {"series_id": "WPU13710101", "csi_div": "07", "description": "Insulation, fiberglass batt"},
    # Division 09 — Finishes
    {"series_id": "WPU1321",  "csi_div": "09", "description": "Gypsum products (drywall)"},
    {"series_id": "WPU0623",  "csi_div": "09", "description": "Paints and coatings"},
    # Division 22/23 — Plumbing / HVAC
    {"series_id": "WPU114",   "csi_div": "22", "description": "Plumbing fixtures & brass fittings"},
    {"series_id": "WPU1133",  "csi_div": "23", "description": "Heating equipment"},
    # Division 26 — Electrical
    {"series_id": "WPU1175",  "csi_div": "26", "description": "Wiring devices"},
    {"series_id": "WPU10260213", "csi_div": "26", "description": "Insulated copper wire & cable"},
]

BLS_ENDPOINT = "https://api.bls.gov/publicAPI/v2/timeseries/data/"


def portal_url() -> str:
    return (os.environ.get("ONYX_PORTAL_URL") or "http://localhost:3000").rstrip("/")


def fetch_series(series_ids: list[str], start_year: int | None = None,
                 end_year: int | None = None) -> dict[str, Any]:
    """Fetch one or more BLS PPI series. Returns the raw BLS API payload."""
    end = end_year or datetime.now(timezone.utc).year
    start = start_year or (end - 3)
    body: dict[str, Any] = {
        "seriesid": series_ids,
        "startyear": str(start),
        "endyear": str(end),
    }
    key = os.environ.get("BLS_API_KEY")
    if key:
        body["registrationkey"] = key
    resp = requests.post(
        BLS_ENDPOINT,
        json=body,
        headers={"Content-Type": "application/json"},
        timeout=30,
    )
    resp.raise_for_status()
    return resp.json()


def to_ingest_payload(bls_response: dict[str, Any],
                      meta_by_series: dict[str, dict[str, str]]) -> dict[str, Any]:
    """Transform a BLS API response into the portal's ingest payload shape."""
    items: list[dict[str, Any]] = []
    series_list = (bls_response.get("Results") or {}).get("series") or []
    for series in series_list:
        sid = series.get("seriesID")
        meta = meta_by_series.get(sid, {})
        data_points = series.get("data") or []
        # newest entry is first in BLS response
        for point in data_points:
            items.append({
                "series_id": sid,
                "csi_div": meta.get("csi_div"),
                "description": meta.get("description"),
                "year": int(point.get("year")),
                "period": point.get("period"),       # e.g. "M03"
                "period_name": point.get("periodName"),
                "value": float(point.get("value")),
                "footnotes": [
                    f.get("text") for f in (point.get("footnotes") or []) if f
                ],
            })
    return {
        "source": "bls_ppi",
        "fetched_at": datetime.now(timezone.utc).isoformat(),
        "items": items,
    }


def post_to_ingest(payload: dict[str, Any]) -> requests.Response:
    url = f"{portal_url()}/api/cost-catalog/ingest/bls"
    token = os.environ.get("ONYX_INGEST_TOKEN", "")
    resp = requests.post(
        url,
        json=payload,
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {token}",
        },
        timeout=30,
    )
    return resp


def main() -> int:
    parser = argparse.ArgumentParser(description="Fetch BLS PPI series and ingest to Onyx Intel")
    parser.add_argument("--series", nargs="*", help="Override seed list with specific series IDs")
    parser.add_argument("--start-year", type=int, default=None)
    parser.add_argument("--end-year", type=int, default=None)
    parser.add_argument("--dry-run", action="store_true",
                        help="Print payload instead of POSTing")
    args = parser.parse_args()

    if args.series:
        series_meta = {s: {"csi_div": "?", "description": s} for s in args.series}
    else:
        series_meta = {s["series_id"]: s for s in SEED_SERIES}

    series_ids = list(series_meta.keys())
    print(f"[bls] fetching {len(series_ids)} series from BLS…", file=sys.stderr)

    # BLS allows up to 50 series per request without a key, 50 with v2 + key
    batch_size = 25
    all_items: list[dict[str, Any]] = []
    for i in range(0, len(series_ids), batch_size):
        batch = series_ids[i:i + batch_size]
        raw = fetch_series(batch, args.start_year, args.end_year)
        if raw.get("status") != "REQUEST_SUCCEEDED":
            print(f"[bls] batch error: {raw.get('message')}", file=sys.stderr)
            continue
        payload = to_ingest_payload(raw, series_meta)
        all_items.extend(payload["items"])

    final = {
        "source": "bls_ppi",
        "fetched_at": datetime.now(timezone.utc).isoformat(),
        "items": all_items,
    }
    print(f"[bls] {len(all_items)} datapoints assembled", file=sys.stderr)

    if args.dry_run:
        print(json.dumps(final, indent=2)[:4000])
        return 0

    resp = post_to_ingest(final)
    print(f"[bls] ingest -> {resp.status_code}: {resp.text[:300]}", file=sys.stderr)
    return 0 if resp.ok else 1


if __name__ == "__main__":
    sys.exit(main())
