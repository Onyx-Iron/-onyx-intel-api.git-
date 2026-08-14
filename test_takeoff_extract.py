import unittest
import tempfile
from pathlib import Path

from takeoff_extract import _build_quantity_evidence, _classify, _row, extract_from_xlsx
from takeoff_validator import SecureTakeoffRow


class TakeoffClassificationTests(unittest.TestCase):
    def assert_classification(self, description, code, trade, uom):
        division, actual_code, actual_trade, actual_uom = _classify(description)

        self.assertEqual(actual_code, code)
        self.assertEqual(actual_trade, trade)
        self.assertEqual(actual_uom, uom)
        self.assertEqual(division, code.split("-", 1)[0])

    def test_classifies_common_mep_scope_to_specific_csi_codes(self):
        cases = [
            ("4 inch sanitary waste pipe below slab", "22-13-16", "Plumbing", "LF"),
            ("facility storm drain piping from roof leaders", "22-14-13", "Plumbing", "LF"),
            ("domestic cold water copper pipe", "22-11-16", "Plumbing", "LF"),
            ("rectangular sheet metal ductwork", "23-31-13", "HVAC", "SF"),
            ("refrigerant piping to condensing unit", "23-23-00", "HVAC", "LF"),
            ("panelboard schedule LP-1", "26-24-16", "Electrical", "EA"),
            ("fire alarm pull station", "28-31-00", "Fire Alarm", "EA"),
            ("site storm drain utility main", "33-40-00", "Utilities", "LF"),
        ]

        for description, code, trade, uom in cases:
            with self.subTest(description=description):
                self.assert_classification(description, code, trade, uom)

    def test_rows_keep_extraction_evidence_for_estimator_review(self):
        row = _row(
            "domestic cold water copper pipe",
            142.42,
            "Measured polyline on P2.1",
            drawing_ref="P2.1",
            location_tag="Level 1",
            evidence_spec={
                "source_kind": "geometry",
                "formula_version": "geometry-length-v1",
                "calculation_inputs": {"raw_length": 142.42, "conversion_factor": 1},
                "source_quote": "Measured polyline length 142.42 LF",
                "source_locator": "P2.1 Level 1",
                "original_unit": "LF",
            },
        )

        self.assertEqual(row["cost_code"], "22-11-16")
        self.assertEqual(row["total_qty"], 142.42)
        self.assertEqual(row["uom"], "LF")
        self.assertEqual(row["quantity_basis"], "Measured polyline on P2.1")
        self.assertEqual(row["drawing_ref"], "P2.1")
        self.assertEqual(row["location_tag"], "Level 1")
        self.assertEqual(row["quantity_evidence"]["measurement_class"], "length")
        self.assertEqual(row["quantity_evidence"]["calculation_result"], 142.42)
        self.assertEqual(len(row["quantity_evidence"]["calculation_checksum"]), 64)

    def test_stored_quantity_and_evidence_result_use_the_same_rounding_contract(self):
        row = _row(
            "domestic cold water copper pipe", 1.23456, "Measured length",
            uom="LF", evidence_spec={
                "source_kind": "geometry", "formula_version": "geometry-length-v1",
                "calculation_inputs": {"raw_length": 1.23456, "conversion_factor": 1},
                "source_quote": "Measured raw length 1.23456 LF",
                "source_locator": "DXF layer PIPE", "original_unit": "LF",
            },
        )

        self.assertEqual(row["total_qty"], 1.235)
        self.assertEqual(row["quantity_evidence"]["calculation_result"], row["total_qty"])

    def test_quantity_evidence_has_cross_runtime_checksum(self):
        evidence = _build_quantity_evidence(
            measurement_class="count",
            source_kind="schedule",
            original_unit="EA",
            normalized_unit="EA",
            formula_version="source-text-v1",
            calculation_inputs={"raw_quantity": "12", "parsed_quantity": 12.0},
            calculation_result=12.0,
            source_quote="Door schedule Qty 12",
            source_locator="PDF p.3 col 'Qty'",
        )

        self.assertEqual(
            evidence,
            {
                "measurement_class": "count",
                "source_kind": "schedule",
                "original_unit": "EA",
                "normalized_unit": "EA",
                "formula_version": "source-text-v1",
                "calculation_inputs": {"parsed_quantity": "12", "raw_quantity": "12"},
                "calculation_result": 12.0,
                "source_quote": "Door schedule Qty 12",
                "source_locator": "PDF p.3 col 'Qty'",
                "calculation_checksum": "0cef64a36ef46a2a08d9ab6707002e2651a6a27f055586f5a26e63a2666ec1c4",
            },
        )

    def test_quantity_evidence_checksum_changes_when_inputs_change(self):
        base = dict(
            measurement_class="length",
            source_kind="geometry",
            original_unit="in",
            normalized_unit="LF",
            formula_version="geometry-length-v1",
            calculation_inputs={"raw_length": 120, "conversion_factor": 1 / 12},
            calculation_result=10,
            source_quote="Layer P-PIPE raw length 120 in",
            source_locator="DXF layer P-PIPE",
        )
        original = _build_quantity_evidence(**base)

        for field, value in (
            ("calculation_inputs", {"raw_length": 121, "conversion_factor": 1 / 12}),
            ("calculation_result", 10.1),
            ("normalized_unit", "FT"),
            ("source_quote", "Layer P-PIPE raw length 121 in"),
            ("source_locator", "DXF layer P-PIPE-ALT"),
        ):
            changed = _build_quantity_evidence(**{**base, field: value})
            self.assertNotEqual(original["calculation_checksum"], changed["calculation_checksum"], field)

    def test_secure_validator_preserves_structured_quantity_evidence(self):
        evidence = _build_quantity_evidence(
            measurement_class="count", source_kind="schedule", original_unit="EA",
            normalized_unit="EA", formula_version="source-text-v1",
            calculation_inputs={"raw_quantity": "12", "parsed_quantity": 12},
            calculation_result=12, source_quote="Door schedule Qty 12",
            source_locator="PDF p.3 col 'Qty'",
        )
        row = SecureTakeoffRow.model_validate({
            "trade": "Doors", "cost_code": "08-11-00", "description": "Type A hollow metal door",
            "quantity_basis": "Door schedule", "total_qty": 12, "uom": "EA",
            "quantity_evidence": evidence,
        })

        self.assertEqual(row.model_dump()["quantity_evidence"]["calculation_checksum"], evidence["calculation_checksum"])

    def test_spreadsheet_rows_keep_distinct_cell_provenance_even_when_values_repeat(self):
        import openpyxl

        workbook = openpyxl.Workbook()
        sheet = workbook.active
        sheet.title = "Door Schedule"
        sheet.append(["Description", "Qty", "Unit"])
        sheet.append(["Type A hollow metal door", 12, "EA"])
        sheet.append(["Type A hollow metal door", 12, "EA"])
        handle = tempfile.NamedTemporaryFile(suffix=".xlsx", delete=False)
        handle.close()
        path = Path(handle.name)
        try:
            workbook.save(path)
            result = extract_from_xlsx(str(path))
        finally:
            workbook.close()
            path.unlink(missing_ok=True)

        evidence = [row["quantity_evidence"] for row in result["rows"]]
        self.assertEqual([item["source_locator"] for item in evidence], [
            "Workbook sheet 'Door Schedule' row 2",
            "Workbook sheet 'Door Schedule' row 3",
        ])
        self.assertNotEqual(evidence[0]["calculation_checksum"], evidence[1]["calculation_checksum"])


if __name__ == "__main__":
    unittest.main()
