/**
 * Daily-log production replaces only the groups the user actually filled in.
 * The editor does not load saved rows, and it used to send [] for every blank
 * field. Treating that as a replace deleted installed quantities, crew, and
 * delays the form was not showing.
 */

export const PRODUCTION_TABLES = [
  "daily_log_manpower",
  "daily_log_delays",
  "daily_log_equipment",
  "daily_log_deliveries",
  "daily_log_quantities",
] as const;

export type ProductionTable = (typeof PRODUCTION_TABLES)[number];

const WRITABLE_FIELDS: Record<ProductionTable, readonly string[]> = {
  daily_log_manpower: ["company_name", "project_contact_id", "headcount", "hours"],
  daily_log_delays: ["reason_code", "hours", "schedule_task_id"],
  daily_log_equipment: ["name", "hours"],
  daily_log_deliveries: ["note", "commitment_id"],
  daily_log_quantities: ["budget_line_id", "estimate_item_id", "quantity", "unit"],
};

export interface ProductionWrite {
  table: ProductionTable;
  rows: Array<Record<string, unknown>>;
}

export interface ProductionBody {
  manpower?: Array<Record<string, unknown>>;
  delays?: Array<Record<string, unknown>>;
  equipment?: Array<Record<string, unknown>>;
  deliveries?: Array<Record<string, unknown>>;
  quantities?: Array<Record<string, unknown>>;
}

function pickFields(table: ProductionTable, row: Record<string, unknown>): Record<string, unknown> {
  const picked: Record<string, unknown> = {};
  for (const field of WRITABLE_FIELDS[table]) {
    if (row[field] !== undefined) picked[field] = row[field];
  }
  return picked;
}

/** Groups with at least one row. Omitted and empty groups stay as they are. */
export function productionWrites(body: ProductionBody): ProductionWrite[] {
  const groups: Array<{ table: ProductionTable; rows: Array<Record<string, unknown>> | undefined }> = [
    { table: "daily_log_manpower", rows: body.manpower },
    { table: "daily_log_delays", rows: body.delays },
    { table: "daily_log_equipment", rows: body.equipment },
    { table: "daily_log_deliveries", rows: body.deliveries },
    { table: "daily_log_quantities", rows: body.quantities },
  ];
  const writes: ProductionWrite[] = [];
  for (const group of groups) {
    if (!group.rows || group.rows.length === 0) continue;
    writes.push({
      table: group.table,
      rows: group.rows.map((row) => pickFields(group.table, row)),
    });
  }
  return writes;
}
