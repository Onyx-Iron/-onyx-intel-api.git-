"""
Civil utility trenching engine — OSHA layback + pipe embedment volumes.
"""

from __future__ import annotations

from pydantic import BaseModel, Field, field_validator

from .deterministic_math import (
    SoilType,
    aggregate_bedding_depth_in,
    osha_layback_ratio,
    parse_soil_type,
    recommended_trench_bottom_width_ft,
    rectangular_excavation_cy,
    trapezoidal_excavation_cy,
    trench_safety_width_offset_ft,
)


class CivilTrenchRequest(BaseModel):
    length_lf: float = Field(gt=0, description="Pipe run length in linear feet")
    pipe_od_in: float = Field(gt=0, description="Pipe outside diameter in inches")
    cover_ft: float = Field(default=4.0, ge=0, description="Cover depth from pipe crown to surface (ft)")
    soil_type: str = Field(default="B", description="OSHA soil classification: A, B, C, or stable_rock")
    trench_width_ft: float | None = Field(default=None, gt=0, description="Override bottom trench width (ft)")
    initial_backfill_in: float = Field(default=12.0, ge=0, description="Clean granular backfill over pipe (in)")
    include_layback: bool = Field(default=True, description="Apply OSHA sloped sides vs vertical walls")

    @field_validator("soil_type")
    @classmethod
    def validate_soil(cls, v: str) -> str:
        parse_soil_type(v)  # raises ValueError if invalid
        return v


class CivilTrenchResult(BaseModel):
    soil_type: str
    layback_ratio: float
    pipe_od_ft: float
    bedding_depth_in: float
    bedding_depth_ft: float
    safety_width_offset_ft: float
    trench_bottom_width_ft: float
    trench_depth_ft: float
    cover_ft: float
    initial_backfill_ft: float
    excavation_bcy: float
    rectangular_excavation_bcy: float
    layback_volume_bcy: float
    top_width_ft: float
    cross_section_sf: float
    layback_offset_ft_per_side: float
    bedding_material_cy: float
    aggregate_import_cy: float


def calc_civil_trench(req: CivilTrenchRequest) -> CivilTrenchResult:
    """
    Compute OSHA-compliant trench excavation with optional sloped sides.

    Trench depth (bottom to surface):
      bedding + pipe OD + initial backfill + cover
    """
    soil = parse_soil_type(req.soil_type)
    layback = osha_layback_ratio(soil)

    bedding_in = aggregate_bedding_depth_in(req.pipe_od_in)
    bedding_ft = bedding_in / 12.0
    pipe_od_ft = req.pipe_od_in / 12.0
    initial_ft = req.initial_backfill_in / 12.0
    safety_offset = trench_safety_width_offset_ft(req.pipe_od_in)

    bottom_width = req.trench_width_ft if req.trench_width_ft else recommended_trench_bottom_width_ft(req.pipe_od_in)
    trench_depth = bedding_ft + pipe_od_ft + initial_ft + req.cover_ft

    rect_bcy = rectangular_excavation_cy(req.length_lf, bottom_width, trench_depth)

    if req.include_layback and layback > 0:
        trap = trapezoidal_excavation_cy(req.length_lf, trench_depth, bottom_width, layback)
        excavation_bcy = trap["excavation_bcy"]
        top_width = trap["top_width_ft"]
        cross_section = trap["cross_section_sf"]
        offset_side = trap["layback_offset_ft_per_side"]
    else:
        excavation_bcy = rect_bcy
        top_width = bottom_width
        cross_section = bottom_width * trench_depth
        offset_side = 0.0

    layback_volume = round(max(0.0, excavation_bcy - rect_bcy), 4)

    bedding_cy = round((req.length_lf * bottom_width * bedding_ft) / 27.0, 4)
    initial_cy = round((req.length_lf * bottom_width * initial_ft) / 27.0, 4)
    aggregate_cy = round(bedding_cy + initial_cy, 4)

    return CivilTrenchResult(
        soil_type=soil.value,
        layback_ratio=layback,
        pipe_od_ft=round(pipe_od_ft, 4),
        bedding_depth_in=round(bedding_in, 2),
        bedding_depth_ft=round(bedding_ft, 4),
        safety_width_offset_ft=round(safety_offset, 4),
        trench_bottom_width_ft=round(bottom_width, 4),
        trench_depth_ft=round(trench_depth, 4),
        cover_ft=req.cover_ft,
        initial_backfill_ft=round(initial_ft, 4),
        excavation_bcy=excavation_bcy,
        rectangular_excavation_bcy=rect_bcy,
        layback_volume_bcy=layback_volume,
        top_width_ft=top_width,
        cross_section_sf=cross_section,
        layback_offset_ft_per_side=offset_side,
        bedding_material_cy=bedding_cy,
        aggregate_import_cy=aggregate_cy,
    )


def plan_footprint_sf(
    centerline: list[tuple[float, float]] | list[list[float]],
    top_width_ft: float,
) -> float:
    """
    GEOS-buffered plan-view trench corridor area (SF) for a single run.

    Uses half of top (layback) width as buffer radius — C-backed Shapely/GEOS.
    """
    from .geos_geometry import trench_buffer_area_sf

    return round(trench_buffer_area_sf(centerline, top_width_ft), 4)


def union_plan_footprints_sf(
    runs: list[tuple[list[tuple[float, float]] | list[list[float]], float]],
) -> float:
    """
    Union overlapping trench corridors and return net plan SF (GEOS unary_union).

    Crossing utilities with layback wedges are counted once instead of double-
    summing pure-Python buffer approximations.
    """
    from .geos_geometry import union_trench_footprints

    return round(union_trench_footprints(runs), 4)
