"""Schedule tables read from the PDF text layer.

pdfplumber returns the cell grid and each cell's box. The strings can be
handed to a later model without sending the sheet image. Tesseract is used
only when the binary is installed; the table path does not require it.
"""

from __future__ import annotations

import shutil
from pathlib import Path


def extract_schedule_tables(pdf_path: str) -> list[dict]:
    import pdfplumber

    tables: list[dict] = []
    with pdfplumber.open(pdf_path) as pdf:
        for page_number, page in enumerate(pdf.pages, start=1):
            for found in page.find_tables() or []:
                rows = found.extract() or []
                cells = []
                for cell in found.cells or []:
                    if isinstance(cell, (list, tuple)) and len(cell) >= 4:
                        x0, y0, x1, y1 = cell[:4]
                        cells.append({
                            "x0": float(x0),
                            "y0": float(y0),
                            "x1": float(x1),
                            "y1": float(y1),
                        })
                tables.append({
                    "page": page_number,
                    "bbox": [float(v) for v in found.bbox],
                    "rows": rows,
                    "cells": cells,
                })
    return tables


def ocr_image_text(image_path: str) -> str:
    if shutil.which("tesseract") is None:
        raise RuntimeError("Tesseract is not installed. Schedule tables still extract from the PDF text layer.")
    import pytesseract
    from PIL import Image

    return pytesseract.image_to_string(Image.open(Path(image_path)))
