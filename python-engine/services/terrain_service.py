"""TIN cut and fill.

Spot elevations become a Delaunay triangulation. Each triangle is a prism
between the existing grade and the proposed grade. Volume is the triangle
area times the average elevation change, which is the prism integral rather
than a resampled grid. Trimesh holds the existing-ground mesh so callers can
see the face count of the surface that was integrated.
"""

from __future__ import annotations

from collections import defaultdict

import numpy as np
import trimesh
from scipy.spatial import Delaunay
from shapely.geometry import Point as ShapelyPoint
from shapely.geometry import Polygon

Point3 = tuple[float, float, float]
Ring = list[tuple[float, float]]


def _triangle_area(a: np.ndarray, b: np.ndarray, c: np.ndarray) -> float:
    return float(abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) / 2.0)


def _interpolate(tri: Delaunay, surface: np.ndarray, query: np.ndarray) -> np.ndarray:
    simplex = tri.find_simplex(query)
    result = np.empty(len(query), dtype=float)
    inside = simplex >= 0
    if np.any(inside):
        chosen = simplex[inside]
        transform = tri.transform[chosen]
        delta = query[inside] - transform[:, 2]
        bary = np.einsum("ijk,ik->ij", transform[:, :2], delta)
        weights = np.column_stack((bary, 1.0 - bary.sum(axis=1)))
        verts = tri.simplices[chosen]
        result[inside] = np.einsum("ij,ij->i", weights, surface[verts, 2])
    missing = ~inside
    if np.any(missing):
        # Points outside the proposed hull take the nearest spot elevation.
        targets = query[missing]
        nearest = np.empty(len(targets), dtype=float)
        xy = surface[:, :2]
        for i, point in enumerate(targets):
            dist = np.sum((xy - point) ** 2, axis=1)
            nearest[i] = surface[int(np.argmin(dist)), 2]
        result[missing] = nearest
    return result


def _gradient(a: np.ndarray, b: np.ndarray, c: np.ndarray) -> tuple[float, float, float]:
    """Rise/run of the plane through three xyz points, plus downhill x/y."""
    ab = b - a
    ac = c - a
    nx = ab[1] * ac[2] - ab[2] * ac[1]
    ny = ab[2] * ac[0] - ab[0] * ac[2]
    nz = ab[0] * ac[1] - ab[1] * ac[0]
    if abs(nz) < 1e-12:
        return 0.0, 0.0, 0.0
    gx = -nx / nz
    gy = -ny / nz
    return float(np.hypot(gx, gy)), float(-gx), float(-gy)


def surface_drainage(points: list[Point3], boundary: Ring | None = None) -> dict:
    """Slope percent, downhill direction, and ponding lows on one TIN."""
    xyz = np.asarray(points, dtype=float)
    if xyz.ndim != 2 or xyz.shape[1] != 3 or len(xyz) < 3:
        raise ValueError("a surface needs at least 3 x, y, z points")
    tri = Delaunay(xyz[:, :2])
    limit = Polygon(boundary) if boundary and len(boundary) >= 3 else None
    neighbors: dict[int, set[int]] = defaultdict(set)
    slopes: list[float] = []
    steepest = 0.0
    flow = (0.0, 0.0)
    for simplex in tri.simplices:
        slope, downhill_x, downhill_y = _gradient(xyz[simplex[0]], xyz[simplex[1]], xyz[simplex[2]])
        percent = slope * 100.0
        slopes.append(percent)
        if percent >= steepest:
            steepest = percent
            flow = (downhill_x, downhill_y)
        for index in range(3):
            vertex = int(simplex[index])
            neighbors[vertex].update(int(simplex[other]) for other in range(3) if other != index)
    lows = []
    for index, nbrs in neighbors.items():
        elevation = float(xyz[index, 2])
        if not nbrs or not all(float(xyz[other, 2]) > elevation + 1e-6 for other in nbrs):
            continue
        x, y = float(xyz[index, 0]), float(xyz[index, 1])
        if limit is not None and not limit.covers(ShapelyPoint(x, y)):
            continue
        lows.append({"x": x, "y": y, "z": elevation})
    return {
        "steepest_slope_pct": steepest,
        "mean_slope_pct": float(np.mean(slopes)) if slopes else 0.0,
        "flow_x": flow[0],
        "flow_y": flow[1],
        "low_points": lows,
    }


def contours_to_points(contours: list[dict], spots: list[dict] | None = None) -> list[Point3]:
    """Contour polylines and spot elevations become one existing-ground cloud."""
    points: list[Point3] = []
    for contour in contours:
        elevation = float(contour["elevation"])
        for point in contour.get("points") or []:
            points.append((float(point[0]), float(point[1]), elevation))
    for spot in spots or []:
        elevation = spot.get("z", spot.get("elevation"))
        points.append((float(spot["x"]), float(spot["y"]), float(elevation)))
    return points


def trench_volume(centerline: Ring, width_ft: float, depth_ft: float, bedding_ft: float = 0.0) -> dict:
    """Prism along a utility run: length × width × depth, split into bedding and backfill."""
    if len(centerline) < 2:
        raise ValueError("a trench centerline needs at least 2 points")
    if width_ft <= 0 or depth_ft < 0 or bedding_ft < 0:
        raise ValueError("width must be positive and depths cannot be negative")
    length = 0.0
    for start, end in zip(centerline, centerline[1:]):
        length += float(np.hypot(end[0] - start[0], end[1] - start[1]))
    bedding = min(bedding_ft, depth_ft)
    excavation_cy = length * width_ft * depth_ft / 27.0
    bedding_cy = length * width_ft * bedding / 27.0
    backfill_cy = length * width_ft * max(0.0, depth_ft - bedding) / 27.0
    return {
        "length_ft": length,
        "excavation_cy": excavation_cy,
        "bedding_cy": bedding_cy,
        "backfill_cy": backfill_cy,
    }


def cut_fill_tin(
    existing: list[Point3],
    proposed: list[Point3],
    units: str = "ft",
    boundary: Ring | None = None,
) -> dict:
    """Compare two surfaces. Negative change (proposed below existing) is cut.

    Volumes are cubic yards when coordinates are feet, otherwise cubic units.
    Net is fill minus cut, matching the portal grid convention.
    """
    existing_xyz = np.asarray(existing, dtype=float)
    proposed_xyz = np.asarray(proposed, dtype=float)
    if existing_xyz.ndim != 2 or existing_xyz.shape[1] != 3 or proposed_xyz.shape[1] != 3:
        raise ValueError("surfaces must be lists of x, y, z points")
    if len(existing_xyz) < 3 or len(proposed_xyz) < 3:
        raise ValueError("each surface needs at least 3 points")

    existing_tri = Delaunay(existing_xyz[:, :2])
    proposed_tri = Delaunay(proposed_xyz[:, :2])
    proposed_z = _interpolate(proposed_tri, proposed_xyz, existing_xyz[:, :2])
    delta = proposed_z - existing_xyz[:, 2]

    limit = Polygon(boundary) if boundary and len(boundary) >= 3 else None
    cut_volume = 0.0
    fill_volume = 0.0
    for simplex in existing_tri.simplices:
        corners = [
            existing_xyz[simplex[0], :2],
            existing_xyz[simplex[1], :2],
            existing_xyz[simplex[2], :2],
        ]
        area = _triangle_area(corners[0], corners[1], corners[2])
        if limit is not None:
            ring = [(float(point[0]), float(point[1])) for point in corners]
            area = float(Polygon(ring).intersection(limit).area)
        change = float(delta[simplex].mean()) * area
        if change < 0:
            cut_volume += -change
        elif change > 0:
            fill_volume += change

    divisor = 27.0 if units == "ft" else 1.0
    mesh = trimesh.Trimesh(vertices=existing_xyz, faces=existing_tri.simplices, process=False)
    drainage = surface_drainage(existing, boundary)
    return {
        "cut_cy": cut_volume / divisor,
        "fill_cy": fill_volume / divisor,
        "net_cy": (fill_volume - cut_volume) / divisor,
        "triangles": int(len(existing_tri.simplices)),
        "vertices": int(len(existing_xyz)),
        "method": "tin_prism",
        "mesh_faces": int(len(mesh.faces)),
        "clipped": limit is not None,
        "steepest_slope_pct": drainage["steepest_slope_pct"],
        "mean_slope_pct": drainage["mean_slope_pct"],
        "flow_x": drainage["flow_x"],
        "flow_y": drainage["flow_y"],
        "low_points": drainage["low_points"],
    }
