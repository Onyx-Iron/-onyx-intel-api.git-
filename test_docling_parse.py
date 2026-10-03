"""XD-01 Docling spike tests — skip when the optional dep is absent."""

from __future__ import annotations

import os
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT / "python-engine"))

from services.docling_parse import docling_available, parse_pdf_with_docling  # noqa: E402


def _tiny_text_pdf() -> bytes:
    """Minimal PDF with a text layer (no external deps)."""
    return b"""%PDF-1.1
1 0 obj<< /Type /Catalog /Pages 2 0 R >>endobj
2 0 obj<< /Type /Pages /Kids [3 0 R] /Count 1 >>endobj
3 0 obj<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 144] /Contents 4 0 R /Resources<< /Font<< /F1 5 0 R >> >> >>endobj
4 0 obj<< /Length 55 >>stream
BT /F1 24 Tf 50 80 Td (Hello Docling) Tj ET
endstream
endobj
5 0 obj<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>endobj
xref
0 6
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
0000000115 00000 n 
0000000266 00000 n 
0000000371 00000 n 
trailer<< /Size 6 /Root 1 0 R >>
startxref
448
%%EOF
"""


class DoclingAvailabilityTests(unittest.TestCase):
    def test_availability_is_bool(self):
        self.assertIsInstance(docling_available(), bool)


@unittest.skipUnless(
    docling_available() or os.environ.get("FORCE_DOCLING_TEST") == "1",
    "docling not installed (pip install -r requirements-docling.txt)",
)
class DoclingParseTests(unittest.TestCase):
    def test_parse_tiny_text_pdf(self):
        raw = _tiny_text_pdf()
        with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
            tmp.write(raw)
            tmp_path = tmp.name
        try:
            result = parse_pdf_with_docling(tmp_path)
        finally:
            Path(tmp_path).unlink(missing_ok=True)

        self.assertIn(result.status, {"parsed", "empty", "parse_error"})
        self.assertEqual(result.parser_id, "docling")
        if result.status == "parsed":
            self.assertTrue(result.text_preview or result.markdown)


if __name__ == "__main__":
    unittest.main()
