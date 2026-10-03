# XD-01 / XD-02 Docling text-PDF + chunk provenance

**Status:** wired into `page-processor` with density routing (2026-10-03).  
**License:** Docling is MIT — safe to depend on for commercial SaaS.

## What shipped

| Piece | Path |
|---|---|
| Optional deps | `requirements-docling.txt` (not in default `requirements.txt`) |
| Parser module | `python-engine/services/docling_parse.py` |
| Density helper | `python-engine/services/text_density.py` |
| API | `POST /api/parse/docling` + density fields on `/api/parse/document` |
| Edge wiring | `portal/supabase/functions/page-processor/index.ts` |
| Chunk meta | migration `20261005010000_chunk_meta_parser_provenance.sql` |
| Ask citations | `/api/documents/ask` labels include heading path + parser |
| Tests | `test_docling_parse.py`, `test_text_density.py`, `chunkMeta.test.ts` |

## Enable on a worker + Edge

**Railway (Docling package):**
```bash
pip install -r requirements.txt -r requirements-docling.txt
export ENABLE_DOCLING=1
```

**Supabase Edge `page-processor` secrets:**
```
PYTHON_API_URL=<railway url>
ONYX_API_SECRET=<shared secret>
ENABLE_DOCLING=1          # try Docling when pdfplumber density is high
DOCLING_MIN_CHARS=400     # optional threshold
```

Without Docling installed/enabled, `/api/parse/docling` returns `status: "unavailable"` and page-processor falls back to Gemini automatically.

## Routing

```
page PDF
  → pdfplumber density (/api/parse/document)
  → IF text-rich AND ENABLE_DOCLING: Docling Markdown
  → ELSE: Gemini OCR (drawings / scans)
  → chunk + embed + document_chunks.meta{parser_id, heading_path, confidence, …}
```

| Document kind | Path |
|---|---|
| Spec books / schedules (text layer) | Docling → Markdown → chunk/embed |
| Scanned / drawing sheets | Gemini (`page-processor`) |
| Deterministic takeoff tables | Keep `/api/takeoff/extract` (pdfplumber tables) |

## Chunk `meta` shape

```json
{
  "parser_id": "docling" | "gemini" | "pdfplumber",
  "confidence": 0.0,
  "heading_path": ["Division 09", "Flooring"],
  "bbox": null,
  "source": "page-processor" | "portal-ingest",
  "density_chars": 1200
}
```

`match_document_chunks` returns `meta` so ask can cite headings/parser.
