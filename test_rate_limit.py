import os
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from decimal import Decimal
from pathlib import Path

from takeoff_validator import validate_rows_from_list


class DecimalStreamTests(unittest.TestCase):
    def test_validate_rows_accepts_decimal_quantities(self):
        valid, report = validate_rows_from_list([
            {
                "trade": "Plumbing",
                "cost_code": "22-11-16",
                "description": "Domestic copper pipe",
                "quantity_basis": "Measured polyline",
                "total_qty": Decimal("142.5"),
                "uom": "LF",
            }
        ])
        self.assertEqual(len(valid), 1)
        self.assertEqual(valid[0]["total_qty"], 142.5)
        self.assertEqual(report.status.value, "VERIFIED_SUCCESS")


class SharedRateLimitTests(unittest.TestCase):
    def test_second_connection_sees_the_count(self):
        with tempfile.TemporaryDirectory() as tmp:
            db_path = str(Path(tmp) / "quota.sqlite")
            env = os.environ.copy()
            env["RATE_LIMIT_DB"] = db_path
            env["RATE_LIMIT_ENABLED"] = "true"
            script = (
                "from rate_limiting import check_rate_limit\n"
                "stats = check_rate_limit('tenant-shared')\n"
                "print(stats['requests_current'])\n"
            )
            first = subprocess.run([sys.executable, "-c", script], env=env, capture_output=True, text=True, check=False)
            self.assertEqual(first.returncode, 0, first.stderr)
            self.assertEqual(first.stdout.strip(), "1")

            second = subprocess.run([sys.executable, "-c", script], env=env, capture_output=True, text=True, check=False)
            self.assertEqual(second.returncode, 0, second.stderr)
            self.assertEqual(second.stdout.strip(), "2")

            with sqlite3.connect(db_path) as conn:
                count = conn.execute(
                    "SELECT request_count FROM quotas WHERE tenant_id = ?",
                    ("tenant-shared",),
                ).fetchone()[0]
            self.assertEqual(count, 2)


if __name__ == "__main__":
    unittest.main()
