"""Tests for live Excel estimate export and Brotli middleware helpers."""

from __future__ import annotations

import gzip
import unittest
from io import BytesIO

from openpyxl import load_workbook

from services.estimate_excel import build_estimate_workbook


class EstimateExcelFormulaTests(unittest.TestCase):
    def test_workbook_contains_live_formulas(self) -> None:
        raw = build_estimate_workbook(
            {
                "project_name": "Demo Job",
                "overhead_pct": 10,
                "profit_pct": 8,
                "contingency_pct": 5,
                "rows": [
                    {
                        "cost_code": "03-30-00",
                        "description": "Slab on grade",
                        "quantity": 100,
                        "unit": "CY",
                        "labor_unit": 25,
                        "material_unit": 140,
                        "equipment_unit": 10,
                        "subcontractor_unit": 0,
                        "trucking_unit": 0,
                        "disposal_unit": 0,
                    },
                    {
                        "cost_code": "03-20-00",
                        "description": "Rebar",
                        "quantity": 2000,
                        "unit": "LB",
                        "labor_unit": 0.4,
                        "material_unit": 0.85,
                        "equipment_unit": 0,
                        "subcontractor_unit": 0,
                        "trucking_unit": 0,
                        "disposal_unit": 0,
                    },
                ],
            }
        )
        wb = load_workbook(BytesIO(raw))
        sov = wb["Schedule of Values"]
        # Row 4 is first data row — Direct should be a SUM formula
        self.assertTrue(str(sov["R4"].value).startswith("="))
        self.assertIn("*", str(sov["L4"].value))
        prop = wb["Proposal"]
        self.assertTrue(str(prop["B4"].value).startswith("=") or str(prop["B9"].value).startswith("="))


class BrotliMiddlewareTests(unittest.TestCase):
    def test_gzip_fallback_compresses_json(self) -> None:
        from services.brotli_middleware import BrotliGzipMiddleware

        body = b'{"coords":[' + b"1.234567," * 200 + b"0]}"
        captured: dict = {}

        async def app(scope, receive, send):  # noqa: ANN001
            await send(
                {
                    "type": "http.response.start",
                    "status": 200,
                    "headers": [(b"content-type", b"application/json")],
                }
            )
            await send({"type": "http.response.body", "body": body})

        async def run() -> None:
            messages = []

            async def send(message):  # noqa: ANN001
                messages.append(message)

            async def receive():  # noqa: ANN001
                return {"type": "http.disconnect"}

            mw = BrotliGzipMiddleware(app, minimum_size=64)
            scope = {
                "type": "http",
                "headers": [(b"accept-encoding", b"gzip")],
            }
            await mw(scope, receive, send)
            start = next(m for m in messages if m["type"] == "http.response.start")
            enc = dict(start["headers"]).get(b"content-encoding")
            self.assertEqual(enc, b"gzip")
            out = next(m for m in messages if m["type"] == "http.response.body")["body"]
            self.assertEqual(gzip.decompress(out), body)
            captured["ok"] = True

        import asyncio

        asyncio.run(run())
        self.assertTrue(captured.get("ok"))


if __name__ == "__main__":
    unittest.main()
