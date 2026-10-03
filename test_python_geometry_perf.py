"""Tests for NumPy cut/fill, Shapely/GEOS geometry, and parallel PDF helpers."""

from __future__ import annotations

import unittest

from services.civil_utility import plan_footprint_sf, union_plan_footprints_sf
from services.geos_geometry import (
    GEOS_SPEEDUPS_ACTIVE,
    polygon_area,
    polygon_intersection_area,
    unary_union_area,
)
from services.parallel_dxf import _chunk_ranges, _cpu_workers as _dxf_cpu_workers
from services.parallel_pdf import _chunk_pages, _cpu_workers
from services.terrain_numpy import compare_grids_numpy


class GeosGeometryTests(unittest.TestCase):
    def test_geos_active(self) -> None:
        self.assertTrue(GEOS_SPEEDUPS_ACTIVE)

    def test_unit_square_area(self) -> None:
        self.assertAlmostEqual(polygon_area([(0, 0), (1, 0), (1, 1), (0, 1)]), 1.0, places=6)

    def test_unary_union_dedupes_overlap(self) -> None:
        a = [(0, 0), (2, 0), (2, 2), (0, 2)]
        b = [(1, 1), (3, 1), (3, 3), (1, 3)]
        # Separate sum = 4+4=8; union of overlapping 2×2 squares = 7
        self.assertAlmostEqual(unary_union_area([a, b]), 7.0, places=5)

    def test_intersection_area(self) -> None:
        a = [(0, 0), (2, 0), (2, 2), (0, 2)]
        b = [(1, 1), (3, 1), (3, 3), (1, 3)]
        self.assertAlmostEqual(polygon_intersection_area(a, b), 1.0, places=5)


class TrenchBufferTests(unittest.TestCase):
    def test_straight_run_footprint(self) -> None:
        # 100 ft centerline, 4 ft top width → ≈ 400 SF (flat caps slightly less/more)
        area = plan_footprint_sf([(0.0, 0.0), (100.0, 0.0)], 4.0)
        self.assertGreater(area, 350.0)
        self.assertLess(area, 450.0)

    def test_union_less_than_sum_when_crossing(self) -> None:
        run_a = ([(0.0, 0.0), (50.0, 0.0)], 6.0)
        run_b = ([(25.0, -25.0), (25.0, 25.0)], 6.0)
        a = plan_footprint_sf(*run_a)
        b = plan_footprint_sf(*run_b)
        union = union_plan_footprints_sf([run_a, run_b])
        self.assertLess(union, a + b)
        self.assertGreater(union, max(a, b))


class TerrainNumpyTests(unittest.TestCase):
    def test_cut_matches_known_volume(self) -> None:
        existing = {
            "grid_size": 10.0,
            "origin": [0.0, 0.0],
            "nodes": [[10.0, 10.0], [10.0, 10.0]],
        }
        proposed = {
            "grid_size": 10.0,
            "origin": [0.0, 0.0],
            "nodes": [[7.0, 7.0], [7.0, 7.0]],
        }
        result = compare_grids_numpy(existing, proposed)
        self.assertEqual(result["cells_evaluated"], 1)
        self.assertAlmostEqual(result["cut_bcy"], 100 * 3 / 27, places=2)
        self.assertEqual(result["worker"], "numpy")

    def test_holes_skipped(self) -> None:
        existing = {
            "grid_size": 5.0,
            "origin": [0, 0],
            "nodes": [[1.0, None], [1.0, 1.0]],
        }
        proposed = {
            "grid_size": 5.0,
            "origin": [0, 0],
            "nodes": [[2.0, 2.0], [2.0, 2.0]],
        }
        result = compare_grids_numpy(existing, proposed)
        self.assertEqual(result["cells_evaluated"], 0)
        self.assertEqual(result["cells_holes"], 1)

    def test_large_grid_vectorized(self) -> None:
        n = 64
        flat = [[0.0] * n for _ in range(n)]
        raised = [[1.0] * n for _ in range(n)]
        result = compare_grids_numpy(
            {"grid_size": 2.0, "origin": [0, 0], "nodes": flat},
            {"grid_size": 2.0, "origin": [0, 0], "nodes": raised},
        )
        cells = (n - 1) * (n - 1)
        self.assertEqual(result["cells_evaluated"], cells)
        self.assertGreater(result["fill_bcy"], 0)
        self.assertEqual(result["cut_bcy"], 0.0)


class ParallelPdfHelperTests(unittest.TestCase):
    def test_chunk_pages(self) -> None:
        chunks = _chunk_pages(list(range(1, 11)), 3)
        self.assertEqual(sum(len(c) for c in chunks), 10)
        self.assertLessEqual(len(chunks), 3)

    def test_cpu_workers_at_least_one(self) -> None:
        self.assertGreaterEqual(_cpu_workers(1), 1)


class ParallelDxfHelperTests(unittest.TestCase):
    def test_chunk_ranges_cover_all(self) -> None:
        ranges = _chunk_ranges(100, 4)
        self.assertEqual(ranges[0][0], 0)
        self.assertEqual(ranges[-1][1], 100)
        covered = sum(b - a for a, b in ranges)
        self.assertEqual(covered, 100)

    def test_dxf_cpu_workers(self) -> None:
        self.assertGreaterEqual(_dxf_cpu_workers(2), 1)

    def test_extract_dxf_parallel_on_minimal_drawing(self) -> None:
        """End-to-end: write a tiny DXF, extract via parallel path (1 worker)."""
        import tempfile
        from pathlib import Path

        import ezdxf

        from services.parallel_dxf import extract_dxf_parallel

        doc = ezdxf.new()
        msp = doc.modelspace()
        msp.add_line((0, 0), (10, 0), dxfattribs={"layer": "PIPE"})
        msp.add_lwpolyline(
            [(0, 0), (10, 0), (10, 5), (0, 5)],
            close=True,
            dxfattribs={"layer": "PAD"},
        )
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "tiny.dxf"
            doc.saveas(path)
            result = extract_dxf_parallel(str(path), max_workers=1, min_entities_for_pool=10_000)
        self.assertEqual(result["source_type"], "dxf")
        self.assertGreaterEqual(result["coverage"]["rows_extracted"], 2)
        self.assertEqual(result["coverage"]["geometry_engine"], "geos")
        self.assertEqual(result["coverage"]["parallel_workers"], 1)
        uoms = {r["uom"] for r in result["rows"]}
        self.assertIn("LF", uoms)
        self.assertIn("SF", uoms)

    def test_extract_dxf_forces_process_pool(self) -> None:
        """With min_entities_for_pool=1, a multi-entity DXF uses ProcessPool."""
        import tempfile
        from pathlib import Path

        import ezdxf

        from services.parallel_dxf import extract_dxf_parallel

        doc = ezdxf.new()
        doc.header["$INSUNITS"] = 2  # feet
        msp = doc.modelspace()
        for i in range(8):
            msp.add_line((0, i), (10, i), dxfattribs={"layer": "RUNS"})
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "pool.dxf"
            doc.saveas(path)
            result = extract_dxf_parallel(str(path), max_workers=2, min_entities_for_pool=1)
        self.assertGreaterEqual(result["coverage"]["parallel_workers"], 2)
        self.assertEqual(result["coverage"]["entity_count"], 8)
        lf_rows = [r for r in result["rows"] if r["uom"] == "LF"]
        self.assertEqual(len(lf_rows), 1)
        self.assertAlmostEqual(lf_rows[0]["total_qty"], 80.0, places=3)


if __name__ == "__main__":
    unittest.main()
