"""
Onyx Intel — Google Drive & Sheets integration.

A dedicated, dependency-light module that authenticates a Google Service
Account (from the ``GOOGLE_CREDENTIALS_JSON`` environment variable) and
exposes two narrow operations used by the takeoff pipeline:

* :func:`download_file_from_drive` — pull a blueprint binary out of Drive
  (PDF / DXF / DWG / IFC / XLSX) together with its original filename.
* :func:`export_rows_to_google_sheet` — clear a target Google Sheet and
  populate it with the enriched takeoff rows produced by
  ``EnhancedDeterministicParser``.

When ``GOOGLE_CREDENTIALS_JSON`` is empty the module stays dormant —
:func:`is_enabled` returns ``False`` so callers can skip Google export
quietly during local development or in environments that have no service
account configured.

The credential string must be the full Service Account JSON (the one
Google Cloud emits when you create the key), passed as a single env
variable. Required scopes:

* ``https://www.googleapis.com/auth/drive.readonly`` — file download
* ``https://www.googleapis.com/auth/spreadsheets``  — sheet write
"""
from __future__ import annotations

import io
import json
import logging
import os
from threading import Lock
from typing import Any

logger = logging.getLogger(__name__)

# ── Configuration ──────────────────────────────────────────────────────────────

GOOGLE_CREDS_JSON: str = os.getenv("GOOGLE_CREDENTIALS_JSON", "")

SCOPES: list[str] = [
    "https://www.googleapis.com/auth/drive.readonly",
    "https://www.googleapis.com/auth/spreadsheets",
]

# Google Sheets API caps a single values.update at ~10M cells. We cap far
# below that — the spreadsheet UI starts choking around ~50k rows anyway,
# and a multi-megabyte payload is almost always a sign of a misconfigured
# enrichment job.
_MAX_EXPORT_ROWS: int = 25_000

# Header order is part of the contract with the portal's sheet templates —
# do not reorder without coordinating a template migration.
_SHEET_HEADERS: list[str] = [
    "Trade",
    "Cost Code",
    "Description",
    "Quantity Basis",
    "Total Qty",
    "UOM",
    "Drawing Ref",
    "Location Tag",
    "Waste Factor",
    "Regional Multiplier",
    "Est Unit Cost",
    "Est Line Total",
]

# Built once per process; the discovery build is the expensive step.
_services_cache: tuple[Any, Any] | None = None
_services_lock = Lock()


# ── Public predicates ──────────────────────────────────────────────────────────

def is_enabled() -> bool:
    """Return ``True`` when a Google service-account JSON is configured."""
    return bool(GOOGLE_CREDS_JSON.strip())


# ── Internal: authenticated service handles ────────────────────────────────────

def _get_services() -> tuple[Any, Any]:
    """
    Build (or return cached) ``(drive_v3, sheets_v4)`` API clients.

    The service-account credentials are parsed once and reused for the
    process lifetime. The googleapiclient discovery cache is disabled
    because it writes to ``$HOME`` — which fails in read-only container
    filesystems (Railway, Cloud Run) and is unnecessary for long-lived
    workers.
    """
    global _services_cache

    if _services_cache is not None:
        return _services_cache

    if not is_enabled():
        raise RuntimeError(
            "Google integration not configured. Set GOOGLE_CREDENTIALS_JSON "
            "(service-account JSON, as a single string) to enable."
        )

    try:
        from google.oauth2 import service_account
        from googleapiclient.discovery import build
    except ImportError as exc:  # pragma: no cover — install-time error
        raise RuntimeError(
            "Google client libraries not installed. Add to requirements.txt: "
            "google-api-python-client google-auth-httplib2 google-auth-oauthlib"
        ) from exc

    try:
        creds_dict = json.loads(GOOGLE_CREDS_JSON)
    except json.JSONDecodeError as exc:
        raise RuntimeError(
            "GOOGLE_CREDENTIALS_JSON is not valid JSON. Paste the full "
            "service-account key file contents."
        ) from exc

    with _services_lock:
        if _services_cache is not None:
            return _services_cache

        creds = service_account.Credentials.from_service_account_info(
            creds_dict, scopes=SCOPES,
        )
        drive = build("drive", "v3", credentials=creds, cache_discovery=False)
        sheets = build("sheets", "v4", credentials=creds, cache_discovery=False)
        _services_cache = (drive, sheets)
        logger.info(
            "[Google] service-account initialized: %s",
            creds_dict.get("client_email", "<unknown>"),
        )
        return _services_cache


# ── Drive ──────────────────────────────────────────────────────────────────────

def download_file_from_drive(file_id: str) -> tuple[bytes, str]:
    """
    Download a binary file from Google Drive.

    Parameters
    ----------
    file_id:
        The Drive file's resource ID (the segment after ``/d/`` in a
        Drive URL). Shared-drive items work as long as the service
        account has been granted access to the file or its parent.

    Returns
    -------
    tuple[bytes, str]
        The raw file bytes and the file's original Drive name
        (``"foundation_plan.pdf"`` etc.).

    Raises
    ------
    ValueError
        If ``file_id`` is empty or whitespace.
    RuntimeError
        If Google integration is disabled or credentials are invalid.
    googleapiclient.errors.HttpError
        For HTTP-level failures from Drive (404, 403, etc.) — propagated
        unchanged so the caller can map them to a useful HTTP response.
    """
    if not file_id or not file_id.strip():
        raise ValueError("file_id must be a non-empty Drive resource ID")

    from googleapiclient.http import MediaIoBaseDownload

    drive, _ = _get_services()

    meta = drive.files().get(
        fileId=file_id,
        fields="name,mimeType,size",
        supportsAllDrives=True,
    ).execute()
    filename: str = meta.get("name") or "downloaded_file"

    request = drive.files().get_media(fileId=file_id, supportsAllDrives=True)
    buffer = io.BytesIO()
    downloader = MediaIoBaseDownload(buffer, request, chunksize=1024 * 1024)

    done = False
    while not done:
        status, done = downloader.next_chunk()
        if status is not None:
            logger.info(
                "[Drive] %s — %d%% (%s)",
                file_id, int(status.progress() * 100), filename,
            )

    data = buffer.getvalue()
    logger.info(
        "[Drive] downloaded file_id=%s name=%s bytes=%d",
        file_id, filename, len(data),
    )
    return data, filename


# ── Sheets ─────────────────────────────────────────────────────────────────────

def _format_currency(value: float | int | None) -> str:
    """Render a number as a US-format dollar string for the summary block."""
    try:
        return f"${float(value or 0.0):,.2f}"
    except (TypeError, ValueError):
        return "$0.00"


def _row_to_sheet_values(row: dict) -> list[Any]:
    """Project an enriched takeoff-row dict into ``_SHEET_HEADERS`` order."""
    return [
        row.get("trade", ""),
        row.get("cost_code", ""),
        row.get("description", ""),
        row.get("quantity_basis", ""),
        row.get("total_qty", 0.0),
        row.get("uom", ""),
        row.get("drawing_ref", ""),
        row.get("location_tag", ""),
        row.get("waste_factor", 1.0),
        row.get("regional_multiplier", 1.0),
        row.get("estimated_unit_cost", 0.0),
        row.get("estimated_line_total", 0.0),
    ]


def _build_summary_block(summary: dict) -> list[list[Any]]:
    """
    Build the trailing summary rows appended after the data block.

    The shape matches the portal's sheet template: a blank spacer row,
    a SUMMARY banner, then key totals on their own rows so the user can
    reference them directly from other tabs.
    """
    breakdown = summary.get("cost_breakdown") or {}
    block: list[list[Any]] = [
        [],
        ["SUMMARY"],
        ["Region", summary.get("region", "")],
        ["Total Rows", summary.get("total_rows", 0)],
        ["Total Qty", round(float(summary.get("total_qty", 0.0) or 0.0), 3)],
        ["Estimated Cost", _format_currency(summary.get("estimated_cost"))],
        ["  Labor", _format_currency(breakdown.get("labor"))],
        ["  Material", _format_currency(breakdown.get("material"))],
        ["  Equipment", _format_currency(breakdown.get("equipment"))],
        [
            "Regional Adjustment",
            float(summary.get("regional_adjustment", 1.0) or 1.0),
        ],
        [
            "Average Waste Factor",
            round(float(summary.get("waste_factor_avg", 1.0) or 1.0), 3),
        ],
        ["Validation Passed", bool(summary.get("validation_passed", False))],
        ["Errors", int(summary.get("errors", 0) or 0)],
    ]
    return block


def export_rows_to_google_sheet(
    spreadsheet_id: str,
    rows: list[dict],
    summary: dict,
) -> str:
    """
    Clear ``Sheet1`` on the target spreadsheet and write headers, rows,
    and a summary block.

    Parameters
    ----------
    spreadsheet_id:
        The target Google Sheet's ID (segment between ``/d/`` and
        ``/edit`` in the sheet URL). The service account must have
        editor access.
    rows:
        Iterable of enriched takeoff-row dicts. Typically the result of
        ``[r.model_dump() for r in EnhancedDeterministicParser(...)
        .execute_with_cost_enrichment(region)[0]]`` — but any dict that
        carries the standard takeoff keys works.
    summary:
        The summary dict returned by ``execute_with_cost_enrichment`` —
        carries totals and cost breakdown used to build the footer block.

    Returns
    -------
    str
        Human-readable status string suitable for inclusion in an API
        response (e.g. ``"Updated 4,720 cells in Sheet1 of <id>."``).

    Raises
    ------
    ValueError
        If ``spreadsheet_id`` is empty or the row count exceeds the
        per-export cap.
    RuntimeError
        If Google integration is disabled or credentials are invalid.
    googleapiclient.errors.HttpError
        For HTTP-level failures from Sheets — propagated unchanged.
    """
    if not spreadsheet_id or not spreadsheet_id.strip():
        raise ValueError("spreadsheet_id must be a non-empty Sheets ID")
    if len(rows) > _MAX_EXPORT_ROWS:
        raise ValueError(
            f"Refusing to export {len(rows):,} rows (limit: {_MAX_EXPORT_ROWS:,}). "
            f"Slice the dataset or write to multiple spreadsheets."
        )

    _, sheets = _get_services()

    values: list[list[Any]] = [list(_SHEET_HEADERS)]
    values.extend(_row_to_sheet_values(r) for r in rows)
    values.extend(_build_summary_block(summary or {}))

    # Step 1: clear the target tab so a smaller export doesn't leave
    # stale rows from the prior run in the sheet.
    sheets.spreadsheets().values().clear(
        spreadsheetId=spreadsheet_id,
        range="Sheet1!A:Z",
    ).execute()

    # Step 2: write the new block in one batch. USER_ENTERED lets the
    # sheet interpret numeric strings as numbers and the leading "$" as
    # a currency-formatted cell.
    result = sheets.spreadsheets().values().update(
        spreadsheetId=spreadsheet_id,
        range="Sheet1!A1",
        valueInputOption="USER_ENTERED",
        body={"values": values},
    ).execute()

    updated_cells = int(result.get("updatedCells", 0) or 0)
    logger.info(
        "[Sheets] exported spreadsheet_id=%s rows=%d cells=%d",
        spreadsheet_id, len(rows), updated_cells,
    )
    return f"Updated {updated_cells:,} cells in Sheet1 of {spreadsheet_id}."
