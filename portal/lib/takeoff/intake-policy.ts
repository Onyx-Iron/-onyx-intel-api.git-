export function automatedIntakeControlFields(extractionMethod: unknown) {
  return {
    review_status: "suggested" as const,
    source_method: extractionMethod === "ai_vision" ? "ai_vision" : "deterministic",
    quantity_validation_status: "unvalidated" as const,
    approved_by: null,
    approved_at: null,
  };
}
