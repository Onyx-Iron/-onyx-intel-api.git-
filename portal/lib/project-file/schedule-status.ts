/** Values allowed by schedule_tasks.status check constraint. */
export const SCHEDULE_TASK_STATUSES = ["pending", "in_progress", "complete", "blocked"] as const;

export type ScheduleTaskStatus = (typeof SCHEDULE_TASK_STATUSES)[number];

/**
 * Map a client status onto the database check.
 * The schedule screen used to send `not_started`, which the check rejects,
 * so a new task or a status click never saved.
 */
export function scheduleTaskStatusForWrite(status: string): ScheduleTaskStatus | null {
  switch (status) {
    case "not_started":
    case "pending":
      return "pending";
    case "in_progress":
    case "complete":
    case "blocked":
      return status;
    default:
      return null;
  }
}

export function scheduleTaskStatusLabel(status: string): string {
  const stored = scheduleTaskStatusForWrite(status) ?? "pending";
  switch (stored) {
    case "pending":
      return "not started";
    case "in_progress":
      return "in progress";
    case "complete":
      return "complete";
    case "blocked":
      return "blocked";
    default: {
      const unreachable: never = stored;
      return unreachable;
    }
  }
}
