"""Unit tests for text-density routing helper (no Docling required)."""

from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT / "python-engine"))

from services.text_density import heading_path_before, score_pdf_text_density  # noqa: E402


def _text_pdf(body: bytes = b"Hello specification Division 09 flooring") -> bytes:
    # Minimal PDF; pdfplumber may or may not extract our custom stream text
    # depending on encoding — tests assert shape, not exact char counts.
    return b"""%PDF-1.1
1 0 obj<< /Type /Catalog /Pages 2 0 R >>endobj
2 0 obj<< /Type /Pages /Kids [3 0 R] /Count 1 >>endobj
3 0 obj<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 144] /Contents 4 0 R /Resources<< /Font<< /F1 5 0 R >> >> >>endobj
4 0 obj<< /Length 68 >>stream
BT /F1 12 Tf 40 80 Td (Hello specification Division 09 flooring) Tj ET
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
0000000385 00000 n 
trailer<< /Size 6 /Root 1 0 R >>
startxref
462
%%EOF
"""


class TextDensityTests(unittest.TestCase):
    def test_score_returns_shape(self):
        try:
            import pdfplumber  # noqa: F401
        except ImportError:
            self.skipTest("pdfplumber not installed in this environment")

        raw = _text_pdf()
        with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
            tmp.write(raw)
            path = tmp.name
        try:
            dens = score_pdf_text_density(path, min_chars=10)
        finally:
            Path(path).unlink(missing_ok=True)

        self.assertGreaterEqual(dens.page_count, 1)
        self.assertIsInstance(dens.char_count, int)
        self.assertIsInstance(dens.is_text_rich, bool)
        self.assertIsInstance(dens.chars_per_page, float)

    def test_heading_path_breadcrumb(self):
        md = "# Spec Book\n## Division 09\n### Flooring\n\nVinyl tile shall be...\n"
        chunk = "Vinyl tile shall be..."
        path = heading_path_before(md, chunk)
        self.assertEqual(path, ["Spec Book", "Division 09", "Flooring"])


if __name__ == "__main__":
    unittest.main()
