/** Cells the SheetJS writer stores as values or live formulas. */
export type WorkbookCell = string | number | { f: string };

export interface WorkbookLine {
  cost_code: string;
  description: string;
  quantity: number;
  unit: string;
  labor_unit: number;
  material_unit: number;
  equipment_unit: number;
  subcontractor_unit: number;
  trucking_unit: number;
  disposal_unit: number;
}

export interface WorkbookSettings {
  contingency_pct: number;
  overhead_pct: number;
  profit_pct: number;
}

export interface LiveWorkbook {
  proposal: WorkbookCell[][];
  schedule: WorkbookCell[][];
  settings: WorkbookCell[][];
}

/**
 * Schedule of Values with qty × unit-rate formulas, and a proposal sheet
 * that rolls those directs through contingency, overhead, and profit.
 * Changing a quantity in Excel changes the bid.
 */
export function buildLiveWorkbook(projectName: string, rows: WorkbookLine[], settings: WorkbookSettings): LiveWorkbook {
  const schedule: WorkbookCell[][] = [[
    "Item", "Cost Code", "Description", "Qty", "Unit",
    "Labor $/u", "Material $/u", "Equipment $/u", "Sub $/u", "Trucking $/u", "Disposal $/u",
    "Labor", "Material", "Equipment", "Sub", "Trucking", "Disposal", "Direct",
  ]];
  rows.forEach((row, index) => {
    const excelRow = index + 2;
    schedule.push([
      index + 1,
      row.cost_code,
      row.description,
      row.quantity,
      row.unit,
      row.labor_unit,
      row.material_unit,
      row.equipment_unit,
      row.subcontractor_unit,
      row.trucking_unit,
      row.disposal_unit,
      { f: `D${excelRow}*F${excelRow}` },
      { f: `D${excelRow}*G${excelRow}` },
      { f: `D${excelRow}*H${excelRow}` },
      { f: `D${excelRow}*I${excelRow}` },
      { f: `D${excelRow}*J${excelRow}` },
      { f: `D${excelRow}*K${excelRow}` },
      { f: `SUM(L${excelRow}:Q${excelRow})` },
    ]);
  });

  const first = 2;
  const last = rows.length > 0 ? rows.length + 1 : 1;
  const direct = rows.length > 0 ? `SUM('Schedule of Values'!R${first}:R${last})` : "0";
  const proposal: WorkbookCell[][] = [
    [`Proposal · ${projectName}`],
    [],
    ["Direct cost", { f: direct }],
    ["Contingency", { f: "B3*Settings!B1" }],
    ["Subtotal", { f: "B3+B4" }],
    ["Overhead", { f: "B5*Settings!B2" }],
    ["Profit", { f: "(B5+B6)*Settings!B3" }],
    ["Final bid", { f: "B5+B6+B7" }],
  ];
  const settingsSheet: WorkbookCell[][] = [
    ["Contingency rate", settings.contingency_pct / 100],
    ["Overhead rate", settings.overhead_pct / 100],
    ["Profit rate", settings.profit_pct / 100],
  ];
  return { proposal, schedule, settings: settingsSheet };
}
