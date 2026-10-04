/** A vision model may count a schedule. Every other finding stays a suggestion with no quantity. */
export function visionStoredQuantity(source: string | null | undefined, quantity: number): number | null {
  if (source === "schedule" && Number.isFinite(quantity)) return quantity;
  return null;
}
