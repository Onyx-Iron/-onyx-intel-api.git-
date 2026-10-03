"""Cheap text-layer density scoring for Docling vs Gemini routing (XD-01/02).

Uses pdfplumber (already in requirements.txt). No Docling import here —
callers decide whether to invoke Docling when `is_text_rich` is true.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path


# Default: a single construction plan page with a real text layer usually
# yields well above this; scanned drawings often land near zero.
DEFAULT_MIN_CHARS = 400


@dataclass(frozen=True)
class TextDensity:
    char_count: int
    page_count: int
    chars_per_page: float
    is_text_rich: bool
    sample: str


def score_pdf_text_density(
    path: str | Path,
    *,
    min_chars: int = DEFAULT_MIN_CHARS,
    max_pages: int = 3,
    sample_chars: int = 500,
) -> TextDensity:
    """Extract a short pdfplumber sample and score text-layer richness."""
    import pdfplumber

    path = Path(path)
    texts: list[str] = []
    page_count = 0
    with pdfplumber.open(path) as pdf:
        page_count = len(pdf.pages)
        for page in pdf.pages[:max_pages]:
            t = page.extract_text() or ""
            if t.strip():
                texts.append(t)

    joined = "\n\n".join(texts)
    # For single-page worker PDFs, char_count ≈ page density.
    pages_sampled = min(page_count, max_pages) or 1
    chars = len(joined)
    cpp = chars / pages_sampled
    return TextDensity(
        char_count=chars,
        page_count=page_count,
        chars_per_page=cpp,
        is_text_rich=chars >= min_chars,
        sample=joined[:sample_chars],
    )


def heading_path_before(markdown: str, chunk: str) -> list[str]:
    """Best-effort heading trail for a chunk sliced from Markdown."""
    if not markdown or not chunk:
        return []
    idx = markdown.find(chunk[:80]) if len(chunk) >= 80 else markdown.find(chunk)
    prefix = markdown[: idx if idx >= 0 else 0]
    headings: list[str] = []
    for line in prefix.splitlines():
        s = line.strip()
        if s.startswith("#"):
            title = s.lstrip("#").strip()
            if title:
                level = len(s) - len(s.lstrip("#"))
                # Keep a short breadcrumb (drop deeper than current).
                headings = headings[: max(level - 1, 0)]
                headings.append(title)
    return headings[-4:]
