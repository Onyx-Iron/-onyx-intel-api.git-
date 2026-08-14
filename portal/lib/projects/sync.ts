export interface ProjectSyncChange {
  id: string;
  revision: number;
  table_name: string;
  entity_id: string | null;
  operation: "insert" | "update" | "delete";
  actor_user_id: string;
  transaction_id: number;
  changed_at: string;
}

export interface ProjectSyncSnapshot {
  project_id: string;
  revision: number;
  updated_at: string | null;
  last_table: string | null;
  last_entity_id: string | null;
  last_operation: ProjectSyncChange["operation"] | null;
  changes: ProjectSyncChange[];
}

export function normalizeProjectSyncSnapshot(value: unknown): ProjectSyncSnapshot | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (typeof row.project_id !== "string") return null;
  const revision = Number(row.revision);
  if (!Number.isSafeInteger(revision) || revision < 0) return null;

  const changes = Array.isArray(row.changes)
    ? row.changes.flatMap((item): ProjectSyncChange[] => {
        if (!item || typeof item !== "object") return [];
        const change = item as Record<string, unknown>;
        const changeRevision = Number(change.revision);
        const transactionId = Number(change.transaction_id);
        const operation = change.operation;
        if (
          typeof change.id !== "string" ||
          !Number.isSafeInteger(changeRevision) ||
          typeof change.table_name !== "string" ||
          !["insert", "update", "delete"].includes(String(operation)) ||
          typeof change.changed_at !== "string"
        ) return [];
        return [{
          id: change.id,
          revision: changeRevision,
          table_name: change.table_name,
          entity_id: typeof change.entity_id === "string" ? change.entity_id : null,
          operation: operation as ProjectSyncChange["operation"],
          actor_user_id: typeof change.actor_user_id === "string" ? change.actor_user_id : "system",
          transaction_id: Number.isSafeInteger(transactionId) ? transactionId : 0,
          changed_at: change.changed_at,
        }];
      })
    : [];

  const lastOperation = row.last_operation;
  return {
    project_id: row.project_id,
    revision,
    updated_at: typeof row.updated_at === "string" ? row.updated_at : null,
    last_table: typeof row.last_table === "string" ? row.last_table : null,
    last_entity_id: typeof row.last_entity_id === "string" ? row.last_entity_id : null,
    last_operation: ["insert", "update", "delete"].includes(String(lastOperation))
      ? lastOperation as ProjectSyncChange["operation"]
      : null,
    changes,
  };
}
