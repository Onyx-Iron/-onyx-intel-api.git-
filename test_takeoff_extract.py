import unittest

from takeoff_extract import _classify, _row


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
        )

        self.assertEqual(row["cost_code"], "22-11-16")
        self.assertEqual(row["total_qty"], 142.42)
        self.assertEqual(row["uom"], "LF")
        self.assertEqual(row["quantity_basis"], "Measured polyline on P2.1")
        self.assertEqual(row["drawing_ref"], "P2.1")
        self.assertEqual(row["location_tag"], "Level 1")


if __name__ == "__main__":
    unittest.main()
