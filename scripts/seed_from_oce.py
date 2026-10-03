"""
seed_from_oce.py — Seed the cost catalog from OpenConstructionERP (OCE).

OpenConstructionERP is an open-source ERP for construction with ~42 regional
cost catalogues. The relevant pieces for us are their seed JSON files for
material + labor unit costs (MIT-licensed).

Where to find their data:
  • Repo:   https://github.com/openconstructionerp/openconstructionerp
  • Data:   `/seed/cost_catalogues/*.json` (regional catalogues)
  • Docs:   https://openconstructionerp.org/docs/cost-database

Optional full import:
  • Set OCE_SEED_PATH to a JSON file of OCE catalogue rows
    (array of objects with csi_code/trade/description/uom/costs, or
     { "items": [...] }). When present, those rows are mapped → CSI and
     merged with the embedded 50-item US seed (deduped by csi+description).
  • Map OCE's internal codes → CSI MasterFormat (best-effort via csi_code)
  • Skip duplicates already present from BLS/DOT sources at ingest time

Without OCE_SEED_PATH this script POSTs the embedded 50-item sample spanning
Divisions 03–06, 09, 22, 23, and 26.

Env:
    ONYX_PORTAL_URL   — portal base URL
    ONYX_INGEST_TOKEN — bearer token for the ingest endpoint

Run:
    python scripts/seed_from_oce.py
    python scripts/seed_from_oce.py --dry-run
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime, timezone
from typing import Any

import requests


def _item(csi: str, trade: str, desc: str, uom: str,
          base: float, labor: float, mat: float, equip: float) -> dict[str, Any]:
    return {
        "csi_code": csi,
        "trade": trade,
        "description": desc,
        "uom": uom,
        "region": "US_EAST",
        "base_unit_cost": base,
        "labor_cost": labor,
        "material_cost": mat,
        "equipment_cost": equip,
        "source_database": "oce_seed",
    }


SEED_ITEMS: list[dict[str, Any]] = [
    # Division 03 — Concrete
    _item("03-30-00", "Concrete", "Concrete, cast-in-place, 3000 PSI", "CY", 325.0, 150.0, 140.0, 35.0),
    _item("03-30-53", "Concrete", "Concrete, cast-in-place, 4000 PSI", "CY", 355.0, 160.0, 155.0, 40.0),
    _item("03-31-00", "Concrete", "Structural concrete, columns/beams", "CY", 580.0, 280.0, 240.0, 60.0),
    _item("03-21-00", "Concrete", "Reinforcement steel, #4 rebar", "LB", 1.25, 0.55, 0.65, 0.05),
    _item("03-15-00", "Concrete", "Formwork, slab on grade", "SF", 4.20, 2.40, 1.50, 0.30),
    _item("03-35-00", "Concrete", "Concrete finishing, troweled", "SF", 1.85, 1.20, 0.55, 0.10),
    # Division 04 — Masonry
    _item("04-21-13", "Masonry", "Brick veneer, modular", "SF", 18.50, 9.50, 8.20, 0.80),
    _item("04-22-00", "Masonry", "CMU, 8\" hollow", "SF", 12.40, 6.80, 5.20, 0.40),
    _item("04-22-23", "Masonry", "CMU, 12\" hollow", "SF", 16.20, 8.40, 7.20, 0.60),
    _item("04-05-13", "Masonry", "Mortar, Type S", "CF", 8.50, 0.0, 8.50, 0.0),
    # Division 05 — Metals
    _item("05-12-00", "Structural Steel", "Steel beam, W-section", "LB", 0.85, 0.35, 0.42, 0.08),
    _item("05-12-23", "Structural Steel", "Steel column, W-section", "LB", 0.92, 0.40, 0.44, 0.08),
    _item("05-21-00", "Steel Joists", "Open-web steel joists, K-series", "LB", 1.45, 0.50, 0.85, 0.10),
    _item("05-31-00", "Metal Decking", "Steel roof deck, 1.5\" 22ga", "SF", 4.80, 1.80, 2.70, 0.30),
    _item("05-50-00", "Metals", "Misc metal fabrications", "LB", 6.20, 3.40, 2.50, 0.30),
    _item("05-52-00", "Metals", "Metal railings, steel pipe", "LF", 78.0, 38.0, 35.0, 5.0),
    # Division 06 — Wood
    _item("06-11-00", "Carpentry", "Wood framing, 2x4 SPF", "BF", 1.85, 0.85, 0.95, 0.05),
    _item("06-11-13", "Carpentry", "Wood framing, 2x6 SPF", "BF", 2.05, 0.90, 1.10, 0.05),
    _item("06-16-00", "Carpentry", "Plywood sheathing, 1/2\" CDX", "SF", 1.95, 0.80, 1.10, 0.05),
    _item("06-17-00", "Carpentry", "Engineered wood I-joist", "LF", 5.20, 1.80, 3.30, 0.10),
    _item("06-20-00", "Finish Carpentry", "Trim, painted MDF", "LF", 4.20, 2.80, 1.30, 0.10),
    _item("06-41-00", "Millwork", "Custom cabinetry, base", "LF", 320.0, 140.0, 170.0, 10.0),
    # Division 09 — Finishes
    _item("09-21-00", "Drywall", "Drywall, 5/8\" Type X", "SF", 2.50, 1.10, 1.15, 0.25),
    _item("09-21-16", "Drywall", "Drywall, 1/2\" regular", "SF", 2.20, 1.00, 1.05, 0.15),
    _item("09-29-00", "Drywall", "Drywall finishing, Level 4", "SF", 1.40, 1.05, 0.30, 0.05),
    _item("09-51-00", "Acoustic", "Acoustic ceiling tile, 2x2", "SF", 5.80, 2.40, 3.20, 0.20),
    _item("09-65-00", "Resilient Flooring", "Vinyl plank, LVT", "SF", 8.50, 3.20, 5.10, 0.20),
    _item("09-68-00", "Carpet", "Carpet tile, commercial", "SY", 38.0, 12.0, 25.0, 1.0),
    _item("09-91-00", "Painting", "Interior paint, 2 coats", "SF", 1.45, 1.05, 0.35, 0.05),
    _item("09-30-00", "Tile", "Ceramic tile, floor", "SF", 14.50, 8.50, 5.50, 0.50),
    # Division 22 — Plumbing
    _item("22-11-00", "Plumbing", "Copper pipe, 1/2\" Type L", "LF", 8.20, 4.50, 3.50, 0.20),
    _item("22-11-23", "Plumbing", "PEX pipe, 3/4\"", "LF", 4.80, 2.80, 1.90, 0.10),
    _item("22-13-00", "Plumbing", "DWV pipe, 4\" PVC", "LF", 12.50, 6.00, 6.20, 0.30),
    _item("22-40-00", "Plumbing", "Water closet, vitreous china", "EA", 580.0, 280.0, 290.0, 10.0),
    _item("22-42-00", "Plumbing", "Lavatory, wall-hung", "EA", 420.0, 180.0, 230.0, 10.0),
    _item("22-33-00", "Plumbing", "Water heater, 50gal electric", "EA", 1850.0, 450.0, 1380.0, 20.0),
    # Division 23 — HVAC
    _item("23-31-13", "HVAC", "Sheet metal duct, galvanized", "LB", 12.40, 6.50, 5.50, 0.40),
    _item("23-37-00", "HVAC", "Diffuser, ceiling supply", "EA", 145.0, 65.0, 75.0, 5.0),
    _item("23-74-00", "HVAC", "RTU, 5-ton packaged", "EA", 9800.0, 1800.0, 7500.0, 500.0),
    _item("23-09-00", "HVAC", "DDC controls, per zone", "EA", 1200.0, 600.0, 580.0, 20.0),
    _item("23-21-13", "HVAC", "Hydronic pipe, 1\" copper", "LF", 18.50, 9.50, 8.50, 0.50),
    _item("23-82-00", "HVAC", "VAV box w/ reheat", "EA", 1850.0, 550.0, 1250.0, 50.0),
    # Division 26 — Electrical
    _item("26-05-19", "Electrical", "THHN wire, #12 AWG copper", "LF", 0.42, 0.20, 0.20, 0.02),
    _item("26-05-33", "Electrical", "EMT conduit, 1/2\"", "LF", 4.20, 2.10, 1.80, 0.30),
    _item("26-05-33", "Electrical", "EMT conduit, 3/4\"", "LF", 5.10, 2.40, 2.40, 0.30),
    _item("26-24-16", "Electrical", "Panelboard, 200A 42-circuit", "EA", 3800.0, 1100.0, 2600.0, 100.0),
    _item("26-27-26", "Electrical", "Wiring device, duplex receptacle", "EA", 38.0, 22.0, 15.0, 1.0),
    _item("26-27-26", "Electrical", "Wiring device, switch single-pole", "EA", 32.0, 20.0, 11.0, 1.0),
    _item("26-51-00", "Electrical", "LED troffer, 2x4 flat panel", "EA", 185.0, 60.0, 120.0, 5.0),
    _item("26-56-00", "Electrical", "Exterior LED wall pack", "EA", 320.0, 110.0, 200.0, 10.0),
    _item("26-09-23", "Electrical", "Occupancy sensor, ceiling mount", "EA", 145.0, 75.0, 65.0, 5.0),
]

assert len(SEED_ITEMS) == 50, f"expected 50 seed items, got {len(SEED_ITEMS)}"


def portal_url() -> str:
    return (os.environ.get("ONYX_PORTAL_URL") or "http://localhost:3000").rstrip("/")


def _normalize_oce_row(raw: dict[str, Any]) -> dict[str, Any] | None:
    csi = str(raw.get("csi_code") or raw.get("code") or raw.get("masterformat") or "").strip()
    desc = str(raw.get("description") or raw.get("name") or "").strip()
    if not csi or not desc:
        return None
    uom = str(raw.get("uom") or raw.get("unit") or "EA").strip() or "EA"
    trade = str(raw.get("trade") or raw.get("category") or "General").strip() or "General"
    base = float(raw.get("base_unit_cost") or raw.get("unit_cost") or raw.get("price") or 0)
    labor = float(raw.get("labor_cost") or raw.get("labor") or 0)
    mat = float(raw.get("material_cost") or raw.get("material") or 0)
    equip = float(raw.get("equipment_cost") or raw.get("equipment") or 0)
    return {
        "csi_code": csi,
        "trade": trade,
        "description": desc,
        "uom": uom,
        "region": str(raw.get("region") or "US_EAST"),
        "base_unit_cost": base,
        "labor_cost": labor,
        "material_cost": mat,
        "equipment_cost": equip,
        "source_database": "oce_seed",
    }


def load_external_oce_items(path: str) -> list[dict[str, Any]]:
    with open(path, encoding="utf-8") as fh:
        data = json.load(fh)
    rows = data["items"] if isinstance(data, dict) and isinstance(data.get("items"), list) else data
    if not isinstance(rows, list):
        raise ValueError("OCE seed file must be a JSON array or {items:[...]}")
    out: list[dict[str, Any]] = []
    for raw in rows:
        if not isinstance(raw, dict):
            continue
        item = _normalize_oce_row(raw)
        if item:
            out.append(item)
    return out


def merge_items(base: list[dict[str, Any]], extra: list[dict[str, Any]]) -> list[dict[str, Any]]:
    seen: set[str] = set()
    merged: list[dict[str, Any]] = []
    for item in [*base, *extra]:
        key = f"{item['csi_code']}|{item['description']}".lower()
        if key in seen:
            continue
        seen.add(key)
        merged.append(item)
    return merged


def post_to_ingest(payload: dict[str, Any]) -> requests.Response:
    url = f"{portal_url()}/api/cost-catalog/ingest/seed"
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
    parser = argparse.ArgumentParser(description="Seed cost catalog with OpenConstructionERP sample")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument(
        "--oce-path",
        default=os.environ.get("OCE_SEED_PATH", ""),
        help="Optional path to full OCE catalogue JSON (or set OCE_SEED_PATH)",
    )
    args = parser.parse_args()

    items = list(SEED_ITEMS)
    if args.oce_path:
        external = load_external_oce_items(args.oce_path)
        items = merge_items(items, external)
        print(f"[oce] loaded {len(external)} external rows → {len(items)} after merge", file=sys.stderr)

    payload = {
        "source": "openconstructionerp_seed",
        "fetched_at": datetime.now(timezone.utc).isoformat(),
        "items": items,
    }

    if args.dry_run:
        print(json.dumps(payload, indent=2))
        return 0

    resp = post_to_ingest(payload)
    print(f"[oce] ingest -> {resp.status_code}: {resp.text[:300]}", file=sys.stderr)
    return 0 if resp.ok else 1


if __name__ == "__main__":
    sys.exit(main())
