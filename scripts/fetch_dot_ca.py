"""
fetch_dot_ca.py — Caltrans bid-summary / contract-cost-data fetcher.

Parses a Caltrans item-cost CSV or a bid-summary PDF table into the portal
ingest shape `{ state, rows: [{ csi_code, unit_cost, uom, observed_at, ... }] }`.
Labor/material/equipment are copied only when those columns exist.

Item-code prefixes mapped to CSI when the file has no CSI column:
  19 → 31-23-16, 26 → 31-23-23, 39 → 32-12-16, 51 → 03-31-00.
Rows that still have no CSI are skipped.

Env:
    ONYX_PORTAL_URL   — portal base URL (default http://localhost:3000)
    ONYX_INGEST_TOKEN — bearer token for the ingest endpoint

Run:
    python scripts/fetch_dot_ca.py --sample
    python scripts/fetch_dot_ca.py --sample --dry-run
    python scripts/fetch_dot_ca.py --file path/to/bid_summary.csv --dry-run
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

def _load_item_to_csi(state: str) -> dict[str, str]:
    """Load scripts/dot_item_to_csi.csv for state, falling back to built-ins."""
    fallback = {
        "19": "31-23-16",
        "26": "31-23-23",
        "39": "32-12-16",
        "51": "03-31-00",
    }
    csv_path = Path(__file__).resolve().parent / "dot_item_to_csi.csv"
    if not csv_path.is_file():
        return fallback
    mapping = dict(fallback)
    with csv_path.open(newline="", encoding="utf-8") as handle:
        for row in csv.DictReader(handle):
            if (row.get("state") or "").strip().upper() != state:
                continue
            prefix = (row.get("item_prefix") or "").strip()
            csi = (row.get("csi_code") or "").strip()
            if prefix and csi:
                # Prefer short Caltrans division prefixes when CSV has long codes.
                key = prefix[:2] if len(prefix) > 3 and prefix[:2] in fallback else prefix
                mapping[key] = csi
                mapping[prefix] = csi
    return mapping


CALTRANS_ITEM_TO_CSI = _load_item_to_csi("CA")

SAMPLE_BID_SUMMARY = {
    "source": "caltrans_bidsummary",
    "fetched_at": datetime.now(timezone.utc).isoformat(),
    "state_code": "CA",
    "contract_number": "04-1J7104",
    "district": "04",
    "county": "Alameda",
    "letting_date": "2026-04-10",
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
    # Caltrans codes look like "19-100" — use the leading segment.
    prefix = item_code.split("-", 1)[0].strip()
    return CALTRANS_ITEM_TO_CSI.get(prefix)


def row_from_record(record: dict[str, str], observed_at: str) -> dict[str, Any] | None:
    item_code = _cell(record, "item_code", "item", "item_no")
    csi = csi_for_item(item_code, _cell(record, "csi_code", "csi"))
    if not csi:
        return None
    unit_cost = _float_or_none(
        _cell(record, "avg_unit_price", "unit_price", "low_bid_unit_price", "average_price")
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
    return {"state": "CA", "rows": rows}


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
        raise RuntimeError("pdfplumber is required to parse a Caltrans PDF bid summary") from exc

    tables: list[list[list[Any]]] = []
    with pdfplumber.open(file_path) as pdf:
        for page in pdf.pages:
            for table in page.extract_tables() or []:
                if table and len(table) >= 2:
                    tables.append(table)
    if not tables:
        raise ValueError(
            f"No bid-summary table found in {file_path}. "
            "Export Contract Cost Data as CSV or supply a PDF with a headered table."
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


def parse_ca_bid_summary(file_path: str) -> dict[str, Any]:
    """Parse a Caltrans CSV or PDF bid summary into the DOT ingest body."""
    path = Path(file_path)
    if not path.is_file():
        raise FileNotFoundError(file_path)
    suffix = path.suffix.lower()
    if suffix == ".csv":
        records = _records_from_csv(file_path)
    elif suffix == ".pdf":
        records = _records_from_pdf(file_path)
    else:
        raise ValueError(f"Unsupported bid-summary type {suffix or '(none)'}. Use .csv or .pdf.")
    return records_to_ingest(records)


def sample_ingest_payload(sample: dict[str, Any] | None = None) -> dict[str, Any]:
    source = sample or SAMPLE_BID_SUMMARY
    observed = str(source.get("letting_date") or datetime.now(timezone.utc).date().isoformat())
    if "T" not in observed:
        observed = f"{observed}T00:00:00+00:00"
    items = source.get("items") or []
    records = [{str(k): "" if v is None else str(v) for k, v in item.items()} for item in items]
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
    parser = argparse.ArgumentParser(description="Caltrans bid-summary ingest")
    parser.add_argument("--file", help="Bid-summary CSV or PDF to parse")
    parser.add_argument("--sample", action="store_true",
                        help="POST the embedded sample in ingest shape")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    if args.file:
        payload = parse_ca_bid_summary(args.file)
    else:
        payload = sample_ingest_payload()

    if args.dry_run:
        print(json.dumps(payload, indent=2))
        return 0

    resp = post_to_ingest(payload)
    print(f"[caltrans] ingest -> {resp.status_code}: {resp.text[:300]}", file=sys.stderr)
    return 0 if resp.ok else 1


if __name__ == "__main__":
    sys.exit(main())
