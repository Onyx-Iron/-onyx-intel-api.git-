"""
Process-level parallelism for DXF / DXF-encoded DWG entity extraction.

Each worker re-opens the DXF (spawn-safe; ezdxf entities are not picklable)
and processes a contiguous modelspace entity index range. Parent merges
length / block counts and runs GEOS unary_union on closed rings so overlaps
across chunk boundaries are still de-duplicated correctly.
"""

from __future__ import annotations

import logging
import math
import os
from concurrent.futures import ProcessPoolExecutor, as_completed
from typing import Any

logger = logging.getLogger(__name__)

_DEFAULT_PARALLEL_MIN_ENTITIES = 200


def _cpu_workers(requested: int | None = None) -> int:
    env = os.getenv("DXF_EXTRACT_WORKERS") or os.getenv("PDF_EXTRACT_WORKERS") or os.getenv(
        "CELERY_CONCURRENCY"
    )
    if requested is not None and requested > 0:
        n = requested
    elif env and env.isdigit() and int(env) > 0:
        n = int(env)
    else:
        n = os.cpu_count() or 2
    if os.getenv("CELERY_WORKER_NAME") or os.getenv("CELERY_MANGLE_HOSTNAME"):
        n = min(n, max(1, (os.cpu_count() or 2) // 2))
    return max(1, min(n, 16))


def _bootstrap_paths() -> None:
    import sys
    from pathlib import Path

    here = Path(__file__).resolve()
    engine_dir = here.parents[1]
    repo_root = here.parents[2]
    for path in (str(repo_root), str(engine_dir)):
        if path not in sys.path:
            sys.path.insert(0, path)


def _serialize_point(p: Any) -> tuple[float, float, float]:
    if hasattr(p, "x"):
        return (float(p.x), float(p.y), float(getattr(p, "z", 0.0) or 0.0))
    if len(p) >= 3:
        return (float(p[0]), float(p[1]), float(p[2]))
    return (float(p[0]), float(p[1]), 0.0)


def _process_entity_chunk(payload: tuple[str, int, int]) -> dict[str, Any]:
    """Top-level picklable worker: process modelspace[start:end)."""
    _bootstrap_paths()
    path, start, end = payload
    import math

    import ezdxf
    from ezdxf.math import Vec3

    try:
        from services import geos_geometry as geo
    except ImportError:
        geo = None

    doc = ezdxf.readfile(path)
    entities = list(doc.modelspace())
    slice_ents = entities[start:end]

    layer_len: dict[str, float] = {}
    layer_rings: dict[str, list[list[tuple[float, float, float]]]] = {}
    layer_area_extra: dict[str, float] = {}
    block_counts: dict[str, int] = {}  # "layer\0block" keys for JSON-friendly merge

    def _polyline_length(points: list) -> float:
        if geo is not None:
            return float(geo.polyline_length(points))
        total = 0.0
        for a, b in zip(points, points[1:]):
            total += (Vec3(b) - Vec3(a)).magnitude
        return total

    for e in slice_ents:
        layer = getattr(e.dxf, "layer", "0")
        etype = e.dxftype()
        try:
            if etype == "LINE":
                layer_len[layer] = layer_len.get(layer, 0.0) + (
                    Vec3(e.dxf.end) - Vec3(e.dxf.start)
                ).magnitude
            elif etype in ("LWPOLYLINE", "POLYLINE"):
                if etype == "LWPOLYLINE":
                    pts = [
                        _serialize_point(p[:3] if len(p) >= 3 else (p[0], p[1], 0.0))
                        for p in e.get_points()
                    ]
                else:
                    pts = [_serialize_point(v.dxf.location) for v in e.vertices]
                layer_len[layer] = layer_len.get(layer, 0.0) + _polyline_length(pts)
                if getattr(e, "closed", False) or getattr(e.dxf, "flags", 0) & 1:
                    layer_rings.setdefault(layer, []).append(pts)
            elif etype == "CIRCLE":
                if geo is not None:
                    layer_area_extra[layer] = layer_area_extra.get(layer, 0.0) + geo.circle_area(
                        float(e.dxf.radius)
                    )
                else:
                    layer_area_extra[layer] = (
                        layer_area_extra.get(layer, 0.0) + math.pi * float(e.dxf.radius) ** 2
                    )
            elif etype == "HATCH":
                layer_area_extra[layer] = layer_area_extra.get(layer, 0.0) + abs(
                    getattr(e, "area", 0.0) or 0.0
                )
            elif etype == "INSERT":
                key = f"{layer}\0{e.dxf.name}"
                block_counts[key] = block_counts.get(key, 0) + 1
        except Exception:
            continue

    return {
        "layer_len": layer_len,
        "layer_rings": layer_rings,
        "layer_area_extra": layer_area_extra,
        "block_counts": block_counts,
        "entity_count": len(slice_ents),
    }


def _merge_float_dicts(parts: list[dict[str, float]]) -> dict[str, float]:
    out: dict[str, float] = {}
    for part in parts:
        for k, v in part.items():
            out[k] = out.get(k, 0.0) + float(v)
    return out


def _merge_ring_dicts(
    parts: list[dict[str, list]],
) -> dict[str, list]:
    out: dict[str, list] = {}
    for part in parts:
        for k, rings in part.items():
            out.setdefault(k, []).extend(rings)
    return out


def _chunk_ranges(n: int, n_workers: int) -> list[tuple[int, int]]:
    if n <= 0:
        return []
    n_workers = max(1, min(n_workers, n))
    size = math.ceil(n / n_workers)
    return [(i, min(i + size, n)) for i in range(0, n, size)]


def extract_dxf_parallel(
    path: str,
    *,
    max_workers: int | None = None,
    min_entities_for_pool: int | None = None,
) -> dict[str, Any]:
    """
    Multi-process DXF geometry extract. Falls back to one worker for small drawings.
    """
    import ezdxf

    from takeoff_extract import (
        _dxf_unit_to_feet_factor,
        _dxf_units,
        _geos,
        _polygon_area,
        _row,
    )

    min_ents = (
        min_entities_for_pool
        if min_entities_for_pool is not None
        else _DEFAULT_PARALLEL_MIN_ENTITIES
    )
    workers = _cpu_workers(max_workers)

    try:
        doc = ezdxf.readfile(path)
    except (ezdxf.DXFStructureError, IOError) as e:
        raise ValueError(
            f"Could not read as DXF ({e}). For binary .dwg, export to DXF "
            f"from your CAD tool (Save As → AutoCAD DXF) and re-upload."
        ) from e

    entity_count = sum(1 for _ in doc.modelspace())
    units = _dxf_units(doc)
    to_feet = _dxf_unit_to_feet_factor(doc)
    geo = _geos()

    if workers <= 1 or entity_count < min_ents:
        ranges = [(0, entity_count)]
        use_pool = False
    else:
        ranges = _chunk_ranges(entity_count, workers)
        use_pool = True

    logger.info(
        "[dxf.parallel] path=%s entities=%d chunks=%d workers=%d pool=%s",
        path,
        entity_count,
        len(ranges),
        workers,
        use_pool,
    )

    parts: list[dict[str, Any]] = []
    if use_pool:
        import multiprocessing as mp

        ctx = mp.get_context("spawn")
        with ProcessPoolExecutor(max_workers=len(ranges), mp_context=ctx) as pool:
            futures = [pool.submit(_process_entity_chunk, (path, a, b)) for a, b in ranges]
            for fut in as_completed(futures):
                parts.append(fut.result())
    else:
        for a, b in ranges:
            parts.append(_process_entity_chunk((path, a, b)))

    layer_len = _merge_float_dicts([p["layer_len"] for p in parts])
    layer_rings = _merge_ring_dicts([p["layer_rings"] for p in parts])
    layer_area_extra = _merge_float_dicts([p["layer_area_extra"] for p in parts])
    block_counts_raw = _merge_float_dicts([p["block_counts"] for p in parts])

    # GEOS unary_union on the FULL ring set per layer (correct across chunks).
    layer_area: dict[str, float] = dict(layer_area_extra)
    for layer, rings in layer_rings.items():
        if geo is not None and len(rings) > 1:
            area = geo.unary_union_area(rings)
        else:
            area = sum(_polygon_area(r) for r in rings)
        layer_area[layer] = layer_area.get(layer, 0.0) + area

    rows: list[dict] = []
    for layer, length in sorted(layer_len.items()):
        length_ft = length * to_feet
        if length_ft <= 0:
            continue
        rows.append(
            _row(
                description=f"{layer} — linear run",
                qty=length_ft,
                basis=f"Sum of LINE/POLYLINE geometry on layer '{layer}' ({units}, converted to LF)",
                uom="LF",
                location_tag=layer,
            )
        )
    for layer, area in sorted(layer_area.items()):
        area_sf = area * (to_feet**2)
        if area_sf <= 0:
            continue
        basis_engine = "GEOS unary_union" if geo is not None else "shoelace sum"
        rows.append(
            _row(
                description=f"{layer} — area",
                qty=area_sf,
                basis=f"{basis_engine} closed-polygon/hatch area on layer '{layer}' ({units}² → SF)",
                uom="SF",
                location_tag=layer,
            )
        )
    for key, count in sorted(block_counts_raw.items()):
        layer, block_name = key.split("\0", 1)
        rows.append(
            _row(
                description=f"{block_name} ({layer})",
                qty=int(count),
                basis=f"Count of '{block_name}' block inserts on layer '{layer}'",
                uom="EA",
                location_tag=layer,
            )
        )

    return {
        "source_type": "dxf",
        "rows": rows,
        "coverage": {
            "layers_with_length": len(layer_len),
            "layers_with_area": len(layer_area),
            "block_types": len(block_counts_raw),
            "rows_extracted": len(rows),
            "drawing_units": units,
            "geometry_engine": "geos" if geo is not None else "shoelace",
            "entity_count": entity_count,
            "parallel_workers": len(ranges) if use_pool else 1,
        },
        "ai_candidate_pages": [],
    }
