"""
fetch_dot_tx.py — TxDOT bid-tabulation fetcher.

Parses a TxDOT item-bid CSV or a bid-tab PDF table into the portal ingest
shape `{ state, rows: [{ csi_code, unit_cost, uom, observed_at, ... }] }`.
Labor, material, and equipment are copied only when those columns exist.
A unit price alone is never split.

Item-code prefixes mapped to CSI when the file has no CSI column:
  247 → 31-23-23, 340 → 32-12-16, 432 → 31-37-00, 464 → 33-41-00.
Rows that still have no CSI are skipped.

Env:
    ONYX_PORTAL_URL   — portal base URL (default http://localhost:3000)
    ONYX_INGEST_TOKEN — bearer token for the ingest endpoint

Run:
    python scripts/fetch_dot_tx.py --sample
    python scripts/fetch_dot_tx.py --sample --dry-run
    python scripts/fetch_dot_tx.py --file path/to/bid_tab.csv --dry-run
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import requests

TXDOT_ITEM_TO_CSI = {
    "247": "31-23-23",
    "340": "32-12-16",
    "432": "31-37-00",
    "464": "33-41-00",
}

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


def _norm_header(value: str) -> str:
    return value.strip().lower().replace(" ", "_")


def _cell(record: dict[str, str], *names: str) -> str:
    for name in names:
        value = record.get(name, "")
        if value is not None and str(value).strip():
            return str(value).strip()
    return ""


def _float_or_none(value: str) -> float | None:
    cleaned = value.replace(",", "").replace("$", "").strip()
    if not cleaned:
        return None
    try:
        return float(cleaned)
    except ValueError:
        return None


def csi_for_item(item_code: str, explicit_csi: str) -> str | None:
    csi = explicit_csi.strip()
    if csi:
        return csi
    prefix = item_code.split("-", 1)[0].strip()
    return TXDOT_ITEM_TO_CSI.get(prefix)


def row_from_record(record: dict[str, str], observed_at: str) -> dict[str, Any] | None:
    item_code = _cell(record, "item_code", "item")
    csi = csi_for_item(item_code, _cell(record, "csi_code", "csi"))
    if not csi:
        return None
    unit_cost = _float_or_none(
        _cell(record, "avg_unit_price", "unit_price", "low_bid_unit_price")
    )
    if unit_cost is None:
        return None
    row: dict[str, Any] = {
        "csi_code": csi,
        "description": _cell(record, "description") or csi,
        "unit_cost": unit_cost,
        "uom": _cell(record, "unit", "uom") or None,
        "observed_at": observed_at,
    }
    for source, dest in (
        ("labor_cost", "labor_cost"),
        ("material_cost", "material_cost"),
        ("equipment_cost", "equipment_cost"),
    ):
        if source in record and str(record.get(source, "")).strip():
            parsed = _float_or_none(str(record[source]))
            if parsed is not None:
                row[dest] = parsed
    return row


def records_to_ingest(records: list[dict[str, str]], observed_at: str | None = None) -> dict[str, Any]:
    stamp = observed_at or datetime.now(timezone.utc).isoformat()
    rows = []
    for record in records:
        normalized = {_norm_header(k): ("" if v is None else str(v)) for k, v in record.items()}
        row = row_from_record(normalized, stamp)
        if row:
            rows.append(row)
    return {"state": "TX", "rows": rows}


def _records_from_csv(file_path: str) -> list[dict[str, str]]:
    with open(file_path, newline="", encoding="utf-8-sig") as handle:
        reader = csv.DictReader(handle)
        if not reader.fieldnames:
            raise ValueError(f"CSV has no header row: {file_path}")
        return [dict(row) for row in reader]


def _records_from_pdf(file_path: str) -> list[dict[str, str]]:
    try:
        import pdfplumber
    except ImportError as exc:
        raise RuntimeError("pdfplumber is required to parse a TxDOT PDF bid tab") from exc

    tables: list[list[list[Any]]] = []
    with pdfplumber.open(file_path) as pdf:
        for page in pdf.pages:
            for table in page.extract_tables() or []:
                if table and len(table) >= 2:
                    tables.append(table)
    if not tables:
        raise ValueError(
            f"No bid-tab table found in {file_path}. "
            "Export the letting as CSV or supply a PDF whose first table has a header row."
        )
    records: list[dict[str, str]] = []
    for table in tables:
        headers = [_norm_header(str(cell or f"col_{i}")) for i, cell in enumerate(table[0])]
        for raw in table[1:]:
            record = {
                headers[i]: "" if i >= len(raw) or raw[i] is None else str(raw[i])
                for i in range(len(headers))
            }
            records.append(record)
    return records


def parse_tx_bid_tab(file_path: str) -> dict[str, Any]:
    """Parse a TxDOT CSV or PDF bid tab into the DOT ingest body."""
    path = Path(file_path)
    if not path.is_file():
        raise FileNotFoundError(file_path)
    suffix = path.suffix.lower()
    if suffix == ".csv":
        records = _records_from_csv(file_path)
    elif suffix == ".pdf":
        records = _records_from_pdf(file_path)
    else:
        raise ValueError(f"Unsupported bid-tab type {suffix or '(none)'}. Use .csv or .pdf.")
    return records_to_ingest(records)


def sample_ingest_payload(sample: dict[str, Any] | None = None) -> dict[str, Any]:
    source = sample or SAMPLE_BID_TAB
    observed = str(source.get("letting_date") or datetime.now(timezone.utc).date().isoformat())
    if "T" not in observed:
        observed = f"{observed}T00:00:00+00:00"
    items = source.get("items") or []
    records = []
    for item in items:
        record = {str(k): "" if v is None else str(v) for k, v in item.items()}
        records.append(record)
    return records_to_ingest(records, observed_at=observed)


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
    parser.add_argument("--file", help="Bid-tab CSV or PDF to parse")
    parser.add_argument("--sample", action="store_true",
                        help="POST the embedded sample in ingest shape")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    if args.file:
        payload = parse_tx_bid_tab(args.file)
    else:
        payload = sample_ingest_payload()

    if args.dry_run:
        print(json.dumps(payload, indent=2))
        return 0

    resp = post_to_ingest(payload)
    print(f"[txdot] ingest -> {resp.status_code}: {resp.text[:300]}", file=sys.stderr)
    return 0 if resp.ok else 1


if __name__ == "__main__":
    sys.exit(main())
