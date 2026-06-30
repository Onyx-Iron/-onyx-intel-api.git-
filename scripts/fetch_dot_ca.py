"""
fetch_dot_ca.py — Caltrans bid-summary fetcher (skeleton).

Caltrans (California Department of Transportation) publishes "Bid Summary"
reports for every state highway contract awarded. Same idea as TxDOT bid tabs:
public, item-level, geographically tagged.

Why Caltrans matters for Onyx Intel:
  • Establishes the US_WEST baseline for heavy-civil work — California's high
    labor and compliance costs anchor the top of the cost-region multiplier.
  • Comprehensive caltrans item codes (e.g. 19-100 "Roadway Excavation") map
    cleanly to CSI MasterFormat Divisions 31–33 (Sitework / Concrete / Utilities).

Where to find the data:
  • Bid summary list:  https://dot.ca.gov/programs/design/contract-standards/bid-summary
  • Item-cost data:    https://dot.ca.gov/programs/design/contract-standards/contract-cost-data
                       (quarterly item-price averages by district, statewide)
  • PDF bid summaries are organized by Contract Number (e.g. 04-1J7104)

TODO (data-engineering follow-up):
  • Scrape the bid-summary index page (each row links to a PDF + Excel)
  • Pull the per-item Contract Cost Data spreadsheet (it's the easier source)
  • Map Caltrans item codes → CSI MasterFormat divisions
  • Convert quantities (Caltrans uses CY, M3, SY, LF, EA, LB, TON)

For now this script:
  • Has a `parse_ca_bid_summary(file_path)` stub
  • Has a `main()` that POSTs a small sample payload so the ingest flow can be
    exercised.

Env:
    ONYX_PORTAL_URL   — portal base URL
    ONYX_INGEST_TOKEN — bearer token for the ingest endpoint

Run:
    python scripts/fetch_dot_ca.py --sample
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime, timezone
from typing import Any

import requests

SAMPLE_BID_SUMMARY = {
    "source": "caltrans_bidsummary",
    "fetched_at": datetime.now(timezone.utc).isoformat(),
    "state_code": "CA",
    "contract_number": "04-1J7104",
    "district": "04",  # Bay Area
    "county": "Alameda",
    "items": [
        {
            "item_code": "19-100",
            "description": "Roadway Excavation",
            "csi_code": "31-23-16",
            "uom": "CY",
            "quantity": 32500.0,
            "low_bid_unit_price": 42.00,
            "avg_unit_price": 46.75,
            "bidder_count": 6,
        },
        {
            "item_code": "26-101",
            "description": "Class 2 Aggregate Base",
            "csi_code": "31-23-23",
            "uom": "CY",
            "quantity": 8200.0,
            "low_bid_unit_price": 68.50,
            "avg_unit_price": 72.10,
            "bidder_count": 6,
        },
        {
            "item_code": "39-401",
            "description": "Hot Mix Asphalt (Type A)",
            "csi_code": "32-12-16",
            "uom": "TON",
            "quantity": 4900.0,
            "low_bid_unit_price": 132.00,
            "avg_unit_price": 138.75,
            "bidder_count": 5,
        },
        {
            "item_code": "51-100",
            "description": "Structural Concrete, Bridge",
            "csi_code": "03-31-00",
            "uom": "CY",
            "quantity": 1850.0,
            "low_bid_unit_price": 1480.00,
            "avg_unit_price": 1525.00,
            "bidder_count": 4,
        },
    ],
}


def parse_ca_bid_summary(file_path: str) -> dict[str, Any]:
    """STUB — see module docstring."""
    raise NotImplementedError(
        "Caltrans bid-summary parsing is not implemented yet. "
        f"Would parse: {file_path}"
    )


def portal_url() -> str:
    return (os.environ.get("ONYX_PORTAL_URL") or "http://localhost:3000").rstrip("/")


def post_to_ingest(payload: dict[str, Any]) -> requests.Response:
    url = f"{portal_url()}/api/cost-catalog/ingest/dot"
    token = os.environ.get("ONYX_INGEST_TOKEN", "")
    return requests.post(
        url,
        json=payload,
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {token}",
        },
        timeout=30,
    )


def main() -> int:
    parser = argparse.ArgumentParser(description="Caltrans bid-summary ingest")
    parser.add_argument("--file", help="Bid-summary file to parse (NOT IMPLEMENTED)")
    parser.add_argument("--sample", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    if args.file:
        payload = parse_ca_bid_summary(args.file)
    else:
        payload = SAMPLE_BID_SUMMARY

    if args.dry_run:
        print(json.dumps(payload, indent=2))
        return 0

    resp = post_to_ingest(payload)
    print(f"[caltrans] ingest -> {resp.status_code}: {resp.text[:300]}", file=sys.stderr)
    return 0 if resp.ok else 1


if __name__ == "__main__":
    sys.exit(main())
