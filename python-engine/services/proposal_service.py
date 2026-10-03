"""One-page bid PDF.

ReportLab draws the proposal on the server. The totals use the same rollup
as the Excel workbook: contingency on direct cost, overhead on that subtotal,
then profit. The PDF is a snapshot, so the numbers are computed here; the
workbook keeps the live formulas.
"""

from __future__ import annotations

from io import BytesIO

from reportlab.lib import colors
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle


def _direct(row: dict) -> float:
    unit = (
        float(row.get("labor_unit") or 0)
        + float(row.get("material_unit") or 0)
        + float(row.get("equipment_unit") or 0)
        + float(row.get("subcontractor_unit") or 0)
        + float(row.get("trucking_unit") or 0)
        + float(row.get("disposal_unit") or 0)
    )
    return float(row.get("quantity") or 0) * unit


def proposal_totals(rows: list[dict], settings: dict) -> dict:
    direct = sum(_direct(row) for row in rows)
    contingency = direct * float(settings.get("contingency_pct") or 0) / 100.0
    subtotal = direct + contingency
    overhead = subtotal * float(settings.get("overhead_pct") or 0) / 100.0
    profit = (subtotal + overhead) * float(settings.get("profit_pct") or 0) / 100.0
    return {
        "direct": direct,
        "contingency": contingency,
        "subtotal": subtotal,
        "overhead": overhead,
        "profit": profit,
        "final_bid": subtotal + overhead + profit,
    }


def build_proposal_pdf(rows: list[dict], settings: dict, project_name: str, company_name: str = "Onyx Intel") -> bytes:
    totals = proposal_totals(rows, settings)
    buffer = BytesIO()
    doc = SimpleDocTemplate(buffer, pagesize=letter, leftMargin=0.7 * inch, rightMargin=0.7 * inch, topMargin=0.7 * inch, bottomMargin=0.7 * inch)
    styles = getSampleStyleSheet()
    story = [
        Paragraph(company_name, styles["Title"]),
        Paragraph(f"Bid proposal · {project_name}", styles["Heading2"]),
        Spacer(1, 12),
    ]
    table_rows = [["Cost code", "Description", "Qty", "Unit", "Direct"]]
    for row in rows:
        table_rows.append([
            str(row.get("cost_code") or ""),
            str(row.get("description") or ""),
            f"{float(row.get('quantity') or 0):,.2f}",
            str(row.get("unit") or ""),
            f"${_direct(row):,.2f}",
        ])
    table_rows.extend([
        ["", "Direct cost", "", "", f"${totals['direct']:,.2f}"],
        ["", "Contingency", "", "", f"${totals['contingency']:,.2f}"],
        ["", "Overhead", "", "", f"${totals['overhead']:,.2f}"],
        ["", "Profit", "", "", f"${totals['profit']:,.2f}"],
        ["", "Final bid", "", "", f"${totals['final_bid']:,.2f}"],
    ])
    table = Table(table_rows, colWidths=[70, 250, 60, 50, 80])
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#111111")),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTNAME", (0, -1), (-1, -1), "Helvetica-Bold"),
        ("GRID", (0, 0), (-1, -1), 0.25, colors.HexColor("#cccccc")),
        ("ALIGN", (2, 1), (-1, -1), "RIGHT"),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
    ]))
    story.extend([
        table,
        Spacer(1, 28),
        Paragraph("Accepted by ________________________________    Date ______________", styles["Normal"]),
    ])
    doc.build(story)
    return buffer.getvalue()
