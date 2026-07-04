"""
Onyx Intel - Google Drive & Sheets Integration

Dormant module. Activates only when GOOGLE_CREDENTIALS_JSON env var is set
(service-account JSON as a single string). Until then is_enabled() returns
False and callers should skip Google export quietly.
"""
from __future__ import annotations

import io
import json
import logging
import os
from typing import Any

logger = logging.getLogger(__name__)

GOOGLE_CREDS_JSON = os.getenv("GOOGLE_CREDENTIALS_JSON", "")

SCOPES = [
    "https://www.googleapis.com/auth/drive.readonly",
    "https://www.googleapis.com/auth/spreadsheets",
]


def is_enabled() -> bool:
    return bool(GOOGLE_CREDS_JSON.strip())


def _get_services() -> tuple[Any, Any]:
    if not is_enabled():
        raise RuntimeError(
            "Google integration not configured. Set GOOGLE_CREDENTIALS_JSON "
            "(service-account JSON) to enable."
        )

    try:
        from google.oauth2 import service_account
        from googleapiclient.discovery import build
    except ImportError as e:
        raise RuntimeError(
            "google-api-python-client + google-auth not installed. "
            "Add to requirements.txt: google-api-python-client google-auth"
        ) from e

    creds_dict = json.loads(GOOGLE_CREDS_JSON)
    creds = service_account.Credentials.from_service_account_info(creds_dict, scopes=SCOPES)
    drive = build("drive", "v3", credentials=creds, cache_discovery=False)
    sheets = build("sheets", "v4", credentials=creds, cache_discovery=False)
    return drive, sheets


def download_file_from_drive(file_id: str) -> tuple[bytes, str]:
    """Download a Drive file, return (bytes, filename)."""
    from googleapiclient.http import MediaIoBaseDownload

    drive, _ = _get_services()
    meta = drive.files().get(fileId=file_id, fields="name").execute()
    filename = meta.get("name", "downloaded_file")

    request = drive.files().get_media(fileId=file_id)
    stream = io.BytesIO()
    downloader = MediaIoBaseDownload(stream, request)
    done = False
    while not done:
        status, done = downloader.next_chunk()
        if status:
            logger.info(f"[Drive] {file_id} {int(status.progress() * 100)}%")
    return stream.getvalue(), filename


def export_rows_to_google_sheet(
    spreadsheet_id: str,
    rows: list[dict],
    summary: dict,
) -> str:
    """Write enriched takeoff rows to a Google Sheet tab. Returns status string."""
    _, sheets = _get_services()

    headers = [
        "Trade", "Cost Code", "Description", "Quantity Basis",
        "Total Qty", "UOM", "Drawing Ref", "Location Tag",
        "Est Unit Cost", "Est Line Total",
    ]
    values: list[list[Any]] = [headers]
    for r in rows:
        values.append([
            r.get("trade", ""),
            r.get("cost_code", ""),
            r.get("description", ""),
            r.get("quantity_basis", ""),
            r.get("total_qty", 0.0),
            r.get("uom", ""),
            r.get("drawing_ref", ""),
            r.get("location_tag", ""),
            r.get("estimated_unit_cost", 0.0),
            r.get("estimated_line_total", 0.0),
        ])
    values.append([])
    values.append(["SUMMARY", f"Total Cost: ${summary.get('estimated_cost', 0.0):,.2f}"])

    sheets.spreadsheets().values().clear(
        spreadsheetId=spreadsheet_id, range="Sheet1!A:Z"
    ).execute()
    result = sheets.spreadsheets().values().update(
        spreadsheetId=spreadsheet_id,
        range="Sheet1!A1",
        valueInputOption="USER_ENTERED",
        body={"values": values},
    ).execute()

    return f"Updated {result.get('updatedCells')} cells."
