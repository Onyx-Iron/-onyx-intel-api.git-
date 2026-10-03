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


def schedule_rows_to_lines(rows: list[list]) -> list[dict]:
    """Map a door, rebar, or wall-type schedule onto estimate lines.

    The mark column is the description. Quantity defaults to 1 when the
    schedule has no count column. Unit is EA.
    """
    if not rows:
        return []
    header = [str(cell or "").strip().lower() for cell in rows[0]]

    def column(*names: str) -> int | None:
        for index, label in enumerate(header):
            if any(name in label for name in names):
                return index
        return None

    mark_col = column("mark", "id", "type", "door")
    qty_col = column("qty", "count", "quantity")
    width_col = column("width")
    height_col = column("height")
    code_col = column("cost", "code")
    lines: list[dict] = []
    for row in rows[1:]:
        cells = list(row or [])
        if not any(str(cell or "").strip() for cell in cells):
            continue

        def cell(index: int | None) -> str:
            if index is None or index >= len(cells) or cells[index] is None:
                return ""
            return str(cells[index]).strip()

        quantity = 1.0
        raw_qty = cell(qty_col).replace(",", "")
        if raw_qty:
            try:
                quantity = float(raw_qty)
            except ValueError:
                quantity = 1.0
        description = cell(mark_col) or cell(0)
        if not description:
            continue
        lines.append({
            "description": description,
            "quantity": quantity,
            "unit": "EA",
            "cost_code": cell(code_col),
            "width": cell(width_col),
            "height": cell(height_col),
        })
    return lines


def ocr_image_text(image_path: str) -> str:
    if shutil.which("tesseract") is None:
        raise RuntimeError("Tesseract is not installed. Schedule tables still extract from the PDF text layer.")
    import pytesseract
    from PIL import Image

    return pytesseract.image_to_string(Image.open(Path(image_path)))
