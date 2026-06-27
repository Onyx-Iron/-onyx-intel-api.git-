"""
Onyx Intel — CSI Takeoff Stream Processor
Reads a JSON takeoff file, validates every row through DeterministicOnyxParser,
then streams NDJSON events to the frontend TakeoffGridView.

Event sequence emitted per file:
  PARSING_STARTED        — total_rows, source_hash
  CHUNK_PROCESSED × N    — rows (validated), chunk_audit (per-chunk report)
  ROW_VALIDATION_ERROR   — emitted whenever a chunk contains failed rows
  PARSING_COMPLETED      — final_row_count, file_audit (full IntegrityAuditReport)
  CRITICAL_PARSER_FAILURE — only on DataIntegrityBreachException or I/O error
"""

from __future__ import annotations

import json
import logging
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, AsyncGenerator

import ijson                            # pip install ijson

from takeoff_validator import (
    AuditStatus,
    DataIntegrityBreachException,
    DeterministicOnyxParser,
    IntegrityAuditReport,
    PipelineGuard,
    SecureTakeoffRow,
    ValidationErrorRecord,
    validate_rows_from_list,
)

logger = logging.getLogger(__name__)


# ══════════════════════════════════════════════════════════════════════════════
# Stream processor
# ══════════════════════════════════════════════════════════════════════════════

class CSITakeoffStreamProcessor:
    """
    Reads a JSON takeoff file using ijson (streaming, O(1) peak memory for the
    parse pass), collects all rows, validates the entire file through
    DeterministicOnyxParser (file-level checksum integrity), then re-emits
    validated rows as chunked NDJSON events.

    Two-stage design rationale
    --------------------------
    ijson gives us true streaming I/O, but a file-level quantity checksum
    requires seeing every row before we can verify the balance.  So we:
      Stage 1 — stream-read with ijson into a raw list (no validation, O(n) RAM)
      Stage 2 — validate the raw list in one DeterministicOnyxParser pass
      Stage 3 — emit validated rows in chunk_size batches as NDJSON events

    For typical takeoff files (100–5 000 rows) the raw list is small (<5 MB).
    If files ever exceed ~100 000 rows, promote Stage 1 to a two-pass approach:
    first pass for checksums only, second pass for validation.
    """

    def __init__(self, file_path: str, chunk_size: int = 15) -> None:
        self.file_path  = Path(file_path)
        self.chunk_size = max(1, chunk_size)

    # ── Public streaming interface ──────────────────────────────────────────

    async def parse_and_stream_sheet(self) -> AsyncGenerator[bytes, None]:
        """
        Async generator.  Each yield is one newline-terminated JSON line (NDJSON).
        The caller (FastAPI StreamingResponse) never receives unvalidated rows.
        """
        # ── Stage 1: Stream-read entire file into raw list via ijson ─────────
        try:
            raw_rows = self._read_all_rows_with_ijson()
        except Exception as exc:
            yield self._ndjson({
                "event":   "CRITICAL_PARSER_FAILURE",
                "message": f"File I/O error: {exc}",
                "path":    str(self.file_path),
            })
            return

        total_raw = len(raw_rows)
        logger.info("[StreamProcessor] ijson read %d raw rows from %s", total_raw, self.file_path)

        # ── Stage 2: File-level validation through DeterministicOnyxParser ───
        yield self._ndjson({
            "event":      "PARSING_STARTED",
            "total_rows": total_raw,
            "file":       self.file_path.name,
            "timestamp":  _now(),
        })

        with PipelineGuard("takeoff_stream", reraise=False) as guard:
            validated_rows, file_audit = validate_rows_from_list(raw_rows)

        if guard.blocked:
            breach = guard.breach
            yield self._ndjson({
                "event":   "CRITICAL_PARSER_FAILURE",
                "message": str(breach),
                **breach.to_dashboard_payload(),
            })
            logger.critical("[StreamProcessor] Breach halted stream: %s", breach)
            return

        # ── Stage 3: Chunk-emit validated rows ────────────────────────────────
        processed_count = 0
        error_rows      = file_audit.errors  # ValidationErrorRecord list

        for chunk_start in range(0, len(validated_rows), self.chunk_size):
            chunk = validated_rows[chunk_start : chunk_start + self.chunk_size]
            processed_count += len(chunk)

            # Per-chunk mini-audit: validate just this chunk independently
            # so the frontend can show progressive integrity status per batch.
            chunk_valid, chunk_errors = self._audit_chunk(chunk)

            yield self._ndjson({
                "event":           "CHUNK_PROCESSED",
                "rows":            chunk_valid,
                "processed_count": processed_count,
                "total_rows":      len(validated_rows),
                "progress_pct":    round(processed_count / len(validated_rows) * 100, 1),
                "chunk_index":     chunk_start // self.chunk_size,
                "chunk_audit": {
                    "valid":  len(chunk_valid),
                    "errors": len(chunk_errors),
                },
            })

        # Emit any row-level validation errors from the file-level pass
        if error_rows:
            yield self._ndjson({
                "event":        "ROW_VALIDATION_ERROR",
                "error_count":  len(error_rows),
                "error_details": [e.model_dump(mode="json") for e in error_rows],
            })

        # ── Completion event with full file audit ─────────────────────────────
        yield self._ndjson({
            "event":          "PARSING_COMPLETED",
            "final_row_count": len(validated_rows),
            "failed_rows":    len(error_rows),
            "audit_status":   file_audit.status.value,
            "file_audit":     file_audit.to_event_payload(),
            "timestamp":      _now(),
        })

        logger.info(
            "[StreamProcessor] Complete — valid=%d failed=%d status=%s",
            len(validated_rows), len(error_rows), file_audit.status.value,
        )

    # ── Private helpers ─────────────────────────────────────────────────────

    def _read_all_rows_with_ijson(self) -> list[dict[str, Any]]:
        """
        [I-1] Use ijson (native C parser) to stream-read the JSON file.
        Never passes raw text to an LLM. Returns a plain list of dicts.
        """
        rows: list[dict[str, Any]] = []
        with open(self.file_path, "rb") as fh:
            for item in ijson.items(fh, "item"):
                rows.append(item)
        return rows

    def _audit_chunk(
        self,
        chunk: list[dict[str, Any]],
    ) -> tuple[list[dict[str, Any]], list[ValidationErrorRecord]]:
        """
        Re-validate a chunk of already-validated rows through SecureTakeoffRow
        to produce per-chunk error metadata for the frontend status bar.
        In normal operation this always passes (rows were already validated at
        file level); errors here indicate a memory corruption or code bug.
        """
        valid:  list[dict[str, Any]]    = []
        errors: list[ValidationErrorRecord] = []
        for i, row in enumerate(chunk):
            try:
                clean = SecureTakeoffRow(**row)
                valid.append(clean.model_dump(mode="json"))
            except Exception as exc:
                errors.append(ValidationErrorRecord(
                    row_index=i,
                    provided_id=str(row.get("id", "UNKNOWN")),
                    provided_qty=float(row.get("total_qty", 0) or 0),
                    raw_row=row,
                    validation_error=str(exc),
                    breach_category="CHUNK_RE_VALIDATION_FAIL",
                ))
        return valid, errors

    @staticmethod
    def _ndjson(payload: dict[str, Any]) -> bytes:
        return (json.dumps(payload, default=str, ensure_ascii=False) + "\n").encode("utf-8")


# ══════════════════════════════════════════════════════════════════════════════
# Utility
# ══════════════════════════════════════════════════════════════════════════════

def _now() -> str:
    return datetime.now(timezone.utc).isoformat()
