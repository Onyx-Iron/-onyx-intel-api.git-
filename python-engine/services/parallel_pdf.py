"""
Process-level parallelism for multi-page PDF table extraction.

Each worker re-opens the PDF (spawn-safe; pdfplumber pages are not picklable)
and processes a contiguous page chunk. Prefer this for 10–100 page schedule
sets; Celery still owns cross-job concurrency on Railway.
"""

from __future__ import annotations

import logging
import math
import os
from concurrent.futures import ProcessPoolExecutor, as_completed
from typing import Any

logger = logging.getLogger(__name__)

# Below this page count, process overhead outweighs gain.
_DEFAULT_PARALLEL_MIN_PAGES = 4


def _cpu_workers(requested: int | None = None) -> int:
    env = os.getenv("PDF_EXTRACT_WORKERS") or os.getenv("CELERY_CONCURRENCY")
    if requested is not None and requested > 0:
        n = requested
    elif env and env.isdigit() and int(env) > 0:
        n = int(env)
    else:
        n = os.cpu_count() or 2
    # Cap nested pools inside Celery prefork workers to avoid oversubscription.
    if os.getenv("CELERY_WORKER_NAME") or os.getenv("CELERY_MANGLE_HOSTNAME"):
        n = min(n, max(1, (os.cpu_count() or 2) // 2))
    return max(1, min(n, 16))


def _bootstrap_paths() -> None:
    """Spawn workers start with a clean interpreter — ensure repo + engine imports resolve."""
    import sys
    from pathlib import Path

    here = Path(__file__).resolve()
    engine_dir = here.parents[1]  # python-engine/
    repo_root = here.parents[2]
    for path in (str(repo_root), str(engine_dir)):
        if path not in sys.path:
            sys.path.insert(0, path)


def _extract_page_chunk(payload: tuple[str, list[int], int]) -> dict[str, Any]:
    """
    Top-level worker entry (must be picklable for ProcessPoolExecutor).

    Returns rows + ai_candidate page indices for the given 1-based page list.
    """
    _bootstrap_paths()
    path, page_indices, complexity_limit = payload
    import pdfplumber

    rows: list[dict] = []
    ai_pages: list[int] = []
    pages_with_tables = 0

    # Local import keeps worker startup light and mirrors takeoff_extract rules.
    from takeoff_extract import DESC_HEADERS, QTY_HEADERS, UNIT_HEADERS, _row, _to_float

    with pdfplumber.open(path) as pdf:
        total = len(pdf.pages)
        for idx in page_indices:
            if idx < 1 or idx > total:
                continue
            page = pdf.pages[idx - 1]
            try:
                complexity = len(page.lines) + len(page.curves) + len(page.rects)
            except Exception:
                complexity = 9999

            if complexity > complexity_limit:
                # Drawing page. Geometry is measured from the vectors; do not
                # send the page to a model and do not run the table finder here.
                if hasattr(page, "close"):
                    try:
                        page.close()
                    except Exception:
                        pass
                if hasattr(pdf, "flush_cache"):
                    try:
                        pdf.flush_cache()
                    except Exception:
                        pass
                continue

            try:
                tables = page.extract_tables() or []
            except Exception:
                tables = []

            page_made_rows = False
            for table in tables:
                if not table or len(table) < 2:
                    continue
                header = [(c or "").strip() for c in table[0]]
                desc_col = next((i for i, h in enumerate(header) if DESC_HEADERS.search(h)), 0)
                qty_col = next((i for i, h in enumerate(header) if QTY_HEADERS.search(h)), None)
                unit_col = next((i for i, h in enumerate(header) if UNIT_HEADERS.search(h)), None)
                for raw in table[1:]:
                    if not raw or all((c is None or str(c).strip() == "") for c in raw):
                        continue
                    desc = (raw[desc_col] if desc_col < len(raw) else None) or ""
                    desc = str(desc).replace("\n", " ").strip()
                    if not desc or len(desc) < 2:
                        continue
                    qty = _to_float(raw[qty_col]) if (qty_col is not None and qty_col < len(raw)) else None
                    if qty is None:
                        continue
                    basis = f"Schedule table, p.{idx}, col '{header[qty_col] or 'qty'}'"
                    unit = raw[unit_col] if (unit_col is not None and unit_col < len(raw)) else None
                    rows.append(
                        _row(
                            desc,
                            qty,
                            basis,
                            uom=str(unit) if unit else None,
                            drawing_ref=f"PDF p.{idx}",
                        )
                    )
                    page_made_rows = True

            if page_made_rows:
                pages_with_tables += 1

            if hasattr(page, "close"):
                try:
                    page.close()
                except Exception:
                    pass
            if hasattr(pdf, "flush_cache"):
                try:
                    pdf.flush_cache()
                except Exception:
                    pass

    return {
        "rows": rows,
        "ai_candidate_pages": ai_pages,
        "pages_with_tables": pages_with_tables,
    }


def _chunk_pages(pages: list[int], n_workers: int) -> list[list[int]]:
    if not pages:
        return []
    n_workers = max(1, min(n_workers, len(pages)))
    size = math.ceil(len(pages) / n_workers)
    return [pages[i : i + size] for i in range(0, len(pages), size)]


def extract_pdf_parallel(
    path: str,
    *,
    max_table_pages: int = 30,
    complexity_limit: int = 1200,
    max_workers: int | None = None,
    min_pages_for_pool: int | None = None,
) -> dict[str, Any]:
    """
    Multi-process PDF schedule extract. Falls back to single-process for small PDFs
    or when PDF_EXTRACT_WORKERS=1.
    """
    import pdfplumber

    min_pages = min_pages_for_pool if min_pages_for_pool is not None else _DEFAULT_PARALLEL_MIN_PAGES
    workers = _cpu_workers(max_workers)

    with pdfplumber.open(path) as pdf:
        page_count = len(pdf.pages)

    table_pages = list(range(1, min(page_count, max_table_pages) + 1))
    overflow_ai: list[int] = []

    if workers <= 1 or len(table_pages) < min_pages:
        # Sequential path — reuse chunk worker once for identical semantics.
        single = _extract_page_chunk((path, table_pages, complexity_limit))
        rows = single["rows"]
        ai_pages = sorted(set(single["ai_candidate_pages"]) | set(overflow_ai))
        return {
            "source_type": "pdf",
            "rows": rows,
            "coverage": {
                "page_count": page_count,
                "pages_with_tables": single["pages_with_tables"],
                "rows_extracted": len(rows),
                "parallel_workers": 1,
            },
            "ai_candidate_pages": ai_pages,
        }

    chunks = _chunk_pages(table_pages, workers)
    logger.info(
        "[pdf.parallel] path=%s pages=%d chunks=%d workers=%d",
        path,
        page_count,
        len(chunks),
        workers,
    )

    rows: list[dict] = []
    ai_pages: list[int] = list(overflow_ai)
    pages_with_tables = 0

    # spawn avoids fork+Celery deadlocks when nested under a prefork worker.
    import multiprocessing as mp

    ctx = mp.get_context("spawn")
    with ProcessPoolExecutor(max_workers=len(chunks), mp_context=ctx) as pool:
        futures = [
            pool.submit(_extract_page_chunk, (path, chunk, complexity_limit))
            for chunk in chunks
        ]
        for fut in as_completed(futures):
            part = fut.result()
            rows.extend(part["rows"])
            ai_pages.extend(part["ai_candidate_pages"])
            pages_with_tables += int(part["pages_with_tables"])

    # Stable order: by drawing_ref page hint then description.
    def _sort_key(r: dict) -> tuple:
        ref = str(r.get("drawing_ref") or "")
        return (ref, str(r.get("description") or ""))

    rows.sort(key=_sort_key)
    ai_pages = sorted(set(ai_pages))

    return {
        "source_type": "pdf",
        "rows": rows,
        "coverage": {
            "page_count": page_count,
            "pages_with_tables": pages_with_tables,
            "rows_extracted": len(rows),
            "parallel_workers": len(chunks),
        },
        "ai_candidate_pages": ai_pages,
    }
