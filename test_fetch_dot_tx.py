import sys
import tempfile
import unittest
from pathlib import Path

from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent / "scripts"))
from fetch_dot_tx import parse_tx_bid_tab, sample_ingest_payload  # noqa: E402


class TxDotParseTests(unittest.TestCase):
    def test_csv_maps_item_prefix_and_does_not_invent_a_split(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "bid.csv"
            path.write_text(
                "item_code,description,unit,avg_unit_price\n"
                "247-203,Flexible Base,CY,41.20\n"
                "999-1,Unknown item,EA,10\n",
                encoding="utf-8",
            )
            payload = parse_tx_bid_tab(str(path))
        self.assertEqual(payload["state"], "TX")
        self.assertEqual(len(payload["rows"]), 1)
        row = payload["rows"][0]
        self.assertEqual(row["csi_code"], "31-23-23")
        self.assertEqual(row["unit_cost"], 41.20)
        self.assertEqual(row["uom"], "CY")
        self.assertNotIn("labor_cost", row)
        self.assertNotIn("material_cost", row)
        self.assertNotIn("equipment_cost", row)

    def test_csv_keeps_an_explicit_split(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "bid.csv"
            path.write_text(
                "csi_code,description,uom,unit_price,labor_cost,material_cost,equipment_cost\n"
                "32-12-16,Hot mix,TON,98.10,18,68.10,12\n",
                encoding="utf-8",
            )
            row = parse_tx_bid_tab(str(path))["rows"][0]
        self.assertEqual(row["labor_cost"], 18)
        self.assertEqual(row["material_cost"], 68.10)
        self.assertEqual(row["equipment_cost"], 12)

    def test_sample_posts_ingest_shape(self):
        payload = sample_ingest_payload()
        self.assertEqual(payload["state"], "TX")
        self.assertEqual(len(payload["rows"]), 4)
        self.assertIn("observed_at", payload["rows"][0])
        self.assertNotIn("items", payload)

    def test_pdf_without_a_table_raises(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "empty.pdf"
            Image.new("RGB", (200, 80), "white").save(path, "PDF")
            with self.assertRaises(ValueError) as caught:
                parse_tx_bid_tab(str(path))
        self.assertIn("No bid-tab table", str(caught.exception))


if __name__ == "__main__":
    unittest.main()
