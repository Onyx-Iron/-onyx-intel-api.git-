// Content-derived key for matching a vision-extracted finding to its
// takeoff_items row: description|quantity(fixed 4-decimal)|unit,
// lowercased/trimmed. Must produce byte-identical output on every side that
// computes it:
//   - the SQL function apply_vision_extraction_takeoff_items (Postgres,
//     stores it as meta.item_key at insert time)
//   - this file (server route + client component both import it here)
//
// This replaces matching vision items to takeoff_items rows by ARRAY INDEX
// across two independently-ordered sources (the P-02 bug from the
// milestone-1 validation pass: a mismatch there could let an estimator
// approve/reject a different finding than the one they clicked).
export function computeItemKey(description: string, quantity: number, unit: string): string {
  return [
    description.trim().toLowerCase(),
    Number(quantity).toFixed(4),
    unit.trim().toLowerCase(),
  ].join("|");
}
