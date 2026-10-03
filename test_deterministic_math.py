"""Tests for OSHA civil trench deterministic math."""

from __future__ import annotations

import unittest

from services.civil_utility import CivilTrenchRequest, calc_civil_trench
from services.deterministic_math import (
    SoilType,
    aggregate_bedding_depth_in,
    osha_layback_ratio,
    recommended_trench_bottom_width_ft,
    trapezoidal_excavation_cy,
    trench_safety_width_offset_ft,
)


class OshaSlopeTests(unittest.TestCase):
    def test_type_a_slope_ratio(self) -> None:
        self.assertEqual(osha_layback_ratio(SoilType.TYPE_A), 0.75)

    def test_type_b_slope_ratio(self) -> None:
        self.assertEqual(osha_layback_ratio(SoilType.TYPE_B), 1.0)

    def test_type_c_slope_ratio(self) -> None:
        self.assertEqual(osha_layback_ratio(SoilType.TYPE_C), 1.5)

    def test_stable_rock_vertical(self) -> None:
        self.assertEqual(osha_layback_ratio(SoilType.STABLE_ROCK), 0.0)


class BeddingAndSafetyTests(unittest.TestCase):
    def test_bedding_minimum_4_in(self) -> None:
        self.assertEqual(aggregate_bedding_depth_in(8.0), 4.0)

    def test_bedding_scales_with_large_pipe(self) -> None:
        self.assertEqual(aggregate_bedding_depth_in(48.0), 6.0)

    def test_safety_width_offset_12_in_minimum(self) -> None:
        # 12 in total beyond pipe OD for small pipe
        self.assertAlmostEqual(trench_safety_width_offset_ft(6.0), 2.0, places=2)

    def test_recommended_bottom_width_includes_pipe(self) -> None:
        width = recommended_trench_bottom_width_ft(12.0)
        self.assertGreater(width, 12.0 / 12.0)


class TrapezoidalVolumeTests(unittest.TestCase):
    def test_trapezoid_exceeds_rectangle_for_sloped_sides(self) -> None:
        rect_depth = 6.0
        bottom = 3.0
        length = 100.0
        trap = trapezoidal_excavation_cy(length, rect_depth, bottom, 1.0)
        rect_cy = (length * bottom * rect_depth) / 27.0
        self.assertGreater(trap["excavation_bcy"], rect_cy)
        self.assertAlmostEqual(trap["top_width_ft"], bottom + 2 * rect_depth * 1.0)


class CivilTrenchIntegrationTests(unittest.TestCase):
    def test_type_b_100ft_8in_pipe(self) -> None:
        result = calc_civil_trench(CivilTrenchRequest(
            length_lf=100.0,
            pipe_od_in=8.0,
            cover_ft=4.0,
            soil_type="B",
        ))
        self.assertEqual(result.soil_type, "B")
        self.assertEqual(result.layback_ratio, 1.0)
        self.assertGreater(result.excavation_bcy, result.rectangular_excavation_bcy)
        self.assertGreater(result.layback_volume_bcy, 0.0)
        self.assertGreater(result.bedding_material_cy, 0.0)

    def test_type_c_has_larger_layback_than_type_a(self) -> None:
        base = dict(length_lf=50.0, pipe_od_in=12.0, cover_ft=4.0)
        type_a = calc_civil_trench(CivilTrenchRequest(**base, soil_type="A"))
        type_c = calc_civil_trench(CivilTrenchRequest(**base, soil_type="C"))
        self.assertGreater(type_c.excavation_bcy, type_a.excavation_bcy)

    def test_stable_rock_no_layback_volume(self) -> None:
        result = calc_civil_trench(CivilTrenchRequest(
            length_lf=50.0,
            pipe_od_in=8.0,
            soil_type="stable_rock",
        ))
        self.assertEqual(result.layback_ratio, 0.0)
        self.assertEqual(result.layback_volume_bcy, 0.0)
        self.assertAlmostEqual(result.excavation_bcy, result.rectangular_excavation_bcy)

    def test_vertical_walls_when_layback_disabled(self) -> None:
        result = calc_civil_trench(CivilTrenchRequest(
            length_lf=50.0,
            pipe_od_in=8.0,
            soil_type="C",
            include_layback=False,
        ))
        self.assertEqual(result.layback_volume_bcy, 0.0)
        self.assertAlmostEqual(result.excavation_bcy, result.rectangular_excavation_bcy)


if __name__ == "__main__":
    unittest.main()
