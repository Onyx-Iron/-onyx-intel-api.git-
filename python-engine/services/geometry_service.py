"""Planar boolean operations.

Shapely 2 runs these on GEOS (the same engine PyGEOS used). Net slab area,
wall offsets, and overlapping footprint unions stay in that library instead
of a Python shoelace loop.
"""

from __future__ import annotations

from shapely.geometry import Polygon
from shapely.ops import unary_union
from shapely.validation import make_valid

Ring = list[tuple[float, float]]


def _polygon(ring: Ring, holes: list[Ring] | None = None) -> Polygon:
    if len(ring) < 3:
        raise ValueError("a polygon ring needs at least 3 points")
    geom = Polygon(ring, holes or [])
    if geom.is_empty:
        raise ValueError("polygon ring is empty")
    if not geom.is_valid:
        geom = make_valid(geom)
    return geom


def net_area(outer: Ring, holes: list[Ring] | None = None) -> float:
    """Area of the outer ring minus holes, in the coordinate units squared."""
    return float(_polygon(outer, holes).area)


def union_area(rings: list[Ring]) -> float:
    """Area of the union, so overlapping footprints are not counted twice."""
    geoms = []
    for ring in rings:
        if len(ring) < 3:
            continue
        geoms.append(_polygon(ring))
    if not geoms:
        return 0.0
    merged = unary_union(geoms)
    return float(merged.area)


def offset_ring(ring: Ring, distance: float) -> dict:
    """Offset a ring. Positive distance grows it (wall thickness, paving edge)."""
    grown = _polygon(ring).buffer(distance)
    if grown.is_empty:
        return {"area": 0.0, "rings": []}
    rings: list[Ring] = []
    parts = list(grown.geoms) if grown.geom_type == "MultiPolygon" else [grown]
    for part in parts:
        if part.geom_type != "Polygon":
            continue
        rings.append([(float(x), float(y)) for x, y in part.exterior.coords])
    return {"area": float(grown.area), "rings": rings}
