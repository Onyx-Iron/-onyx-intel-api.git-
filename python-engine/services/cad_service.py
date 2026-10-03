"""Survey and CAD coordinate alignment.

pyproj is the PROJ transform GDAL uses for CRS math. State-plane coordinates
(for example Texas NAD83, EPSG:2276, US survey feet) are shifted onto a local
feet grid whose origin is the first point, which is what the sheet canvas can
draw. Binary DWG is still converted to DXF before ezdxf reads it; a freely
redistributable GDAL build cannot decode DWG.
"""

from __future__ import annotations

import math

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


def fit_sheet_transform(sheet_a: Point, sheet_b: Point, world_a: Point, world_b: Point) -> dict:
    """Uniform scale, rotation, and translation from two sheet points to two survey points."""
    sax, say = float(sheet_a[0]), float(sheet_a[1])
    sbx, sby = float(sheet_b[0]), float(sheet_b[1])
    wax, way = float(world_a[0]), float(world_a[1])
    wbx, wby = float(world_b[0]), float(world_b[1])
    sheet_length = math.hypot(sbx - sax, sby - say)
    world_length = math.hypot(wbx - wax, wby - way)
    if sheet_length == 0 or world_length == 0:
        raise ValueError("the two sheet points and the two survey points must be distinct")
    scale = world_length / sheet_length
    rotation = math.atan2(wby - way, wbx - wax) - math.atan2(sby - say, sbx - sax)
    cosine, sine = math.cos(rotation), math.sin(rotation)
    rotated_x = scale * (cosine * sax - sine * say)
    rotated_y = scale * (sine * sax + cosine * say)
    return {
        "scale": scale,
        "rotation_rad": rotation,
        "tx": wax - rotated_x,
        "ty": way - rotated_y,
    }


def apply_sheet_transform(points: list[Point], transform: dict) -> list[Point]:
    scale = float(transform["scale"])
    rotation = float(transform["rotation_rad"])
    tx, ty = float(transform["tx"]), float(transform["ty"])
    cosine, sine = math.cos(rotation), math.sin(rotation)
    out: list[Point] = []
    for x, y in points:
        px, py = float(x), float(y)
        out.append((
            scale * (cosine * px - sine * py) + tx,
            scale * (sine * px + cosine * py) + ty,
        ))
    return out
