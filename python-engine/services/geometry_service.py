"""Planar boolean operations.

Shapely 2 runs these on GEOS (the same engine PyGEOS used). Net slab area,
wall offsets, and overlapping footprint unions stay in that library instead
of a Python shoelace loop.
"""

from __future__ import annotations

from shapely.geometry import LineString, Polygon
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


def _rings_of(geom) -> list[Ring]:
    rings: list[Ring] = []
    parts = list(geom.geoms) if geom.geom_type == "MultiPolygon" else [geom]
    for part in parts:
        if part.geom_type != "Polygon" or part.is_empty:
            continue
        rings.append([(float(x), float(y)) for x, y in part.exterior.coords])
    return rings


def buffer_centerline(points: Ring, half_width: float, obstacles: list[Ring] | None = None) -> dict:
    """Buffer an open centerline into a paving or wall polygon.

    Flat caps keep the area equal to length times full width on a straight
    run. Obstacle rings (crossings, shafts) are subtracted.
    """
    if len(points) < 2:
        raise ValueError("a centerline needs at least 2 points")
    if half_width <= 0:
        raise ValueError("half_width must be positive")
    line = LineString(points)
    if line.length == 0:
        raise ValueError("centerline has no length")
    grown = line.buffer(half_width, cap_style="flat", join_style="mitre")
    for ring in obstacles or []:
        if len(ring) < 3:
            continue
        grown = grown.difference(_polygon(ring))
    if grown.is_empty:
        return {"area": 0.0, "rings": []}
    return {"area": float(grown.area), "rings": _rings_of(grown)}
