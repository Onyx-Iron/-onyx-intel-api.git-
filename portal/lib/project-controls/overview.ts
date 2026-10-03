import { projectMoneyFromAggregate, type ProjectMoney } from "@/lib/project-controls/money";

export interface ProjectOverview extends ProjectMoney {
  takeoff_items: number;
  documents: number;
  schedule_tasks: number;
  contacts: number;
  daily_logs: number;
  generated_docs: number;
  procurement_total: number;
  procurement_pending: number;
  punch_total: number;
  punch_open: number;
  permits_total: number;
  permits_approved: number;
  rfis_open: number;
  submittals_open: number;
  completion: number;
}

function count(value: number | string | null | undefined): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Same percentage the overview computed from the two schedule counts. */
export function scheduleCompletion(taskCount: number, completeCount: number): number {
  return taskCount > 0 ? Math.round((completeCount / taskCount) * 100) : 0;
}

type SnapshotValue = number | string | null | undefined;

export function overviewFromSnapshot(row: Record<string, SnapshotValue> & {
  takeoff_items?: SnapshotValue;
  documents?: SnapshotValue;
  schedule_tasks?: SnapshotValue;
  schedule_complete?: SnapshotValue;
  contacts?: SnapshotValue;
  daily_logs?: SnapshotValue;
  generated_docs?: SnapshotValue;
  procurement_total?: SnapshotValue;
  procurement_pending?: SnapshotValue;
  punch_total?: SnapshotValue;
  punch_open?: SnapshotValue;
  permits_total?: SnapshotValue;
  permits_approved?: SnapshotValue;
  rfis_open?: SnapshotValue;
  submittals_open?: SnapshotValue;
}): ProjectOverview {
  const scheduleTasks = count(row.schedule_tasks);
  return {
    takeoff_items: count(row.takeoff_items),
    documents: count(row.documents),
    schedule_tasks: scheduleTasks,
    contacts: count(row.contacts),
    daily_logs: count(row.daily_logs),
    generated_docs: count(row.generated_docs),
    procurement_total: count(row.procurement_total),
    procurement_pending: count(row.procurement_pending),
    punch_total: count(row.punch_total),
    punch_open: count(row.punch_open),
    permits_total: count(row.permits_total),
    permits_approved: count(row.permits_approved),
    rfis_open: count(row.rfis_open),
    submittals_open: count(row.submittals_open),
    ...projectMoneyFromAggregate({
      estimate_value: row.estimate_value,
      change_orders_pending: row.change_orders_pending,
      change_orders_approved: row.change_orders_approved,
      pending_change_order_value: row.pending_change_order_value,
      approved_change_order_value: row.approved_change_order_value,
    }),
    completion: scheduleCompletion(scheduleTasks, count(row.schedule_complete)),
  };
}
