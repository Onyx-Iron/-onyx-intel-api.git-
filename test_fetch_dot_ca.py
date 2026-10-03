import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent / "scripts"))
from fetch_dot_ca import parse_ca_bid_summary, sample_ingest_payload  # noqa: E402


class CaDotParseTests(unittest.TestCase):
    def test_csv_maps_item_prefix_and_does_not_invent_a_split(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "bid.csv"
            path.write_text(
                "item_code,description,unit,avg_unit_price\n"
                "19-100,Roadway Excavation,CY,46.75\n"
                "999-1,Unknown item,EA,10\n",
                encoding="utf-8",
            )
            payload = parse_ca_bid_summary(str(path))
        self.assertEqual(payload["state"], "CA")
        self.assertEqual(len(payload["rows"]), 1)
        row = payload["rows"][0]
        self.assertEqual(row["csi_code"], "31-23-16")
        self.assertEqual(row["unit_cost"], 46.75)
        self.assertEqual(row["uom"], "CY")
        self.assertNotIn("labor_cost", row)

    def test_sample_posts_ingest_shape(self):
        payload = sample_ingest_payload()
        self.assertEqual(payload["state"], "CA")
        self.assertEqual(len(payload["rows"]), 4)
        self.assertIn("observed_at", payload["rows"][0])
        self.assertNotIn("items", payload)

    def test_pdf_without_a_table_raises(self):
        try:
            from PIL import Image
        except ImportError:
            self.skipTest("Pillow not installed")
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "empty.pdf"
            Image.new("RGB", (200, 80), "white").save(path, "PDF")
            with self.assertRaises(ValueError) as caught:
                parse_ca_bid_summary(str(path))
        self.assertIn("No bid-summary table", str(caught.exception))


if __name__ == "__main__":
    unittest.main()
