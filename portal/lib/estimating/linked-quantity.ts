/** A line linked to a measurement keeps that quantity until the estimator unlinks it. */
export function quantityForLinkedLine(
  existingQuantity: number | null | undefined,
  submittedQuantity: number | null | undefined,
  sourceTakeoffId: string | null | undefined,
  unlinking: boolean,
): number | null | undefined {
  if (sourceTakeoffId && !unlinking) return existingQuantity;
  return submittedQuantity;
}
