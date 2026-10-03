# XD-01 Docling text-PDF spike

**Status:** optional Railway endpoint landed (2026-10-03).  
**License:** Docling is MIT — safe to depend on for commercial SaaS.

## What shipped

| Piece | Path |
|---|---|
| Optional deps | `requirements-docling.txt` (not in default `requirements.txt`) |
| Parser module | `python-engine/services/docling_parse.py` |
| API | `POST /api/parse/docling` in `takeoff_api.py` |
| Tests | `test_docling_parse.py` (skips when Docling absent) |

## Enable on a worker

```bash
pip install -r requirements.txt -r requirements-docling.txt
export ENABLE_DOCLING=1
```

Without both, the endpoint returns `status: "unavailable"` and points callers at `/api/parse/document` (pdfplumber).

## When to use which path

| Document kind | Path |
|---|---|
| Spec books / schedules (text layer) | Docling → Markdown/blocks → chunk/embed |
| Scanned / drawing sheets | Keep Gemini (`page-processor`) |
| Deterministic takeoff tables | Keep `/api/takeoff/extract` (pdfplumber tables) |

## Not yet wired

Portal ingest and `page-processor` still call Gemini first. Next step after quality comparison: density heuristic → Docling when text-layer is rich, else Gemini.
