import json
import unittest

from enhanced_takeoff_system import CostDatabase, EnhancedDeterministicParser


class SampleCostSplitTests(unittest.TestCase):
    def test_catalog_split_is_used_for_extracted_csi_codes(self):
        raw = json.dumps([
            {
                "trade": "Plumbing",
                "cost_code": "22-11-16",
                "description": "Domestic copper pipe",
                "quantity_basis": "Measured polyline",
                "total_qty": 10,
                "uom": "LF",
            }
        ])
        rows, summary = EnhancedDeterministicParser(raw, CostDatabase()).execute_with_cost_enrichment()
        self.assertEqual(rows[0].estimated_unit_cost, 48.0)
        self.assertEqual(summary["estimated_cost"], 480.0)
        self.assertEqual(summary["cost_breakdown"]["labor"], 220.0)
        self.assertEqual(summary["cost_breakdown"]["material"], 240.0)
        self.assertEqual(summary["cost_breakdown"]["equipment"], 20.0)

    def test_unit_price_without_a_split_stays_material(self):
        db = CostDatabase()
        ref = db.lookup("Concrete", "03-30-00", "Concrete", "US_EAST")
        self.assertIsNotNone(ref)
        ref.labor_cost = 0
        ref.material_cost = 0
        ref.equipment_cost = 0
        raw = json.dumps([
            {
                "trade": "Concrete",
                "cost_code": "03-30-00",
                "description": "Concrete, cast-in-place",
                "quantity_basis": "Truck ticket",
                "total_qty": 2,
                "uom": "CY",
            }
        ])
        rows, summary = EnhancedDeterministicParser(raw, db).execute_with_cost_enrichment()
        self.assertEqual(rows[0].labor_pct, 0)
        self.assertEqual(rows[0].material_pct, 1)
        self.assertEqual(rows[0].equipment_pct, 0)
        self.assertEqual(summary["cost_breakdown"]["material"], summary["estimated_cost"])
        self.assertEqual(summary["cost_breakdown"]["labor"], 0)


if __name__ == "__main__":
    unittest.main()
