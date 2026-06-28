"""
Onyx Intel — Deterministic Takeoff Extractor
=============================================

Build-once, run-free-forever extraction of CSI-coded takeoff line items from
construction source files. No AI, no per-document cost — pure deterministic
parsing of the structured data that already lives inside the file.

Supported inputs
----------------
  .pdf            Schedule / spec tables via pdfplumber.extract_tables()
  .dxf / .dwg*    Real geometry via ezdxf — exact lengths, areas, block counts
  .ifc            BIM base quantities via ifcopenshell (optional dependency)
  .xlsx / .xls    Tabular estimate/BOM data via openpyxl

  (* DWG is parsed only if it is actually DXF-encoded or an ODA converter is
     present; otherwise the caller is told to export DXF. True binary DWG needs
     a specialized converter we do not bundle.)

Every extractor returns a list of ``TakeoffRow`` dicts shaped to match the
portal's SecureTakeoffRow contract:

    {
      "trade":          str,
      "cost_code":      "NN-NN-NN",   # CSI MasterFormat
      "description":    str,
      "quantity_basis": str,          # how the number was derived (auditable)
      "total_qty":      float,
      "uom":            str,
      "drawing_ref":    str | None,
      "location_tag":   str | None,
    }

The dispatcher also reports *coverage*: which pages/entities produced rows and,
for PDFs, which pages had no machine-readable tables (``ai_candidate_pages``) so
the portal can optionally fall back to the AI vision path for those pages only.
"""

from __future__ import annotations

import logging
import re
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

# ─────────────────────────────────────────────────────────────────────────────
# CSI MasterFormat keyword map
# ─────────────────────────────────────────────────────────────────────────────
# Each entry: (regex over a lowercased description) -> (division, full cost_code, trade, default_uom)
# Ordered most-specific first; first match wins. Codes follow "NN-NN-NN".

CSI_RULES: list[tuple[re.Pattern[str], str, str, str, str]] = [
    # ── Division 03 — Concrete ──
    (re.compile(r"\b(rebar|reinforc|#\d\s*bar|dowel)\b"),          "03", "03-20-00", "Concrete", "LB"),
    (re.compile(r"\b(slab|footing|foundation|grade beam|pier cap)\b"), "03", "03-30-00", "Concrete", "CY"),
    (re.compile(r"\b(concrete|cast.?in.?place|c\.?i\.?p\.?)\b"),   "03", "03-30-00", "Concrete", "CY"),
    # ── Division 04 — Masonry ──
    (re.compile(r"\b(cmu|concrete block|brick|masonry|mortar)\b"), "04", "04-20-00", "Masonry", "SF"),
    # ── Division 05 — Metals ──
    (re.compile(r"\b(steel beam|w\d+x\d+|wide flange|hss|structural steel|joist|girder)\b"), "05", "05-12-00", "Structural Steel", "LB"),
    (re.compile(r"\b(metal deck|decking|stud|metal framing)\b"),   "05", "05-40-00", "Metals", "SF"),
    # ── Division 06 — Wood ──
    (re.compile(r"\b(lumber|framing|plywood|sheathing|2x\d+|joist)\b"), "06", "06-10-00", "Carpentry", "LF"),
    # ── Division 07 — Thermal / Moisture ──
    (re.compile(r"\b(insulation|batt|rigid board|vapor barrier)\b"), "07", "07-21-00", "Insulation", "SF"),
    (re.compile(r"\b(roofing|membrane|tpo|epdm|built.?up|shingle)\b"), "07", "07-50-00", "Roofing", "SF"),
    # ── Division 08 — Openings ──
    (re.compile(r"\b(door|frame|hardware set|hm door|hollow metal)\b"), "08", "08-11-00", "Doors", "EA"),
    (re.compile(r"\b(window|glazing|storefront|curtain wall)\b"),  "08", "08-40-00", "Glazing", "SF"),
    # ── Division 09 — Finishes ──
    (re.compile(r"\b(drywall|gypsum|gwb|partition)\b"),            "09", "09-21-00", "Drywall", "SF"),
    (re.compile(r"\b(acoustical|act|ceiling tile|ceiling grid)\b"), "09", "09-51-00", "Ceilings", "SF"),
    (re.compile(r"\b(paint|coating|primer)\b"),                    "09", "09-91-00", "Painting", "SF"),
    (re.compile(r"\b(flooring|tile|carpet|vct|resilient|epoxy floor)\b"), "09", "09-65-00", "Flooring", "SF"),
    # ── Division 21 — Fire Suppression ──
    (re.compile(r"\b(sprinkler|fire suppression|standpipe|fire pump)\b"), "21", "21-13-00", "Fire Protection", "EA"),
    # ── Division 22 — Plumbing ──
    (re.compile(r"\b(water closet|wc\b|urinal|lavatory|sink|drinking fountain|fixture)\b"), "22", "22-40-00", "Plumbing", "EA"),
    (re.compile(r"\b(cpvc|pex|copper pipe|cast iron pipe|domestic water|sanitary|vent pipe|storm pipe|pvc pipe)\b"), "22", "22-11-00", "Plumbing", "LF"),
    (re.compile(r"\b(valve|backflow|water heater|pump)\b"),        "22", "22-11-00", "Plumbing", "EA"),
    # ── Division 23 — HVAC ──
    (re.compile(r"\b(ductwork|duct\b|spiral duct|rectangular duct)\b"), "23", "23-31-00", "HVAC", "LB"),
    (re.compile(r"\b(vav|ahu|rtu\b|fan coil|fcu|air handler|rooftop unit|chiller|boiler|condens(er|ing)|furnace|heat pump)\b"), "23", "23-70-00", "HVAC", "EA"),
    (re.compile(r"\b(diffuser|grille|register|louver)\b"),         "23", "23-37-00", "HVAC", "EA"),
    (re.compile(r"\b(refrigerant|hydronic|chilled water|hot water pipe)\b"), "23", "23-21-00", "HVAC", "LF"),
    # ── Division 26 — Electrical ──
    (re.compile(r"\b(conduit|emt\b|rmc\b|raceway|cable tray)\b"),  "26", "26-05-33", "Electrical", "LF"),
    (re.compile(r"\b(wire|conductor|thhn|feeder|branch circuit|mc cable)\b"), "26", "26-05-19", "Electrical", "LF"),
    (re.compile(r"\b(panel|panelboard|switchboard|switchgear|transformer|disconnect)\b"), "26", "26-24-00", "Electrical", "EA"),
    (re.compile(r"\b(receptacle|outlet|switch\b|junction box|device)\b"), "26", "26-27-26", "Electrical", "EA"),
    (re.compile(r"\b(luminaire|light fixture|lighting|fixture type [a-z]|downlight|troffer)\b"), "26", "26-51-00", "Lighting", "EA"),
    # ── Division 27 — Comms ──
    (re.compile(r"\b(data drop|cat\s?6|cat6a|fiber|patch panel|telecom)\b"), "27", "27-10-00", "Communications", "EA"),
    # ── Division 28 — Electronic Safety ──
    (re.compile(r"\b(fire alarm|smoke detector|pull station|notification|nac\b)\b"), "28", "28-31-00", "Fire Alarm", "EA"),
    # ── Division 31 — Earthwork ──
    (re.compile(r"\b(excavat|grading|cut and fill|backfill|fill\b|earthwork)\b"), "31", "31-23-00", "Earthwork", "CY"),
    # ── Division 32 — Exterior Improvements ──
    (re.compile(r"\b(asphalt|paving|sidewalk|curb|landscape|fencing)\b"), "32", "32-10-00", "Sitework", "SF"),
    # ── Division 33 — Utilities ──
    (re.compile(r"\b(manhole|catch basin|storm drain|sewer main|water main|utility)\b"), "33", "33-10-00", "Utilities", "LF"),
]

# UOM normalization — map free-text units to canonical takeoff UOMs.
UOM_MAP: dict[str, str] = {
    "ea": "EA", "each": "EA", "no": "EA", "no.": "EA", "qty": "EA", "pcs": "EA", "pc": "EA",
    "lf": "LF", "l.f.": "LF", "ln ft": "LF", "lin ft": "LF", "feet": "LF", "ft": "LF", "'": "LF",
    "sf": "SF", "s.f.": "SF", "sq ft": "SF", "sqft": "SF", "ft2": "SF",
    "sy": "SY", "s.y.": "SY", "sq yd": "SY",
    "cy": "CY", "c.y.": "CY", "cu yd": "CY", "yd3": "CY",
    "lb": "LB", "lbs": "LB", "#": "LB", "ton": "TON", "tons": "TON",
    "gal": "GAL", "hr": "HR", "ls": "LS",
}

# Column-header synonyms for detecting quantity / description / unit columns in tables.
QTY_HEADERS  = re.compile(r"\b(qty|quantity|count|total|no\.?|amount)\b", re.I)
DESC_HEADERS = re.compile(r"\b(description|item|mark|tag|type|equipment|fixture|material)\b", re.I)
UNIT_HEADERS = re.compile(r"\b(unit|uom|u\.?o\.?m\.?|measure)\b", re.I)


# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────

def _classify(description: str) -> tuple[str, str, str, str]:
    """Map a free-text description to (division, cost_code, trade, default_uom)."""
    d = (description or "").lower()
    for pattern, division, code, trade, uom in CSI_RULES:
        if pattern.search(d):
            return division, code, trade, uom
    return "01", "01-00-00", "General", "EA"


def _norm_uom(raw: str | None, fallback: str) -> str:
    if not raw:
        return fallback
    key = str(raw).strip().lower()
    return UOM_MAP.get(key, raw.strip().upper()[:8] if raw.strip() else fallback)


_NUM = re.compile(r"-?\d[\d,]*\.?\d*")

def _to_float(raw: Any) -> float | None:
    """Parse a number out of a possibly-messy cell ('1,250 SF', '(3)', '12 ea')."""
    if raw is None:
        return None
    if isinstance(raw, (int, float)):
        return float(raw)
    m = _NUM.search(str(raw).replace("\n", " "))
    if not m:
        return None
    try:
        return float(m.group(0).replace(",", ""))
    except ValueError:
        return None


def _row(description: str, qty: float, basis: str,
         uom: str | None = None, drawing_ref: str | None = None,
         location_tag: str | None = None) -> dict:
    division, code, trade, default_uom = _classify(description)
    return {
        "trade":          trade,
        "cost_code":      code,
        "description":    description.strip()[:300],
        "quantity_basis": basis[:200],
        "total_qty":      round(float(qty), 3),
        "uom":            _norm_uom(uom, default_uom),
        "drawing_ref":    drawing_ref,
        "location_tag":   location_tag,
    }


# ─────────────────────────────────────────────────────────────────────────────
# PDF — schedule / spec table extraction (pdfplumber, already a dependency)
# ─────────────────────────────────────────────────────────────────────────────

def extract_from_pdf(path: str) -> dict:
    import pdfplumber

    rows: list[dict] = []
    ai_candidate_pages: list[int] = []
    pages_with_tables = 0

    # Drawing pages are dense with vector lines; pdfplumber's table finder can
    # explode (time + memory) on them and OOM the worker. Skip table detection on
    # graphical pages (route them to the AI vision path) and cap total work.
    MAX_TABLE_PAGES = 120          # hard backstop on pages we run table-detection over
    LINE_COMPLEXITY_LIMIT = 1200   # above this many vector objects, treat page as a drawing

    with pdfplumber.open(path) as pdf:
        page_count = len(pdf.pages)
        for idx, page in enumerate(pdf.pages, start=1):
            # Cheaply gauge how "drawing-like" the page is before the expensive call.
            try:
                complexity = len(page.lines) + len(page.curves) + len(page.rects)
            except Exception:
                complexity = 0

            if idx > MAX_TABLE_PAGES or complexity > LINE_COMPLEXITY_LIMIT:
                ai_candidate_pages.append(idx)  # graphical/over-cap → AI vision can read it
                continue

            try:
                tables = page.extract_tables() or []
            except Exception:
                tables = []
            page_made_rows = False

            for table in tables:
                if not table or len(table) < 2:
                    continue
                header = [(c or "").strip() for c in table[0]]
                # Locate description / qty / unit columns by header synonyms.
                desc_col = next((i for i, h in enumerate(header) if DESC_HEADERS.search(h)), 0)
                qty_col  = next((i for i, h in enumerate(header) if QTY_HEADERS.search(h)), None)
                unit_col = next((i for i, h in enumerate(header) if UNIT_HEADERS.search(h)), None)

                for raw in table[1:]:
                    if not raw or all((c is None or str(c).strip() == "") for c in raw):
                        continue
                    desc = (raw[desc_col] if desc_col < len(raw) else None) or ""
                    desc = str(desc).replace("\n", " ").strip()
                    if not desc or len(desc) < 2:
                        continue

                    qty = _to_float(raw[qty_col]) if (qty_col is not None and qty_col < len(raw)) else None
                    # A schedule line with no count still represents 1 of that item.
                    if qty is None:
                        qty = 1.0
                        basis = f"Schedule row, p.{idx} (count defaulted to 1 — no qty column)"
                    else:
                        basis = f"Schedule table, p.{idx}, col '{header[qty_col] or 'qty'}'"

                    unit = raw[unit_col] if (unit_col is not None and unit_col < len(raw)) else None
                    rows.append(_row(desc, qty, basis, uom=str(unit) if unit else None,
                                     drawing_ref=f"PDF p.{idx}"))
                    page_made_rows = True

            if page_made_rows:
                pages_with_tables += 1
            else:
                # No machine-readable table — this page is a drawing; AI vision can read it.
                ai_candidate_pages.append(idx)

    return {
        "source_type": "pdf",
        "rows": rows,
        "coverage": {
            "page_count": page_count,
            "pages_with_tables": pages_with_tables,
            "rows_extracted": len(rows),
        },
        "ai_candidate_pages": ai_candidate_pages,
    }


# ─────────────────────────────────────────────────────────────────────────────
# DXF / DWG — real geometry (ezdxf)
# ─────────────────────────────────────────────────────────────────────────────

def extract_from_dxf(path: str) -> dict:
    import ezdxf
    from ezdxf.math import Vec3

    try:
        doc = ezdxf.readfile(path)
    except (ezdxf.DXFStructureError, IOError) as e:
        # Binary DWG is not DXF — ezdxf can't read it without conversion.
        raise ValueError(
            f"Could not read as DXF ({e}). For binary .dwg, export to DXF "
            f"from your CAD tool (Save As → AutoCAD DXF) and re-upload."
        )

    msp = doc.modelspace()

    # Aggregate by layer: total polyline/line length, hatch area, block-insert counts.
    layer_len: dict[str, float] = {}
    layer_area: dict[str, float] = {}
    block_counts: dict[tuple[str, str], int] = {}  # (layer, block_name) -> count

    def _polyline_length(points: list) -> float:
        total = 0.0
        for a, b in zip(points, points[1:]):
            total += (Vec3(b) - Vec3(a)).magnitude
        return total

    for e in msp:
        layer = getattr(e.dxf, "layer", "0")
        etype = e.dxftype()
        try:
            if etype == "LINE":
                layer_len[layer] = layer_len.get(layer, 0.0) + (Vec3(e.dxf.end) - Vec3(e.dxf.start)).magnitude
            elif etype in ("LWPOLYLINE", "POLYLINE"):
                pts = [p[:3] if len(p) >= 3 else (p[0], p[1], 0.0) for p in e.get_points()] \
                    if etype == "LWPOLYLINE" else [v.dxf.location for v in e.vertices]
                layer_len[layer] = layer_len.get(layer, 0.0) + _polyline_length(pts)
                if getattr(e, "closed", False) or getattr(e.dxf, "flags", 0) & 1:
                    layer_area[layer] = layer_area.get(layer, 0.0) + _polygon_area(pts)
            elif etype == "CIRCLE":
                import math
                layer_area[layer] = layer_area.get(layer, 0.0) + math.pi * e.dxf.radius ** 2
            elif etype == "HATCH":
                layer_area[layer] = layer_area.get(layer, 0.0) + abs(getattr(e, "area", 0.0) or 0.0)
            elif etype == "INSERT":
                key = (layer, e.dxf.name)
                block_counts[key] = block_counts.get(key, 0) + 1
        except Exception:
            continue  # never let one malformed entity kill the takeoff

    units = _dxf_units(doc)
    rows: list[dict] = []

    for layer, length in sorted(layer_len.items()):
        if length <= 0:
            continue
        rows.append(_row(
            description=f"{layer} — linear run",
            qty=length, basis=f"Sum of LINE/POLYLINE geometry on layer '{layer}' ({units})",
            uom="LF", location_tag=layer,
        ))
    for layer, area in sorted(layer_area.items()):
        if area <= 0:
            continue
        rows.append(_row(
            description=f"{layer} — area",
            qty=area, basis=f"Sum of closed-polygon/hatch area on layer '{layer}' ({units}²)",
            uom="SF", location_tag=layer,
        ))
    for (layer, block_name), count in sorted(block_counts.items()):
        rows.append(_row(
            description=f"{block_name} ({layer})",
            qty=count, basis=f"Count of '{block_name}' block inserts on layer '{layer}'",
            uom="EA", location_tag=layer,
        ))

    return {
        "source_type": "dxf",
        "rows": rows,
        "coverage": {
            "layers_with_length": len(layer_len),
            "layers_with_area": len(layer_area),
            "block_types": len(block_counts),
            "rows_extracted": len(rows),
            "drawing_units": units,
        },
        "ai_candidate_pages": [],
    }


def _polygon_area(points: list) -> float:
    """Shoelace area of a closed polygon (ignores Z)."""
    if len(points) < 3:
        return 0.0
    area = 0.0
    n = len(points)
    for i in range(n):
        x1, y1 = points[i][0], points[i][1]
        x2, y2 = points[(i + 1) % n][0], points[(i + 1) % n][1]
        area += x1 * y2 - x2 * y1
    return abs(area) / 2.0


def _dxf_units(doc) -> str:
    code = doc.header.get("$INSUNITS", 0)
    return {0: "unitless", 1: "in", 2: "ft", 4: "mm", 5: "cm", 6: "m"}.get(code, "unitless")


# ─────────────────────────────────────────────────────────────────────────────
# IFC — BIM base quantities (ifcopenshell, optional)
# ─────────────────────────────────────────────────────────────────────────────

def extract_from_ifc(path: str) -> dict:
    try:
        import ifcopenshell
        import ifcopenshell.util.element as ifc_element
    except ImportError:
        raise ValueError(
            "IFC support is not installed on the parser service. "
            "Add 'ifcopenshell' to requirements or export your model to DXF/PDF."
        )

    model = ifcopenshell.open(path)
    rows: list[dict] = []
    type_counts: dict[str, int] = {}

    # Walk every building element; pull its base quantities (length/area/volume/count).
    for el in model.by_type("IfcBuildingElement"):
        ifc_type = el.is_a()
        name = getattr(el, "Name", None) or ifc_type
        type_counts[ifc_type] = type_counts.get(ifc_type, 0) + 1

        qtos = ifc_element.get_psets(el, qtos_only=True) or {}
        picked = False
        for qset_name, quants in qtos.items():
            for qname, qval in quants.items():
                if not isinstance(qval, (int, float)):
                    continue
                ql = qname.lower()
                if "length" in ql:
                    uom, label = "LF", "length"
                elif "area" in ql:
                    uom, label = "SF", "area"
                elif "volume" in ql:
                    uom, label = "CY", "volume"
                elif "count" in ql:
                    uom, label = "EA", "count"
                else:
                    continue
                rows.append(_row(
                    description=f"{name} — {label}",
                    qty=float(qval), basis=f"IFC {ifc_type} base quantity '{qname}'",
                    uom=uom, drawing_ref=ifc_type, location_tag=_ifc_storey(el),
                ))
                picked = True
        if not picked:
            # No quantities on the element — still record it as a count of one.
            rows.append(_row(
                description=str(name), qty=1.0,
                basis=f"IFC {ifc_type} instance (no base quantity in model)",
                uom="EA", drawing_ref=ifc_type, location_tag=_ifc_storey(el),
            ))

    return {
        "source_type": "ifc",
        "rows": rows,
        "coverage": {
            "element_types": len(type_counts),
            "elements": sum(type_counts.values()),
            "rows_extracted": len(rows),
            "schema": getattr(model, "schema", "unknown"),
        },
        "ai_candidate_pages": [],
    }


def _ifc_storey(el) -> str | None:
    try:
        import ifcopenshell.util.element as ifc_element
        container = ifc_element.get_container(el)
        return getattr(container, "Name", None) if container else None
    except Exception:
        return None


# ─────────────────────────────────────────────────────────────────────────────
# XLSX / XLS — tabular estimate / BOM (openpyxl)
# ─────────────────────────────────────────────────────────────────────────────

def extract_from_xlsx(path: str) -> dict:
    import openpyxl

    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    rows: list[dict] = []
    sheets_used = 0

    for ws in wb.worksheets:
        data = list(ws.iter_rows(values_only=True))
        if len(data) < 2:
            continue
        # Find the header row (first row with a description-ish header).
        header_idx = next(
            (i for i, r in enumerate(data[:10])
             if r and any(c and DESC_HEADERS.search(str(c)) for c in r)),
            0,
        )
        header = [str(c).strip() if c is not None else "" for c in data[header_idx]]
        desc_col = next((i for i, h in enumerate(header) if DESC_HEADERS.search(h)), 0)
        qty_col  = next((i for i, h in enumerate(header) if QTY_HEADERS.search(h)), None)
        unit_col = next((i for i, h in enumerate(header) if UNIT_HEADERS.search(h)), None)

        made = False
        for r in data[header_idx + 1:]:
            if not r or desc_col >= len(r):
                continue
            desc = r[desc_col]
            if desc is None or str(desc).strip() == "":
                continue
            desc = str(desc).strip()
            qty = _to_float(r[qty_col]) if (qty_col is not None and qty_col < len(r)) else None
            if qty is None:
                qty = 1.0
                basis = f"'{ws.title}' row (count defaulted to 1)"
            else:
                basis = f"'{ws.title}' col '{header[qty_col] or 'qty'}'"
            unit = r[unit_col] if (unit_col is not None and unit_col < len(r)) else None
            rows.append(_row(desc, qty, basis, uom=str(unit) if unit else None,
                             drawing_ref=ws.title))
            made = True
        if made:
            sheets_used += 1

    wb.close()
    return {
        "source_type": "xlsx",
        "rows": rows,
        "coverage": {"sheets_used": sheets_used, "rows_extracted": len(rows)},
        "ai_candidate_pages": [],
    }


# ─────────────────────────────────────────────────────────────────────────────
# Dispatcher
# ─────────────────────────────────────────────────────────────────────────────

def extract(path: str) -> dict:
    """Dispatch by file extension. Returns a uniform extraction result dict."""
    ext = Path(path).suffix.lower()
    if ext == ".pdf":
        return extract_from_pdf(path)
    if ext in (".dxf", ".dwg"):
        return extract_from_dxf(path)
    if ext == ".ifc":
        return extract_from_ifc(path)
    if ext in (".xlsx", ".xls"):
        return extract_from_xlsx(path)
    raise ValueError(f"Unsupported file type for deterministic extraction: {ext}")
