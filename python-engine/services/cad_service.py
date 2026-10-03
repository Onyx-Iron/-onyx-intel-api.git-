"""Survey and CAD coordinate alignment.

pyproj is the PROJ transform GDAL uses for CRS math. State-plane coordinates
(for example Texas NAD83, EPSG:2276, US survey feet) are shifted onto a local
feet grid whose origin is the first point, which is what the sheet canvas can
draw. Binary DWG is still converted to DXF before ezdxf reads it; a freely
redistributable GDAL build cannot decode DWG.
"""

from __future__ import annotations

from pyproj import CRS, Transformer

Point = tuple[float, float]

# NAD83 Texas North Central, US survey feet. Callers can pass another EPSG.
DEFAULT_STATE_PLANE_EPSG = 2276


def transform_points(points: list[Point], source_epsg: int, target_epsg: int) -> list[Point]:
    if source_epsg == target_epsg:
        return [(float(x), float(y)) for x, y in points]
    transformer = Transformer.from_crs(
        CRS.from_epsg(source_epsg),
        CRS.from_epsg(target_epsg),
        always_xy=True,
    )
    out: list[Point] = []
    for x, y in points:
        nx, ny = transformer.transform(float(x), float(y))
        out.append((float(nx), float(ny)))
    return out


def _feet_per_unit(epsg: int) -> float:
    crs = CRS.from_epsg(epsg)
    if not crs.axis_info:
        return 1.0
    unit = (crs.axis_info[0].unit_name or "").lower()
    if "foot" in unit or "feet" in unit:
        return 1.0
    if "metre" in unit or "meter" in unit:
        return 3.280839895
    return 1.0


def to_canvas_feet(
    points: list[Point],
    source_epsg: int,
    target_epsg: int = DEFAULT_STATE_PLANE_EPSG,
) -> list[Point]:
    """Project survey points into local easting/northing feet. The first point is (0, 0)."""
    projected = transform_points(points, source_epsg, target_epsg)
    if not projected:
        return []
    origin_x, origin_y = projected[0]
    scale = _feet_per_unit(target_epsg)
    return [((x - origin_x) * scale, (y - origin_y) * scale) for x, y in projected]
