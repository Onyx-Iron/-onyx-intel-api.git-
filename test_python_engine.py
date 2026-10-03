"""Geometry engine: net area, state plane, TIN volume, symbols, Excel, PDF, tables."""

from __future__ import annotations

import io
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT / "python-engine"))

from services.cad_service import apply_sheet_transform, fit_sheet_transform, to_canvas_feet, transform_points
from services.excel_service import build_estimate_workbook
from services.geometry_service import buffer_centerline, net_area, offset_ring, union_area
from services.ocr_service import extract_schedule_tables, schedule_rows_to_lines
from services.proposal_service import build_proposal_pdf, proposal_totals
from services.terrain_service import contours_to_points, cut_fill_tin, trench_volume
from services.vision_service import count_classes, count_template

import numpy as np
from openpyxl import load_workbook


SQUARE = [(0.0, 0.0), (10.0, 0.0), (10.0, 10.0), (0.0, 10.0)]
HOLE = [(2.0, 2.0), (4.0, 2.0), (4.0, 4.0), (2.0, 4.0)]


class GeometryTests(unittest.TestCase):
    def test_net_area_subtracts_a_shaft(self):
        self.assertAlmostEqual(net_area(SQUARE, [HOLE]), 96.0)

    def test_union_does_not_double_count_overlap(self):
        other = [(5.0, 0.0), (15.0, 0.0), (15.0, 10.0), (5.0, 10.0)]
        self.assertAlmostEqual(union_area([SQUARE, other]), 150.0)

    def test_offset_grows_the_footprint(self):
        grown = offset_ring(SQUARE, 1.0)
        self.assertGreater(grown["area"], 100.0)
        self.assertGreaterEqual(len(grown["rings"]), 1)

    def test_centerline_buffer_is_length_times_width(self):
        paved = buffer_centerline([(0.0, 0.0), (10.0, 0.0)], 0.5)
        self.assertAlmostEqual(paved["area"], 10.0, places=6)
        crossing = [(4.0, -1.0), (6.0, -1.0), (6.0, 1.0), (4.0, 1.0)]
        punched = buffer_centerline([(0.0, 0.0), (10.0, 0.0)], 0.5, [crossing])
        self.assertAlmostEqual(punched["area"], 8.0, places=6)


class CadTests(unittest.TestCase):
    def test_state_plane_round_trip_and_local_origin(self):
        survey = [(-96.8, 32.78), (-96.79, 32.79)]
        projected = transform_points(survey, 4326, 2276)
        back = transform_points(projected, 2276, 4326)
        self.assertAlmostEqual(back[0][0], survey[0][0], places=5)
        self.assertAlmostEqual(back[0][1], survey[0][1], places=5)
        local = to_canvas_feet(survey, 4326, 2276)
        self.assertEqual(local[0], (0.0, 0.0))
        self.assertGreater(abs(local[1][0]) + abs(local[1][1]), 100.0)

    def test_two_point_sheet_tie_maps_the_origin(self):
        transform = fit_sheet_transform((0.0, 0.0), (10.0, 0.0), (100.0, 200.0), (110.0, 200.0))
        mapped = apply_sheet_transform([(0.0, 0.0), (10.0, 0.0)], transform)
        self.assertAlmostEqual(mapped[0][0], 100.0, places=6)
        self.assertAlmostEqual(mapped[0][1], 200.0, places=6)
        self.assertAlmostEqual(mapped[1][0], 110.0, places=6)
        self.assertAlmostEqual(transform["scale"], 1.0, places=6)


class TerrainTests(unittest.TestCase):
    def test_flat_pad_cut_is_one_hundred_cubic_yards(self):
        existing = [(0, 0, 10), (30, 0, 10), (0, 30, 10), (30, 30, 10)]
        proposed = [(0, 0, 7), (30, 0, 7), (0, 30, 7), (30, 30, 7)]
        result = cut_fill_tin(existing, proposed)
        self.assertAlmostEqual(result["cut_cy"], 100.0, places=6)
        self.assertAlmostEqual(result["fill_cy"], 0.0, places=6)
        self.assertEqual(result["method"], "tin_prism")
        self.assertGreater(result["triangles"], 0)
        self.assertEqual(result["mesh_faces"], result["triangles"])
        self.assertEqual(result["low_points"], [])

    def test_boundary_clip_keeps_half_the_pad(self):
        existing = [(0, 0, 10), (30, 0, 10), (0, 30, 10), (30, 30, 10)]
        proposed = [(0, 0, 7), (30, 0, 7), (0, 30, 7), (30, 30, 7)]
        half = [(0, 0), (15, 0), (15, 30), (0, 30)]
        result = cut_fill_tin(existing, proposed, boundary=half)
        self.assertAlmostEqual(result["cut_cy"], 50.0, places=4)
        self.assertTrue(result["clipped"])

    def test_ponding_low_point_and_slope(self):
        existing = [(0, 0, 10), (10, 0, 10), (0, 10, 10), (10, 10, 10), (5, 5, 8)]
        proposed = [(0, 0, 10), (10, 0, 10), (0, 10, 10), (10, 10, 10), (5, 5, 10)]
        result = cut_fill_tin(existing, proposed)
        self.assertGreater(result["steepest_slope_pct"], 0)
        self.assertTrue(any(point["z"] == 8 for point in result["low_points"]))

    def test_contours_and_trench_prism(self):
        points = contours_to_points(
            [{"elevation": 410, "points": [(0, 0), (10, 0)]}],
            [{"x": 5, "y": 5, "elevation": 412.5}],
        )
        self.assertEqual(len(points), 3)
        self.assertEqual(points[0][2], 410)
        self.assertEqual(points[2][2], 412.5)
        prism = trench_volume([(0, 0), (10, 0)], 2, 4, 0.5)
        self.assertAlmostEqual(prism["excavation_cy"], 80 / 27, places=6)
        self.assertAlmostEqual(prism["bedding_cy"], 10 / 27, places=6)
        self.assertAlmostEqual(prism["backfill_cy"], 70 / 27, places=6)


class VisionTests(unittest.TestCase):
    def test_counts_three_symbols_once_each(self):
        def cross(image: np.ndarray, x: int, y: int) -> None:
            image[y + 2:y + 10, x + 5:x + 7] = 255
            image[y + 5:y + 7, x + 2:x + 10] = 255

        sheet = np.zeros((80, 140, 3), dtype=np.uint8)
        template = np.zeros((12, 12, 3), dtype=np.uint8)
        cross(template, 0, 0)
        for x in (10, 40, 90):
            cross(sheet, x, 20)
        result = count_template(sheet, template, threshold=0.85)
        self.assertEqual(result["count"], 3)

    def test_rotation_and_named_classes(self):
        def ell(image: np.ndarray, x: int, y: int) -> None:
            image[y:y + 8, x:x + 2] = 255
            image[y + 6:y + 8, x:x + 8] = 255

        template = np.zeros((8, 8, 3), dtype=np.uint8)
        ell(template, 0, 0)
        upright = np.zeros((40, 40, 3), dtype=np.uint8)
        ell(upright, 4, 4)
        self.assertEqual(count_template(upright, template, threshold=0.9, rotations=(0,))["count"], 1)
        turned = np.zeros((40, 40, 3), dtype=np.uint8)
        ell(turned, 4, 4)
        turned = np.rot90(turned, k=1)
        self.assertEqual(count_template(turned, template, threshold=0.9, rotations=(0,))["count"], 0)
        self.assertEqual(count_template(turned, template, threshold=0.85, rotations=(0, 90, 180, 270))["count"], 1)

        valve = np.zeros((8, 8, 3), dtype=np.uint8)
        valve[1:7, 3:5] = 255
        page = np.zeros((40, 80, 3), dtype=np.uint8)
        ell(page, 4, 8)
        page[8:15, 50:52] = 255
        counted = count_classes(page, {"hydrant": template, "valve": valve}, threshold=0.8)
        self.assertEqual(counted["classes"]["hydrant"]["count"], 1)
        self.assertGreaterEqual(counted["classes"]["valve"]["count"], 1)


class ExportTests(unittest.TestCase):
    def test_workbook_totals_are_formulas(self):
        payload = build_estimate_workbook(
            [{
                "cost_code": "03-30-00",
                "description": "Slab on grade",
                "quantity": 10,
                "unit": "CY",
                "labor_unit": 2,
                "material_unit": 3,
            }],
            {"contingency_pct": 10, "overhead_pct": 5, "profit_pct": 8},
            "Pad",
        )
        book = load_workbook(io.BytesIO(payload))
        schedule = book["Schedule of Values"]
        self.assertEqual(schedule["L2"].value, "=D2*F2")
        self.assertEqual(schedule["R2"].value, "=SUM(L2:Q2)")
        proposal = book["Proposal"]
        self.assertEqual(proposal["B4"].value, "=B3*Settings!B1")
        self.assertTrue(str(proposal["B8"].value).startswith("="))
        prices = book["Unit Prices"]
        self.assertEqual(prices["F2"].value, "=C2*E2")
        self.assertIsNone(prices["E2"].value)
        self.assertEqual(prices["F3"].value, "=SUM(F2:F2)")

    def test_cut_fill_sheet_uses_formulas(self):
        payload = build_estimate_workbook(
            [],
            {},
            "Pad",
            [{"x": 1, "y": 2, "existing_z": 10, "proposed_z": 7}],
        )
        earth = load_workbook(io.BytesIO(payload))["Cut Fill"]
        self.assertEqual(earth["E2"].value, "=D2-C2")
        self.assertEqual(earth["F2"].value, "=IF(E2<0,-E2,0)")
        self.assertEqual(earth["G2"].value, "=IF(E2>0,E2,0)")

    def test_proposal_pdf_matches_the_bid_rollup(self):
        rows = [{"quantity": 10, "labor_unit": 2, "material_unit": 3, "description": "Slab", "cost_code": "03-30-00", "unit": "CY"}]
        settings = {"contingency_pct": 10, "overhead_pct": 5, "profit_pct": 8}
        totals = proposal_totals(rows, settings)
        self.assertAlmostEqual(totals["direct"], 50.0)
        self.assertAlmostEqual(totals["final_bid"], 50 * 1.1 * 1.05 * 1.08)
        pdf = build_proposal_pdf(
            rows,
            settings,
            "Pad",
            alternates=["Add stone base"],
            exclusions=["Permits"],
        )
        self.assertTrue(pdf.startswith(b"%PDF"))
        self.assertIn(b"Alternates", pdf)
        self.assertIn(b"Exclusions", pdf)
        self.assertIn(b"Signature", pdf)


class ScheduleTableTests(unittest.TestCase):
    def test_reads_a_door_schedule_without_a_vision_model(self):
        from reportlab.pdfgen import canvas as pdf_canvas

        with tempfile.NamedTemporaryFile(suffix=".pdf") as handle:
            drawing = pdf_canvas.Canvas(handle.name)
            xs = [72, 180, 300]
            ys = [700, 680, 660]
            for x in xs:
                drawing.line(x, ys[-1], x, ys[0])
            for y in ys:
                drawing.line(xs[0], y, xs[-1], y)
            drawing.drawString(80, 684, "Mark")
            drawing.drawString(190, 684, "Width")
            drawing.drawString(80, 664, "D1")
            drawing.drawString(190, 664, "3'-0\"")
            drawing.save()
            tables = extract_schedule_tables(handle.name)
        self.assertEqual(len(tables), 1)
        self.assertEqual(tables[0]["rows"][1][0], "D1")
        self.assertGreater(len(tables[0]["cells"]), 0)
        lines = schedule_rows_to_lines(tables[0]["rows"])
        self.assertEqual(lines[0]["description"], "D1")
        self.assertEqual(lines[0]["quantity"], 1)
        self.assertEqual(lines[0]["unit"], "EA")
        self.assertEqual(lines[0]["width"], "3'-0\"")


class EngineRouteTests(unittest.TestCase):
    def test_net_area_route(self):
        from fastapi.testclient import TestClient
        import takeoff_api

        client = TestClient(takeoff_api.app)
        response = client.post("/api/geometry/net-area", json={"outer": SQUARE, "holes": [HOLE]})
        self.assertEqual(response.status_code, 200)
        self.assertAlmostEqual(response.json()["area"], 96.0)


class DxfUnionTests(unittest.TestCase):
    def test_overlapping_closed_polylines_use_the_union(self):
        import ezdxf
        from takeoff_extract import extract_from_dxf

        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "slab.dxf"
            doc = ezdxf.new()
            doc.header["$INSUNITS"] = 2
            msp = doc.modelspace()
            msp.add_lwpolyline(SQUARE, close=True, dxfattribs={"layer": "SLAB"})
            msp.add_lwpolyline([(5, 0), (15, 0), (15, 10), (5, 10)], close=True, dxfattribs={"layer": "SLAB"})
            doc.saveas(path)
            result = extract_from_dxf(str(path))
        area_rows = [row for row in result["rows"] if row["uom"] == "SF"]
        self.assertEqual(len(area_rows), 1)
        self.assertAlmostEqual(area_rows[0]["total_qty"], 150.0)


if __name__ == "__main__":
    unittest.main()
