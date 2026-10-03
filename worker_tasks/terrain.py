"""Celery tasks: grid-based terrain cut/fill (Railway CPU, not Vercel)."""

from __future__ import annotations

import logging
from typing import Any

from celery_app import celery

logger = logging.getLogger(__name__)


def compare_grids(existing: dict[str, Any], proposed: dict[str, Any]) -> dict[str, Any]:
    """
    Port of portal/lib/math/earthwork.ts compareGrids — Bank Cubic Yards via
    bilinear cell averaging on a shared rectangular grid.
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
    rows_e: list[list[float | None]] = existing["nodes"]
    rows_p: list[list[float | None]] = proposed["nodes"]
    if len(rows_e) != len(rows_p) or (rows_e and len(rows_e[0]) != len(rows_p[0])):
        raise ValueError("grid shape mismatch")

    cut = 0.0
    fill = 0.0
    evaluated = 0
    holes = 0
    n_rows = len(rows_e)
    n_cols = len(rows_e[0]) if n_rows else 0

    for y in range(n_rows - 1):
        for x in range(n_cols - 1):
            corners_e = [
                rows_e[y][x],
                rows_e[y][x + 1],
                rows_e[y + 1][x],
                rows_e[y + 1][x + 1],
            ]
            corners_p = [
                rows_p[y][x],
                rows_p[y][x + 1],
                rows_p[y + 1][x],
                rows_p[y + 1][x + 1],
            ]
            if any(v is None for v in corners_e) or any(v is None for v in corners_p):
                holes += 1
                continue
            dz = sum((float(p) - float(e)) for e, p in zip(corners_e, corners_p)) / 4.0
            vol_cy = (cell_area * abs(dz)) / 27.0
            if dz < 0:
                cut += vol_cy
            elif dz > 0:
                fill += vol_cy
            evaluated += 1

    return {
        "cut_bcy": round(cut, 3),
        "fill_bcy": round(fill, 3),
        "net_bcy": round(cut - fill, 3),
        "cell_area_sf": cell_area,
        "cells_evaluated": evaluated,
        "cells_holes": holes,
        "extents_sf": round(evaluated * cell_area, 3),
        "worker": "celery",
    }


@celery.task(bind=True, name="worker_tasks.terrain.cutfill_grids")
def cutfill_grids(self, payload: dict[str, Any]) -> dict[str, Any]:
    """Run cut/fill on two grid surfaces — intended for large TIN-resampled meshes."""
    if self.request.id:
        self.update_state(state="STARTED", meta={"phase": "compare_grids"})
    existing = payload.get("existing") or {}
    proposed = payload.get("proposed") or {}
    result = compare_grids(existing, proposed)
    result["job_meta"] = {
        "project_id": payload.get("project_id"),
        "surface_pair": payload.get("label"),
    }
    logger.info(
        "[celery.terrain] cut=%.1f fill=%.1f cells=%d",
        result["cut_bcy"],
        result["fill_bcy"],
        result["cells_evaluated"],
    )
    return result
