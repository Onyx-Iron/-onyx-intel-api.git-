"""TIN cut and fill.

Spot elevations become a Delaunay triangulation. Each triangle is a prism
between the existing grade and the proposed grade. Volume is the triangle
area times the average elevation change, which is the prism integral rather
than a resampled grid. Trimesh holds the existing-ground mesh so callers can
see the face count of the surface that was integrated.
"""

from __future__ import annotations

import numpy as np
import trimesh
from scipy.spatial import Delaunay

Point3 = tuple[float, float, float]


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


def cut_fill_tin(existing: list[Point3], proposed: list[Point3], units: str = "ft") -> dict:
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

    cut_volume = 0.0
    fill_volume = 0.0
    for simplex in existing_tri.simplices:
        area = _triangle_area(
            existing_xyz[simplex[0], :2],
            existing_xyz[simplex[1], :2],
            existing_xyz[simplex[2], :2],
        )
        change = float(delta[simplex].mean()) * area
        if change < 0:
            cut_volume += -change
        elif change > 0:
            fill_volume += change

    divisor = 27.0 if units == "ft" else 1.0
    mesh = trimesh.Trimesh(vertices=existing_xyz, faces=existing_tri.simplices, process=False)
    return {
        "cut_cy": cut_volume / divisor,
        "fill_cy": fill_volume / divisor,
        "net_cy": (fill_volume - cut_volume) / divisor,
        "triangles": int(len(existing_tri.simplices)),
        "vertices": int(len(existing_xyz)),
        "method": "tin_prism",
        "mesh_faces": int(len(mesh.faces)),
    }
