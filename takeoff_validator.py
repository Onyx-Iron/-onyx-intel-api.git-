"""
Onyx Intel — Deterministic Takeoff Validation Engine
Zero-skip, zero-hallucination data integrity layer for CSI MasterFormat takeoffs.

Structural Invariants (MUST NOT be weakened by any caller):
  [I-1]  All raw input parses through json.loads() + SecureTakeoffRow schema.
         Never pass raw strings or CSV lines directly into an LLM for parsing.
  [I-2]  Source checksum (row count + quantity sum + SHA-256 hash) is captured
         from the raw array BEFORE any row is touched by validation logic.
  [I-3]  Every row is attempted. Zero silent skips. A failed row writes an
         entry to error_log and contributes its provided_qty to the failed sum.
  [I-4]  Faulted rows land in a schema-tracked ValidationErrorRecord — never
         dropped and never silently passed downstream.
  [I-5]  After all rows are processed, _run_balance_audit() cross-verifies:
           source.row_count == valid_rows + failed_rows
           |source.qty_sum  - (valid_qty + failed_qty)| < QTY_EPSILON
         Any mismatch immediately raises DataIntegrityBreachException.
  [I-6]  DataIntegrityBreachException MUST halt all downstream Procurement and
         Finance agent pipelines. Swallowing it is a data integrity violation.
"""

from __future__ import annotations

import hashlib
import json
import logging
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from enum import Enum
from typing import Any

from pydantic import BaseModel, Field, field_validator

logger = logging.getLogger(__name__)

# Quantity tolerance: smaller than any real measurement rounding error,
# larger than float→Decimal conversion noise.
_QTY_EPSILON: Decimal = Decimal("0.001")


# ══════════════════════════════════════════════════════════════════════════════
# Enumerations
# ══════════════════════════════════════════════════════════════════════════════

class BreachType(str, Enum):
    ROW_COUNT_MISMATCH    = "ROW_COUNT_MISMATCH"
    QUANTITY_SUM_MISMATCH = "QUANTITY_SUM_MISMATCH"
    TOTAL_PARSE_FAILURE   = "TOTAL_PARSE_FAILURE"
    MALFORMED_JSON        = "MALFORMED_JSON"
    SOURCE_NOT_ARRAY      = "SOURCE_NOT_ARRAY"


class AuditStatus(str, Enum):
    VERIFIED_SUCCESS    = "VERIFIED_SUCCESS"       # all rows valid, both checksums match
    PARTIAL_WITH_ERRORS = "PARTIAL_WITH_ERRORS"    # some rows failed; checksums still reconcile
    TRANSACTION_REJECTED = "TRANSACTION_REJECTED"  # breach raised (set by caller after catch)
    CRITICAL_FAILURE    = "CRITICAL_FAILURE"       # malformed JSON or unrecoverable error


# ══════════════════════════════════════════════════════════════════════════════
# Exception — [I-6]
# ══════════════════════════════════════════════════════════════════════════════

class DataIntegrityBreachException(Exception):
    """
    Raised when source↔destination checksums diverge or total parse failure occurs.

    DOWNSTREAM CONTRACT
    -------------------
    Any Procurement or Finance agent that consumes rows from
    DeterministicOnyxParser.execute_zero_skip_parse() MUST wrap that call in
    a try/except DataIntegrityBreachException block and halt its pipeline on
    catch. Swallowing this exception is a data integrity violation.

    The exception carries the full audit context so callers can log, surface
    to the dashboard, or re-raise with additional context — without needing to
    re-inspect the parser state.
    """

    def __init__(
        self,
        breach_type: BreachType,
        source: "SourceChecksum",
        destination: "DestinationChecksum",
        error_log: list["ValidationErrorRecord"],
        delta: dict[str, Any],
    ) -> None:
        self.breach_type  = breach_type
        self.source       = source
        self.destination  = destination
        self.error_log    = error_log
        self.delta        = delta

        row_expected = source.row_count
        row_actual   = destination.valid_rows + destination.failed_rows
        qty_expected = float(source.qty_sum)
        qty_actual   = float(destination.valid_qty_sum + destination.failed_qty_sum)

        super().__init__(
            f"[DataIntegrityBreach:{breach_type.value}] "
            f"rows_expected={row_expected} rows_accounted={row_actual} "
            f"qty_expected={qty_expected:.6f} qty_accounted={qty_actual:.6f} "
            f"delta={delta}"
        )

    def to_dashboard_payload(self) -> dict[str, Any]:
        """
        Serialized breach report for the Onyx Intel dashboard notification endpoint.
        POST this to /api/scan or the notification bus to surface the breach to the user.
        """
        return {
            "event":       "DATA_INTEGRITY_BREACH",
            "breach_type": self.breach_type.value,
            "delta":       self.delta,
            "source":      self.source.model_dump(mode="json"),
            "destination": self.destination.model_dump(mode="json"),
            "error_count": len(self.error_log),
            "errors":      [e.model_dump(mode="json") for e in self.error_log],
            "timestamp":   datetime.now(timezone.utc).isoformat(),
        }


# ══════════════════════════════════════════════════════════════════════════════
# Pydantic schemas
# ══════════════════════════════════════════════════════════════════════════════

class SecureTakeoffRow(BaseModel):
    """
    Strict CSI MasterFormat takeoff row.

    extra='ignore' silently strips any field not declared here — LLM-hallucinated
    columns (e.g. "estimated_cost", "ai_notes") cannot contaminate the validated
    dataset or propagate to procurement agents.
    """
    model_config = {"extra": "ignore"}

    id:             uuid.UUID = Field(default_factory=uuid.uuid4)
    trade:          str       = Field(..., min_length=2,  max_length=120)
    cost_code:      str       = Field(..., pattern=r"^\d{2}-\d{2}-\d{2}$")
    description:    str       = Field(..., min_length=5,  max_length=500)
    quantity_basis: str       = Field(..., min_length=1,  max_length=250)
    total_qty:      float
    uom:            str       = Field(..., min_length=1,  max_length=5)
    drawing_ref:    str       = Field(default="",         max_length=50)
    location_tag:   str       = Field(default="",         max_length=120)

    @field_validator("total_qty", mode="before")
    @classmethod
    def qty_must_be_non_negative(cls, v: Any) -> float:
        try:
            val = float(v)
        except (TypeError, ValueError):
            raise ValueError(f"total_qty must be numeric — received: {v!r}")
        if val < 0:
            raise ValueError(
                f"Construction quantities cannot be negative: {val}. "
                "Check takeoff measurement for sign error."
            )
        return val

    @field_validator("cost_code", mode="before")
    @classmethod
    def normalize_cost_code(cls, v: Any) -> str:
        return str(v).strip()

    @field_validator("trade", "description", "quantity_basis", "location_tag", mode="before")
    @classmethod
    def strip_string_fields(cls, v: Any) -> str:
        return str(v).strip() if v is not None else ""


class ValidationErrorRecord(BaseModel):
    """
    Schema-tracked error cell — [I-4].

    Written to the error_log for every faulted row. Never silently dropped.

    The `provided_qty` field is MANDATORY: it carries the raw quantity value
    from the source row (even if that value itself was invalid) so that
    _run_balance_audit() can reconcile the quantity checksum across both the
    valid dataset and the failed rows. Without it, the quantity audit cannot
    close.
    """
    row_index:        int
    provided_id:      str
    provided_qty:     float            # 0.0 if total_qty was absent or non-numeric
    raw_row:          dict[str, Any]   # immutable snapshot of the source row
    validation_error: str
    breach_category:  str              # which schema invariant failed
    timestamp:        str = Field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat()
    )


class SourceChecksum(BaseModel):
    """
    Immutable reference point — [I-2].
    Captured from the raw array BEFORE any validation begins.
    """
    row_count: int
    qty_sum:   Decimal
    raw_hash:  str     # SHA-256 of the canonical JSON — detects mid-flight tampering


class DestinationChecksum(BaseModel):
    """Computed after all rows are processed (both pass and fail paths)."""
    valid_rows:     int
    failed_rows:    int
    valid_qty_sum:  Decimal
    failed_qty_sum: Decimal

    @property
    def total_accounted_rows(self) -> int:
        return self.valid_rows + self.failed_rows

    @property
    def total_accounted_qty(self) -> Decimal:
        return self.valid_qty_sum + self.failed_qty_sum


class IntegrityAuditReport(BaseModel):
    """
    Complete audit trail produced by every parse invocation.

    Surfaced to the Onyx Intel dashboard regardless of pass/fail.
    A VERIFIED_SUCCESS report confirms the validated rows are safe to pass
    to downstream procurement agents.
    """
    status:               AuditStatus
    source_checksum:      SourceChecksum
    destination_checksum: DestinationChecksum
    row_delta:            int      # source_rows - (valid + failed) — MUST be 0
    qty_delta:            Decimal  # |source_qty - (valid_qty + failed_qty)| — MUST be < epsilon
    errors:               list[ValidationErrorRecord]
    scanned_at:           str = Field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat()
    )

    def is_clean(self) -> bool:
        """True only when all rows validated and both checksums closed exactly."""
        return self.status == AuditStatus.VERIFIED_SUCCESS

    def to_event_payload(self) -> dict[str, Any]:
        return self.model_dump(mode="json")


# ══════════════════════════════════════════════════════════════════════════════
# Main engine
# ══════════════════════════════════════════════════════════════════════════════

class DeterministicOnyxParser:
    """
    Zero-skip, zero-hallucination validation engine for CSI MasterFormat payloads.

    Parse flow
    ----------
    raw JSON string
        → json.loads()                              [I-1: native parser only]
        → _capture_source_checksum()                [I-2: lock before touching rows]
        → _validate_single_row() × N               [I-3: every row attempted]
              ├── pass → self._validated.append()
              └── fail → self._errors.append(      [I-4: schema-tracked error_log]
                            ValidationErrorRecord with provided_qty)
        → _compute_destination_checksum()
        → _run_balance_audit()                      [I-5: cross-verify checksums]
              ├── match → IntegrityAuditReport (VERIFIED_SUCCESS or PARTIAL_WITH_ERRORS)
              └── mismatch → DataIntegrityBreachException [I-6: halt downstream]
    """

    def __init__(self, raw_json_payload: str) -> None:
        self._raw:       str                        = raw_json_payload
        self._validated: list[SecureTakeoffRow]     = []
        self._errors:    list[ValidationErrorRecord] = []

    # ── Public interface ────────────────────────────────────────────────────

    def execute_zero_skip_parse(
        self,
    ) -> tuple[list[dict[str, Any]], IntegrityAuditReport]:
        """
        Parse, validate, and audit the raw JSON payload.

        Returns
        -------
        (validated_rows_as_dicts, IntegrityAuditReport)
            Rows are safe to forward to procurement agents only when
            report.is_clean() is True or the caller explicitly accepts
            PARTIAL_WITH_ERRORS and understands which rows failed.

        Raises
        ------
        DataIntegrityBreachException
            On row-count mismatch, quantity-sum mismatch, or total parse
            failure. Callers MUST NOT swallow this — propagate to halt
            downstream procurement and finance pipelines.
        """
        # ── Step 0: Native parse — [I-1] ────────────────────────────────────
        parsed = self._parse_json_or_breach()

        # ── Step 1: Lock source checksum — [I-2] ────────────────────────────
        source = self._capture_source_checksum(parsed)
        logger.info(
            "[DeterministicParser] Source locked — rows=%d qty_sum=%s hash=%.12s…",
            source.row_count, source.qty_sum, source.raw_hash,
        )

        # ── Step 2: Validate every row — [I-3] ──────────────────────────────
        for index, raw_row in enumerate(parsed):
            self._validate_single_row(index, raw_row)

        # ── Step 3: Destination checksum ─────────────────────────────────────
        destination = self._compute_destination_checksum()
        logger.info(
            "[DeterministicParser] Destination — valid=%d failed=%d "
            "valid_qty=%s failed_qty=%s",
            destination.valid_rows, destination.failed_rows,
            destination.valid_qty_sum, destination.failed_qty_sum,
        )

        # ── Step 4: Balance audit — [I-5] ────────────────────────────────────
        report = self._run_balance_audit(source, destination)

        return [row.model_dump(mode="json") for row in self._validated], report

    # ── Private helpers ─────────────────────────────────────────────────────

    def _parse_json_or_breach(self) -> list[dict[str, Any]]:
        """[I-1] Parse raw bytes with stdlib json.loads — no LLM, no regex, no CSV split."""
        null_src = SourceChecksum(row_count=0, qty_sum=Decimal("0"), raw_hash=self._sha256(self._raw))
        null_dst = DestinationChecksum(valid_rows=0, failed_rows=0, valid_qty_sum=Decimal("0"), failed_qty_sum=Decimal("0"))

        try:
            parsed = json.loads(self._raw)
        except json.JSONDecodeError as exc:
            raise DataIntegrityBreachException(
                breach_type=BreachType.MALFORMED_JSON,
                source=null_src,
                destination=null_dst,
                error_log=[],
                delta={"json_error": str(exc), "position": exc.pos},
            ) from exc

        if not isinstance(parsed, list):
            raise DataIntegrityBreachException(
                breach_type=BreachType.SOURCE_NOT_ARRAY,
                source=null_src,
                destination=null_dst,
                error_log=[],
                delta={"actual_type": type(parsed).__name__, "expected": "list"},
            )
        return parsed

    def _capture_source_checksum(self, parsed: list[Any]) -> SourceChecksum:
        """
        [I-2] Lock row count and quantity sum from the RAW array before
        any validation runs. Uses Decimal arithmetic to avoid float drift.
        Non-numeric quantities are recorded as Decimal("0") here — they will
        surface as ValidationErrorRecords in Step 2 and contribute
        their raw float value to failed_qty_sum for reconciliation.
        """
        qty_sum = Decimal("0")
        for row in parsed:
            if not isinstance(row, dict):
                continue
            raw_qty = row.get("total_qty", 0)
            try:
                qty_sum += Decimal(str(raw_qty))
            except InvalidOperation:
                pass  # non-numeric qty — zero contribution to source sum here;
                       # _validate_single_row will record provided_qty=0.0

        canonical = json.dumps(parsed, sort_keys=True, ensure_ascii=False)
        return SourceChecksum(
            row_count=len(parsed),
            qty_sum=qty_sum,
            raw_hash=self._sha256(canonical),
        )

    def _validate_single_row(self, index: int, raw_row: Any) -> None:
        """
        [I-3] Attempt SecureTakeoffRow validation on one row.
        [I-4] On failure, write a ValidationErrorRecord — never skip or drop.

        The provided_qty from the source row is extracted BEFORE Pydantic runs
        so that even a row with a completely invalid total_qty can still
        contribute to the quantity checksum reconciliation in failed_qty_sum.
        """
        # Guard: row must be a JSON object
        if not isinstance(raw_row, dict):
            self._errors.append(ValidationErrorRecord(
                row_index=index,
                provided_id="UNKNOWN",
                provided_qty=0.0,
                raw_row={"_non_object_value": repr(raw_row)},
                validation_error=f"Row is not a JSON object (got {type(raw_row).__name__})",
                breach_category="NOT_AN_OBJECT",
            ))
            return

        # Extract provided_qty from source BEFORE validation so audit can reconcile
        provided_qty: float = 0.0
        try:
            provided_qty = float(raw_row.get("total_qty", 0) or 0)
            if provided_qty < 0:
                provided_qty = abs(provided_qty)  # capture magnitude; validator rejects it below
        except (TypeError, ValueError):
            provided_qty = 0.0

        try:
            validated = SecureTakeoffRow(**raw_row)
            self._validated.append(validated)

        except Exception as exc:
            err_str = str(exc)
            # Classify which schema invariant failed for dashboard display
            err_lower = err_str.lower()
            category = (
                "NEGATIVE_QUANTITY"  if "negative"       in err_lower else
                "INVALID_COST_CODE"  if "cost_code"      in err_lower or "pattern" in err_lower else
                "INVALID_UUID"       if "uuid"           in err_lower else
                "FIELD_TOO_SHORT"    if "min_length"     in err_lower or "at least" in err_lower else
                "FIELD_TOO_LONG"     if "max_length"     in err_lower else
                "MISSING_FIELD"      if "field required" in err_lower or "missing"  in err_lower else
                "TYPE_COERCION_FAIL" if "type"           in err_lower else
                "SCHEMA_VIOLATION"
            )
            self._errors.append(ValidationErrorRecord(
                row_index=index,
                provided_id=str(raw_row.get("id", "UNKNOWN")),
                provided_qty=provided_qty,
                raw_row=raw_row,
                validation_error=err_str,
                breach_category=category,
            ))

    def _compute_destination_checksum(self) -> DestinationChecksum:
        """
        Sum validated rows and failed rows separately using Decimal to preserve
        the precision needed for the balance-sheet audit in _run_balance_audit.
        """
        valid_qty  = sum(Decimal(str(r.total_qty))    for r in self._validated)
        failed_qty = sum(Decimal(str(e.provided_qty)) for e in self._errors)
        return DestinationChecksum(
            valid_rows=len(self._validated),
            failed_rows=len(self._errors),
            valid_qty_sum=valid_qty,
            failed_qty_sum=failed_qty,
        )

    def _run_balance_audit(
        self,
        source: SourceChecksum,
        destination: DestinationChecksum,
    ) -> IntegrityAuditReport:
        """
        [I-5] Cross-verify source↔destination checksums.

        Two conditions must hold:
          (a) Row integrity:  source.row_count == valid_rows + failed_rows
          (b) Qty integrity:  |source.qty_sum - (valid_qty + failed_qty)| < QTY_EPSILON

        A breach on either condition raises DataIntegrityBreachException
        BEFORE any caller can receive the validated rows.
        """
        row_delta = source.row_count - destination.total_accounted_rows
        qty_delta = abs(source.qty_sum - destination.total_accounted_qty)

        # ── (a) Row count integrity ──────────────────────────────────────────
        if row_delta != 0:
            logger.critical(
                "[BalanceAudit] ROW COUNT BREACH — expected=%d accounted=%d delta=%d",
                source.row_count, destination.total_accounted_rows, row_delta,
            )
            raise DataIntegrityBreachException(
                breach_type=BreachType.ROW_COUNT_MISMATCH,
                source=source,
                destination=destination,
                error_log=self._errors,
                delta={
                    "row_delta":   row_delta,
                    "expected":    source.row_count,
                    "accounted":   destination.total_accounted_rows,
                },
            )

        # ── (b) Quantity sum integrity ───────────────────────────────────────
        if qty_delta > _QTY_EPSILON:
            logger.critical(
                "[BalanceAudit] QTY SUM BREACH — expected=%s accounted=%s delta=%s",
                source.qty_sum, destination.total_accounted_qty, qty_delta,
            )
            raise DataIntegrityBreachException(
                breach_type=BreachType.QUANTITY_SUM_MISMATCH,
                source=source,
                destination=destination,
                error_log=self._errors,
                delta={
                    "qty_delta":  float(qty_delta),
                    "expected":   float(source.qty_sum),
                    "accounted":  float(destination.total_accounted_qty),
                    "epsilon":    float(_QTY_EPSILON),
                },
            )

        # ── (c) Total parse failure guard ────────────────────────────────────
        # Checksums closed but zero rows passed — every row failed validation.
        # This is a pathological data quality failure that must block procurement.
        if destination.valid_rows == 0 and source.row_count > 0:
            logger.critical(
                "[BalanceAudit] TOTAL PARSE FAILURE — all %d rows failed validation",
                source.row_count,
            )
            raise DataIntegrityBreachException(
                breach_type=BreachType.TOTAL_PARSE_FAILURE,
                source=source,
                destination=destination,
                error_log=self._errors,
                delta={"failed_rows": destination.failed_rows},
            )

        # ── Checksums closed — build passing report ──────────────────────────
        status = (
            AuditStatus.VERIFIED_SUCCESS
            if not self._errors
            else AuditStatus.PARTIAL_WITH_ERRORS
        )
        logger.info(
            "[BalanceAudit] PASSED — status=%s valid=%d failed=%d qty_delta=%s",
            status.value, destination.valid_rows, destination.failed_rows, qty_delta,
        )
        return IntegrityAuditReport(
            status=status,
            source_checksum=source,
            destination_checksum=destination,
            row_delta=row_delta,
            qty_delta=qty_delta,
            errors=self._errors,
        )

    @staticmethod
    def _sha256(data: str) -> str:
        return hashlib.sha256(data.encode("utf-8")).hexdigest()


# ══════════════════════════════════════════════════════════════════════════════
# Pipeline Guard — [I-6] downstream agent protection
# ══════════════════════════════════════════════════════════════════════════════

class PipelineGuard:
    """
    Context manager that enforces [I-6]: DataIntegrityBreachException blocks
    all downstream Procurement and Finance agent calls.

    Strict mode (default, reraise=True):
        with PipelineGuard("procurement_agent"):
            rows, report = parser.execute_zero_skip_parse()
            place_purchase_orders(rows)
        # If a breach occurred, the exception propagates — POs are never placed.

    Soft mode (reraise=False) — for logging / dashboard notification only:
        with PipelineGuard("audit_logger", reraise=False) as guard:
            rows, report = parser.execute_zero_skip_parse()
        if guard.blocked:
            notify_dashboard(guard.breach.to_dashboard_payload())
            return  # caller still responsible for halting the pipeline
    """

    def __init__(self, pipeline_name: str, *, reraise: bool = True) -> None:
        self.pipeline_name = pipeline_name
        self.reraise       = reraise
        self.blocked       = False
        self.breach: DataIntegrityBreachException | None = None

    def __enter__(self) -> "PipelineGuard":
        return self

    def __exit__(self, exc_type: Any, exc_val: Any, exc_tb: Any) -> bool:
        if isinstance(exc_val, DataIntegrityBreachException):
            self.blocked = True
            self.breach  = exc_val
            logger.critical(
                "[PipelineGuard] PIPELINE BLOCKED — name=%r breach=%s "
                "delta=%s error_count=%d",
                self.pipeline_name,
                exc_val.breach_type.value,
                exc_val.delta,
                len(exc_val.error_log),
            )
            # False → re-raise (strict mode); True → suppress (soft mode)
            return not self.reraise
        # Any other exception propagates unchanged — guard only intercepts breaches
        return False


# ══════════════════════════════════════════════════════════════════════════════
# Convenience: validate a pre-loaded list (for use inside the streaming parser)
# ══════════════════════════════════════════════════════════════════════════════

def validate_rows_from_list(
    rows: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], IntegrityAuditReport]:
    """
    Validate an already-parsed list of row dicts (from ijson or any native parser).
    Serializes to JSON internally so DeterministicOnyxParser can capture the hash.

    Raises DataIntegrityBreachException on any checksum mismatch.
    """
    raw_json = json.dumps(rows, ensure_ascii=False)
    parser   = DeterministicOnyxParser(raw_json)
    return parser.execute_zero_skip_parse()
