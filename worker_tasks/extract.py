"""Celery tasks: deterministic CAD/PDF takeoff extraction (ezdxf / pdfplumber)."""

from __future__ import annotations

import logging
import tempfile
from pathlib import Path

from celery_app import celery
from worker_tasks.staging import delete_job_blob, load_job_blob

logger = logging.getLogger(__name__)


@celery.task(bind=True, name="worker_tasks.extract.extract_document")
def extract_document(self, job_id: str, source_url: str | None = None) -> dict:
    """
    Heavy extract off the FastAPI thread.

    Input is either:
      - Redis blob staged by POST /api/takeoff/extract-async (job_id), or
      - an HTTP(S) `source_url` the worker downloads (large packages in object storage).
    """
    import httpx
    from takeoff_extract import extract as _extract

    if self.request.id:
        self.update_state(state="STARTED", meta={"job_id": job_id, "phase": "load"})
    suffix = ".bin"
    filename = "upload.bin"
    tmp_path: str | None = None

    try:
        if source_url:
            if self.request.id:
                self.update_state(state="STARTED", meta={"job_id": job_id, "phase": "download"})
            with httpx.Client(timeout=300.0, follow_redirects=True) as client:
                response = client.get(source_url)
                response.raise_for_status()
                content = response.content
            path_part = source_url.split("?", 1)[0]
            suffix = Path(path_part).suffix.lower() or ".bin"
            filename = Path(path_part).name or filename
        else:
            content, meta = load_job_blob(job_id)
            filename = str(meta.get("file_name") or filename)
            suffix = Path(filename).suffix.lower() or suffix

        if self.request.id:
            self.update_state(
                state="STARTED",
                meta={
                    "job_id": job_id,
                    "phase": "extract",
                    "file_name": filename,
                    "bytes": len(content),
                },
            )

        with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
            tmp.write(content)
            tmp.flush()
            tmp_path = tmp.name

        result = _extract(tmp_path)
        result["file_name"] = filename
        result["job_id"] = job_id
        result["worker"] = "celery"
        logger.info(
            "[celery.extract] job=%s file=%s rows=%d",
            job_id,
            filename,
            len(result.get("rows", [])),
        )
        return result
    finally:
        if tmp_path:
            Path(tmp_path).unlink(missing_ok=True)
        if not source_url:
            try:
                delete_job_blob(job_id)
            except Exception:  # noqa: BLE001
                logger.exception("failed to delete job blob %s", job_id)
