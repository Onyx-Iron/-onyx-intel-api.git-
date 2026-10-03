"""
C-backed geometry via Shapely / GEOS.

Shapely 2.x always routes polygon ops through the GEOS C library — there is
no pure-Python fallback for area, buffer, intersection, or unary_union.
Use these helpers for trench footprints, closed-polyline areas, and plan-view
overlap de-duplication instead of hand-rolled shoelace / nested loops.
"""

from __future__ import annotations

from typing import Any, Iterable, Sequence

from shapely import make_valid
from shapely.geometry import LineString, MultiPolygon, Point, Polygon
from shapely.ops import unary_union

# Shapely 2.x always routes geometry through GEOS (C). The legacy
# shapely.speedups module is a no-op / deprecated — treat GEOS as always on.
GEOS_SPEEDUPS_ACTIVE = True
try:
    from shapely.lib import GEOSException  # noqa: F401 — confirms GEOS-backed binary
except Exception:  # noqa: BLE001
    GEOS_SPEEDUPS_ACTIVE = False


PointLike = Sequence[float] | tuple[float, ...]


def _xy(points: Iterable[PointLike]) -> list[tuple[float, float]]:
    out: list[tuple[float, float]] = []
    for p in points:
        out.append((float(p[0]), float(p[1])))
    return out


def polygon_area(points: Iterable[PointLike]) -> float:
    """GEOS area of a ring (ignores Z). Returns 0 for degenerate rings."""
    coords = _xy(points)
    if len(coords) < 3:
        return 0.0
    if coords[0] != coords[-1]:
        coords = coords + [coords[0]]
    poly = make_valid(Polygon(coords))
    if poly.is_empty:
        return 0.0
    return float(abs(poly.area))


def polyline_length(points: Iterable[PointLike]) -> float:
    """GEOS length of an open or closed polyline (2D)."""
    coords = _xy(points)
    if len(coords) < 2:
        return 0.0
    return float(LineString(coords).length)


def circle_area(radius: float) -> float:
    if radius <= 0:
        return 0.0
    return float(Point(0.0, 0.0).buffer(radius).area)


def unary_union_area(rings: Iterable[Iterable[PointLike]]) -> float:
    """
    Union overlapping closed polygons and return net plan area (GEOS).

    Use for hatch / closed-polyline layers where overlapping shapes would
    double-count if areas were simply summed.
    """
    polys: list[Any] = []
    for ring in rings:
        coords = _xy(ring)
        if len(coords) < 3:
            continue
        if coords[0] != coords[-1]:
            coords = coords + [coords[0]]
        poly = make_valid(Polygon(coords))
        if not poly.is_empty:
            polys.append(poly)
    if not polys:
        return 0.0
    merged = unary_union(polys)
    return float(abs(merged.area))


def trench_buffer_footprint(
    centerline: Iterable[PointLike],
    top_width_ft: float,
    *,
    cap_style: str = "flat",
    join_style: str = "mitre",
) -> Polygon | MultiPolygon | None:
    """
    Plan-view trench corridor: LineString buffered by half the top (layback) width.

    GEOS buffer is the C-engine path for layback footprints used in overlap /
    intersection calculations across utility runs.
    """
    coords = _xy(centerline)
    if len(coords) < 2 or top_width_ft <= 0:
        return None
    half = top_width_ft / 2.0
    buf = LineString(coords).buffer(half, cap_style=cap_style, join_style=join_style)
    if buf.is_empty:
        return None
    return make_valid(buf)  # type: ignore[return-value]


def trench_buffer_area_sf(centerline: Iterable[PointLike], top_width_ft: float) -> float:
    footprint = trench_buffer_footprint(centerline, top_width_ft)
    if footprint is None:
        return 0.0
    return float(abs(footprint.area))


def union_trench_footprints(
    runs: Iterable[tuple[Iterable[PointLike], float]],
) -> float:
    """
    Union multiple trench corridors (centerline + top_width) and return net SF.

    Overlapping layback wedges at pipe crossings are counted once.
    """
    parts: list[Any] = []
    for centerline, top_width in runs:
        fp = trench_buffer_footprint(centerline, top_width)
        if fp is not None and not fp.is_empty:
            parts.append(fp)
    if not parts:
        return 0.0
    return float(abs(unary_union(parts).area))


def polygon_intersection_area(
    a: Iterable[PointLike],
    b: Iterable[PointLike],
) -> float:
    """GEOS intersection area of two rings."""
    ca, cb = _xy(a), _xy(b)
    if len(ca) < 3 or len(cb) < 3:
        return 0.0
    if ca[0] != ca[-1]:
        ca = ca + [ca[0]]
    if cb[0] != cb[-1]:
        cb = cb + [cb[0]]
    pa = make_valid(Polygon(ca))
    pb = make_valid(Polygon(cb))
    if pa.is_empty or pb.is_empty:
        return 0.0
    return float(abs(pa.intersection(pb).area))
