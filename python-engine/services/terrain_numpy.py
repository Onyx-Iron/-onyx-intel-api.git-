"""
NumPy-vectorized terrain cut/fill on rectangular elevation grids.

Replaces nested Python cell loops with sliced corner arrays + nanmean /
masked sums — typically 10–50× faster on large TIN-resampled meshes.
"""

from __future__ import annotations

from typing import Any

import numpy as np

CF_PER_CY = 27.0


def _nodes_to_array(nodes: list[list[float | None]]) -> np.ndarray:
    """Convert nested list grid (None = hole) to float64 with NaN holes."""
    if not nodes:
        return np.zeros((0, 0), dtype=np.float64)
    return np.array(
        [[np.nan if v is None else float(v) for v in row] for row in nodes],
        dtype=np.float64,
    )


def compare_grids_numpy(existing: dict[str, Any], proposed: dict[str, Any]) -> dict[str, Any]:
    """
    Bank Cubic Yards via bilinear cell averaging on a shared rectangular grid.

    Semantics match the pure-Python / TypeScript compareGrids: a cell is a hole
    if any of its four corners is missing on either surface.
    """
    if existing.get("grid_size") != proposed.get("grid_size"):
        raise ValueError(
            f"grid mismatch: existing={existing.get('grid_size')} proposed={proposed.get('grid_size')}"
        )
    origin_e = existing.get("origin") or [0, 0]
    origin_p = proposed.get("origin") or [0, 0]
    if origin_e[0] != origin_p[0] or origin_e[1] != origin_p[1]:
        raise ValueError("grid origin mismatch")

    g = float(existing["grid_size"])
    cell_area = g * g
    e = _nodes_to_array(existing["nodes"])
    p = _nodes_to_array(proposed["nodes"])
    if e.shape != p.shape:
        raise ValueError("grid shape mismatch")

    n_rows, n_cols = e.shape
    if n_rows < 2 or n_cols < 2:
        return {
            "cut_bcy": 0.0,
            "fill_bcy": 0.0,
            "net_bcy": 0.0,
            "cell_area_sf": cell_area,
            "cells_evaluated": 0,
            "cells_holes": 0,
            "extents_sf": 0.0,
            "worker": "numpy",
        }

    # Four corner slices for every cell — fully vectorized, no Python loop.
    e00, e01 = e[:-1, :-1], e[:-1, 1:]
    e10, e11 = e[1:, :-1], e[1:, 1:]
    p00, p01 = p[:-1, :-1], p[:-1, 1:]
    p10, p11 = p[1:, :-1], p[1:, 1:]

    stacked_e = np.stack([e00, e01, e10, e11], axis=0)
    stacked_p = np.stack([p00, p01, p10, p11], axis=0)
    valid = (~np.isnan(stacked_e).any(axis=0)) & (~np.isnan(stacked_p).any(axis=0))

    dz = (stacked_p - stacked_e).mean(axis=0)
    vol_cy = (cell_area * np.abs(dz)) / CF_PER_CY

    cut = float(np.nansum(np.where(valid & (dz < 0), vol_cy, 0.0)))
    fill = float(np.nansum(np.where(valid & (dz > 0), vol_cy, 0.0)))
    evaluated = int(np.count_nonzero(valid))
    holes = int(valid.size - evaluated)

    return {
        "cut_bcy": round(cut, 3),
        "fill_bcy": round(fill, 3),
        "net_bcy": round(cut - fill, 3),
        "cell_area_sf": cell_area,
        "cells_evaluated": evaluated,
        "cells_holes": holes,
        "extents_sf": round(evaluated * cell_area, 3),
        "worker": "numpy",
    }
