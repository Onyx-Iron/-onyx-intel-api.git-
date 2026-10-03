"""
Deterministic civil / trench math — OSHA 29 CFR 1926 Subpart P Appendix B
allowable slopes for Type A, B, and C soils.
"""

from __future__ import annotations

from enum import Enum
from typing import Literal

CF_PER_CY = 27


class SoilType(str, Enum):
    TYPE_A = "A"
    TYPE_B = "B"
    TYPE_C = "C"
    STABLE_ROCK = "stable_rock"


# OSHA Appendix B — maximum allowable slopes (horizontal : vertical)
# Expressed as horizontal run per 1 ft vertical depth.
OSHA_SLOPE_RATIO: dict[SoilType, float] = {
    SoilType.TYPE_A: 0.75,       # 3/4:1
    SoilType.TYPE_B: 1.0,        # 1:1
    SoilType.TYPE_C: 1.5,        # 1-1/2:1
    SoilType.STABLE_ROCK: 0.0,   # vertical — no layback
}


def osha_layback_ratio(soil_type: SoilType) -> float:
    """Horizontal offset (ft) per 1 ft of trench depth for the given soil type."""
    return OSHA_SLOPE_RATIO[soil_type]


def aggregate_bedding_depth_in(pipe_od_in: float) -> float:
    """
    Structural bedding depth under the pipe invert.
    ASTM D2321 minimum: 4 in, or 1/8 of pipe OD, whichever is greater.
    """
    return max(4.0, pipe_od_in / 8.0)


def trench_safety_width_offset_ft(pipe_od_in: float) -> float:
    """
    Minimum working-room offset beyond pipe OD on each side (ft).
    Standard utility trench: pipe OD + 12 in each side minimum.
    Returns total width ADD beyond pipe OD (both sides combined).
    """
    return max(12.0, pipe_od_in * 0.5) / 12.0 * 2.0


def recommended_trench_bottom_width_ft(pipe_od_in: float, extra_working_room_ft: float = 0.0) -> float:
    """Pipe outside diameter plus OSHA working-room offsets."""
    pipe_od_ft = pipe_od_in / 12.0
    safety_offset = trench_safety_width_offset_ft(pipe_od_in)
    return round(pipe_od_ft + safety_offset + extra_working_room_ft, 4)


def trapezoidal_excavation_cy(
    length_lf: float,
    depth_ft: float,
    bottom_width_ft: float,
    layback_ratio: float,
) -> dict[str, float]:
    """
    Compute sloped-trench excavation volume (bank cubic yards).

    Cross-section is a trapezoid:
      top_width = bottom_width + 2 * depth * layback_ratio
      area = (bottom + top) / 2 * depth
    """
    if length_lf <= 0 or depth_ft <= 0 or bottom_width_ft <= 0:
        return {
            "excavation_bcy": 0.0,
            "bottom_width_ft": bottom_width_ft,
            "top_width_ft": bottom_width_ft,
            "cross_section_sf": 0.0,
            "layback_offset_ft_per_side": 0.0,
        }

    offset_per_side = depth_ft * layback_ratio
    top_width = bottom_width_ft + 2.0 * offset_per_side
    cross_section_sf = (bottom_width_ft + top_width) / 2.0 * depth_ft
    volume_cf = cross_section_sf * length_lf
    volume_cy = volume_cf / CF_PER_CY

    return {
        "excavation_bcy": round(volume_cy, 4),
        "bottom_width_ft": round(bottom_width_ft, 4),
        "top_width_ft": round(top_width, 4),
        "cross_section_sf": round(cross_section_sf, 4),
        "layback_offset_ft_per_side": round(offset_per_side, 4),
    }


def rectangular_excavation_cy(length_lf: float, width_ft: float, depth_ft: float) -> float:
    """Vertical-walled trench prism (no layback) in bank cubic yards."""
    if length_lf <= 0 or width_ft <= 0 or depth_ft <= 0:
        return 0.0
    return round((length_lf * width_ft * depth_ft) / CF_PER_CY, 4)


def parse_soil_type(value: str) -> SoilType:
    normalized = value.strip().upper().replace("TYPE_", "").replace("TYPE ", "")
    mapping: dict[str, SoilType] = {
        "A": SoilType.TYPE_A,
        "B": SoilType.TYPE_B,
        "C": SoilType.TYPE_C,
        "STABLE_ROCK": SoilType.STABLE_ROCK,
        "STABLE ROCK": SoilType.STABLE_ROCK,
        "ROCK": SoilType.STABLE_ROCK,
    }
    if normalized not in mapping:
        raise ValueError(f"Unknown soil type '{value}'. Expected A, B, C, or stable_rock.")
    return mapping[normalized]
