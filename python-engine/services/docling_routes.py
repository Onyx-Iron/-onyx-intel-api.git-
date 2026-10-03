"""FastAPI routes for optional Docling parse (XD-01)."""
from __future__ import annotations

import os
import tempfile
from pathlib import Path

from fastapi import APIRouter, Depends, File, Header, HTTPException, Query, UploadFile

router = APIRouter()


def register_docling_routes(app, *, verify_secret, enforce_upload_quota):
    """Attach POST /api/parse/docling to an existing FastAPI app."""

    @app.post(
        "/api/parse/docling",
        summary="Optional Docling text-PDF → Markdown/blocks (XD-01 spike)",
        dependencies=[Depends(verify_secret)],
    )
    async def parse_document_docling(
        file: UploadFile = File(...),
        x_onyx_tenant: str | None = Header(default=None),
        x_onyx_project: str | None = Header(default=None),
        x_onyx_secret: str | None = Header(default=None),
        document_id: str | None = Query(default=None),
    ) -> dict:
        enabled = os.environ.get("ENABLE_DOCLING", "").strip().lower() in {"1", "true", "yes", "on"}
        filename = file.filename or "unknown"
        ext = Path(filename).suffix.lower()
        if ext != ".pdf":
            raise HTTPException(status_code=400, detail="Docling spike accepts PDF only")

        content = await file.read()
        if len(content) == 0:
            raise HTTPException(status_code=400, detail="Uploaded file is empty")
        if len(content) > 100 * 1024 * 1024:
            raise HTTPException(status_code=413, detail="File exceeds 100 MB limit")
        enforce_upload_quota(len(content), x_onyx_tenant, x_onyx_secret)

        try:
            from services.docling_parse import docling_available, parse_pdf_with_docling
        except ImportError as exc:
            raise HTTPException(status_code=501, detail=f"docling module unavailable: {exc}") from exc

        if not enabled or not docling_available():
            return {
                "file_name": filename,
                "file_type": "pdf",
                "size_bytes": len(content),
                "tenant_id": x_onyx_tenant,
                "project_id": x_onyx_project,
                "document_id": document_id,
                "status": "unavailable",
                "parser_id": "docling",
                "fallback": "/api/parse/document",
                "detail": (
                    "Docling not enabled or not installed. "
                    "Set ENABLE_DOCLING=1 and pip install -r requirements-docling.txt"
                ),
            }

        tmp = tempfile.NamedTemporaryFile(suffix=".pdf", delete=False)
        try:
            tmp.write(content)
            tmp.flush()
            tmp_path = tmp.name
        finally:
            tmp.close()

        try:
            parsed = parse_pdf_with_docling(tmp_path)
        finally:
            Path(tmp_path).unlink(missing_ok=True)

        return {
            "file_name": filename,
            "file_type": "pdf",
            "size_bytes": len(content),
            "tenant_id": x_onyx_tenant,
            "project_id": x_onyx_project,
            "document_id": document_id,
            "status": parsed.status,
            "parser_id": parsed.parser_id,
            "page_count": parsed.page_count,
            "text_preview": parsed.text_preview,
            "markdown": parsed.markdown,
            "blocks": parsed.blocks,
            "metadata": parsed.metadata,
        }

