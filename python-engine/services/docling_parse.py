"""Optional Docling text-PDF parser (XD-01 spike).

Docling is a heavy optional dependency (see requirements-docling.txt).
This module never imports it at module load — callers check
`docling_available()` first. Used by POST /api/parse/docling for
text-layer specs/schedules; keep Gemini for drawings and pdfplumber
for deterministic takeoff tables.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any


@dataclass
class DoclingParseResult:
    status: str
    page_count: int | None = None
    markdown: str | None = None
    text_preview: str | None = None
    blocks: list[dict[str, Any]] = field(default_factory=list)
    metadata: dict[str, Any] = field(default_factory=dict)
    parser_id: str = "docling"


def docling_available() -> bool:
    try:
        import docling  # noqa: F401
        return True
    except ImportError:
        return False


def parse_pdf_with_docling(path: str | Path, *, max_preview_chars: int = 3000) -> DoclingParseResult:
    """Parse a text-layer PDF into Markdown + coarse blocks.

    Raises ImportError when Docling is not installed.
    """
    path = Path(path)
    if not path.exists():
        return DoclingParseResult(status="error", metadata={"error": f"missing file: {path}"})

    try:
        from docling.document_converter import DocumentConverter
    except ImportError as exc:
        raise ImportError(
            "docling is not installed; pip install -r requirements-docling.txt"
        ) from exc

    converter = DocumentConverter()
    result = converter.convert(str(path))
    doc = result.document

    markdown = ""
    try:
        markdown = doc.export_to_markdown() or ""
    except Exception as exc:  # noqa: BLE001 — spike: surface as metadata
        return DoclingParseResult(
            status="parse_error",
            metadata={"error": f"export_to_markdown failed: {exc}"},
        )

    page_count: int | None = None
    blocks: list[dict[str, Any]] = []
    try:
        # Best-effort page count / block listing; Docling versions differ.
        pages = getattr(doc, "pages", None) or getattr(doc, "page_count", None)
        if isinstance(pages, int):
            page_count = pages
        elif pages is not None:
            page_count = len(pages)

        texts = getattr(doc, "texts", None) or []
        for i, t in enumerate(list(texts)[:200]):
            content = getattr(t, "text", None) or str(t)
            page_no = getattr(t, "page_no", None) or getattr(t, "prov", None)
            blocks.append({
                "index": i,
                "text": content[:2000] if isinstance(content, str) else str(content)[:2000],
                "page": page_no if isinstance(page_no, int) else None,
            })
    except Exception:  # noqa: BLE001
        pass

    preview = markdown[:max_preview_chars] if markdown else None
    # Surface Markdown ATX headings as coarse heading_path candidates for RAG.
    headings: list[str] = []
    for line in (markdown or "").splitlines():
        s = line.strip()
        if s.startswith("#"):
            title = s.lstrip("#").strip()
            if title:
                headings.append(title)
    return DoclingParseResult(
        status="parsed" if markdown.strip() else "empty",
        page_count=page_count,
        markdown=markdown or None,
        text_preview=preview,
        blocks=blocks,
        metadata={
            "parser_id": "docling",
            "markdown_chars": len(markdown),
            "block_count": len(blocks),
            "headings": headings[:40],
        },
    )
