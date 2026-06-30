"""
fetch_dot_tx.py — TxDOT bid-tabulation fetcher (skeleton).

TxDOT (Texas Department of Transportation) publishes bid tabulations for every
state highway construction letting. Each "bid tab" is a PDF/CSV that lists the
items bid by every contractor on a project, by item code + quantity + unit
price. This is gold for cost calibration because it's:

  1. Public domain (no licensing fee).
  2. Item-level (down to a specific TxDOT item code, e.g. 247-203 "Flexible
     Base Type A Grade 1") with quantities and per-unit prices.
  3. Tied to a specific county / district, so we get geographic granularity.

Where to find the data:
  • Bid tab archive:  https://www.txdot.gov/business/let-bids/bid-tab-archive.html
  • Item-bid history: https://apps.dot.state.tx.us/apps/bidhist/avgprice.htm
                     (provides per-item statewide averages by quarter)
  • Project archive:  https://www.txdot.gov/business/let-bids.html

TODO (data-engineering follow-up):
  • Parse the published CSV index, walk each project's bid tab PDF/XLS
  • Map TxDOT item codes → CSI MasterFormat divisions (lookup table needed)
  • Normalize quantities (TxDOT mixes EA, CY, SY, LB, TON, LF, …)
  • Compute weighted average unit price per item per quarter per district

For now this script:
  • Has a `parse_tx_bid_tab(file_path)` stub
  • Has a `main()` that POSTs a small sample payload so the ingest flow on the
    portal can be developed and tested end-to-end.

Env:
    ONYX_PORTAL_URL   — portal base URL (default http://localhost:3000)
    ONYX_INGEST_TOKEN — bearer token for the ingest endpoint

Run:
    python scripts/fetch_dot_tx.py --sample
    python scripts/fetch_dot_tx.py --file path/to/bid_tab.pdf  # TODO
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime, timezone
from typing import Any

import requests

SAMPLE_BID_TAB = {
    "source": "txdot_bidtab",
    "fetched_at": datetime.now(timezone.utc).isoformat(),
    "state_code": "TX",
    "letting_date": "2026-05-21",
    "district": "Austin",
    "county": "Travis",
    "items": [
        {
            "item_code": "247-203",
            "description": "Flexible Base, Type A, Grade 1",
            "csi_code": "31-23-23",
            "uom": "CY",
            "quantity": 12500.0,
            "low_bid_unit_price": 38.50,
            "avg_unit_price": 41.20,
            "bidder_count": 4,
        },
        {
            "item_code": "340-1064",
            "description": "Hot Mix Asphalt, Type D, PG 64-22",
            "csi_code": "32-12-16",
            "uom": "TON",
            "quantity": 8400.0,
            "low_bid_unit_price": 94.75,
            "avg_unit_price": 98.10,
            "bidder_count": 5,
        },
        {
            "item_code": "432-001",
            "description": "Riprap (Stone Protection)",
            "csi_code": "31-37-00",
            "uom": "CY",
            "quantity": 320.0,
            "low_bid_unit_price": 128.00,
            "avg_unit_price": 134.50,
            "bidder_count": 3,
        },
        {
            "item_code": "464-006",
            "description": "Reinforced Concrete Pipe, 24-inch",
            "csi_code": "33-41-00",
            "uom": "LF",
            "quantity": 1840.0,
            "low_bid_unit_price": 78.00,
            "avg_unit_price": 82.40,
            "bidder_count": 4,
        },
    ],
}


def parse_tx_bid_tab(file_path: str) -> dict[str, Any]:
    """STUB — to be implemented.

    Real implementation will need to:
      • Detect file type (CSV from item-bid history vs. PDF bid tab)
      • For PDFs: pdfplumber / camelot to lift the bid-tab table
      • Map TxDOT item codes to CSI MasterFormat divisions
      • Compute statistics across bidders per item
    """
    raise NotImplementedError(
        "TxDOT bid-tab PDF parsing is not implemented yet. "
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
    parser = argparse.ArgumentParser(description="TxDOT bid-tab ingest")
    parser.add_argument("--file", help="Bid-tab file to parse (NOT IMPLEMENTED)")
    parser.add_argument("--sample", action="store_true",
                        help="POST embedded sample payload for end-to-end testing")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    if args.file:
        payload = parse_tx_bid_tab(args.file)
    else:
        payload = SAMPLE_BID_TAB

    if args.dry_run:
        print(json.dumps(payload, indent=2))
        return 0

    resp = post_to_ingest(payload)
    print(f"[txdot] ingest -> {resp.status_code}: {resp.text[:300]}", file=sys.stderr)
    return 0 if resp.ok else 1


if __name__ == "__main__":
    sys.exit(main())
