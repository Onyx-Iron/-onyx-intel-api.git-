"""Estimate workbooks whose totals are Excel formulas.

A contractor can change a quantity or a unit rate in Excel and the direct
cost, contingency, overhead, profit, and bid all recalculate. Values are not
pasted as frozen numbers.
"""

from __future__ import annotations

from io import BytesIO

from openpyxl import Workbook
from openpyxl.formatting.rule import FormulaRule
from openpyxl.styles import Font, PatternFill
from openpyxl.utils import get_column_letter

Line = dict


def _money(value: float) -> float:
    return round(float(value), 4)


def build_estimate_workbook(
    rows: list[Line],
    settings: dict,
    project_name: str,
    cut_fill: list[dict] | None = None,
) -> bytes:
    contingency = float(settings.get("contingency_pct") or 0) / 100.0
    overhead = float(settings.get("overhead_pct") or 0) / 100.0
    profit = float(settings.get("profit_pct") or 0) / 100.0

    book = Workbook()
    schedule = book.active
    schedule.title = "Schedule of Values"
    settings_sheet = book.create_sheet("Settings")
    proposal = book.create_sheet("Proposal", 0)

    settings_sheet["A1"] = "Contingency rate"
    settings_sheet["B1"] = contingency
    settings_sheet["A2"] = "Overhead rate"
    settings_sheet["B2"] = overhead
    settings_sheet["A3"] = "Profit rate"
    settings_sheet["B3"] = profit
    settings_sheet["B1"].number_format = "0.00%"
    settings_sheet["B2"].number_format = "0.00%"
    settings_sheet["B3"].number_format = "0.00%"

    headers = [
        "Item", "Cost Code", "Description", "Qty", "Unit",
        "Labor $/u", "Material $/u", "Equipment $/u", "Sub $/u", "Trucking $/u", "Disposal $/u",
        "Labor", "Material", "Equipment", "Sub", "Trucking", "Disposal", "Direct",
    ]
    schedule.append(headers)
    for cell in schedule[1]:
        cell.font = Font(bold=True)

    first = 2
    for index, row in enumerate(rows):
        excel_row = first + index
        schedule.append([
            index + 1,
            row.get("cost_code") or "",
            row.get("description") or "",
            _money(row.get("quantity") or 0),
            row.get("unit") or "",
            _money(row.get("labor_unit") or 0),
            _money(row.get("material_unit") or 0),
            _money(row.get("equipment_unit") or 0),
            _money(row.get("subcontractor_unit") or 0),
            _money(row.get("trucking_unit") or 0),
            _money(row.get("disposal_unit") or 0),
        ])
        # L through Q are qty times each unit rate. R is their sum.
        for offset, source in enumerate("FGHIJK"):
            column = get_column_letter(12 + offset)
            schedule[f"{column}{excel_row}"] = f"=D{excel_row}*{source}{excel_row}"
        schedule[f"R{excel_row}"] = f"=SUM(L{excel_row}:Q{excel_row})"

    last = first + len(rows) - 1 if rows else first - 1
    direct_ref = f"SUM(Schedule!R{first}:R{last})" if rows else "0"

    proposal["A1"] = f"Proposal · {project_name}"
    proposal["A1"].font = Font(bold=True, size=16)
    proposal["A3"] = "Direct cost"
    proposal["B3"] = f"={direct_ref}"
    proposal["A4"] = "Contingency"
    proposal["B4"] = "=B3*Settings!B1"
    proposal["A5"] = "Subtotal"
    proposal["B5"] = "=B3+B4"
    proposal["A6"] = "Overhead"
    proposal["B6"] = "=B5*Settings!B2"
    proposal["A7"] = "Profit"
    proposal["B7"] = "=(B5+B6)*Settings!B3"
    proposal["A8"] = "Final bid"
    proposal["B8"] = "=B5+B6+B7"
    proposal["B8"].font = Font(bold=True)
    for row_number in range(3, 9):
        proposal[f"B{row_number}"].number_format = '"$"#,##0.00'
    proposal.conditional_formatting.add(
        "B8",
        FormulaRule(formula=["B8<=0"], fill=PatternFill("solid", fgColor="F4C7C3")),
    )

    for column in range(1, 19):
        schedule.column_dimensions[get_column_letter(column)].width = 14
    schedule.column_dimensions["C"].width = 36
    proposal.column_dimensions["A"].width = 22
    proposal.column_dimensions["B"].width = 18

    prices = book.create_sheet("Unit Prices")
    prices.append(["Item", "Description", "Qty", "Unit", "Unit Price", "Extension"])
    for cell in prices[1]:
        cell.font = Font(bold=True)
    for index, row in enumerate(rows):
        excel_row = index + 2
        prices.append([
            index + 1,
            row.get("description") or "",
            _money(row.get("quantity") or 0),
            row.get("unit") or "",
            None,
            f"=C{excel_row}*E{excel_row}",
        ])
    if rows:
        total_row = len(rows) + 2
        prices[f"A{total_row}"] = "Total"
        prices[f"F{total_row}"] = f"=SUM(F2:F{total_row - 1})"
        prices[f"F{total_row}"].font = Font(bold=True)
    prices.column_dimensions["B"].width = 36

    if cut_fill:
        earth = book.create_sheet("Cut Fill")
        earth.append(["X", "Y", "Existing", "Proposed", "Delta", "Cut", "Fill"])
        for cell in earth[1]:
            cell.font = Font(bold=True)
        for index, cell_row in enumerate(cut_fill):
            excel_row = index + 2
            earth.append([
                float(cell_row.get("x") or 0),
                float(cell_row.get("y") or 0),
                float(cell_row.get("existing_z") or 0),
                float(cell_row.get("proposed_z") or 0),
                f"=D{excel_row}-C{excel_row}",
                f'=IF(E{excel_row}<0,-E{excel_row},0)',
                f"=IF(E{excel_row}>0,E{excel_row},0)",
            ])

    buffer = BytesIO()
    book.save(buffer)
    return buffer.getvalue()
