export type ImportCommandFailure = "preview_not_confirmed" | "project_mismatch" | "missing_idempotency_key";

export function validateImportCommand(input: {
  previewStatus: string;
  previewProjectId: string;
  projectId: string;
  idempotencyKey: string;
}): { valid: boolean; reason?: ImportCommandFailure } {
  if (!input.idempotencyKey.trim()) return { valid: false, reason: "missing_idempotency_key" };
  if (input.previewProjectId !== input.projectId) return { valid: false, reason: "project_mismatch" };
  if (input.previewStatus !== "confirmed") return { valid: false, reason: "preview_not_confirmed" };
  return { valid: true };
}
