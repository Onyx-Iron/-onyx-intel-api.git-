import { takeoffBlockReason, type ProcessingDocument } from "@/lib/documents/processing-display";

export interface ReadinessCheck {
  id: string;
  ok: boolean;
  label: string;
  detail: string;
}

export interface ReadinessInput {
  documents: ProcessingDocument[];
  sheets: Array<{ pageId: string; calibrated: boolean }>;
  pendingReviewCount: number;
  unpricedCount: number;
  sourceRemovedCount: number;
}

/** What still stands between the project and a priced estimate. */
export function estimateReadiness(input: ReadinessInput): { ready: boolean; checks: ReadinessCheck[] } {
  const blocked = input.documents
    .map((doc) => takeoffBlockReason(doc))
    .filter((reason): reason is string => Boolean(reason));
  const uncalibrated = input.sheets.filter((sheet) => !sheet.calibrated).length;
  const checks: ReadinessCheck[] = [
    {
      id: "documents",
      ok: blocked.length === 0,
      label: "Plans parsed",
      detail: blocked.length === 0
        ? "Every drawing is complete enough to measure."
        : blocked.slice(0, 3).join(" "),
    },
    {
      id: "scale",
      ok: uncalibrated === 0,
      label: "Sheets scaled",
      detail: uncalibrated === 0
        ? "Every drawing page has a verified scale."
        : `${uncalibrated} sheet${uncalibrated === 1 ? "" : "s"} still need${uncalibrated === 1 ? "s" : ""} a scale before a measurement can be saved.`,
    },
    {
      id: "review",
      ok: input.pendingReviewCount === 0,
      label: "Findings reviewed",
      detail: input.pendingReviewCount === 0
        ? "No AI finding is waiting for approve or reject."
        : `${input.pendingReviewCount} AI finding${input.pendingReviewCount === 1 ? "" : "s"} still need${input.pendingReviewCount === 1 ? "s" : ""} a decision and cannot enter a total.`,
    },
    {
      id: "rates",
      ok: input.unpricedCount === 0,
      label: "Lines priced",
      detail: input.unpricedCount === 0
        ? "Every remaining line has a rate."
        : `${input.unpricedCount} line${input.unpricedCount === 1 ? "" : "s"} stay${input.unpricedCount === 1 ? "s" : ""} in the grid without a rate and ${input.unpricedCount === 1 ? "is" : "are"} left out of the sell price.`,
    },
    {
      id: "sources",
      ok: input.sourceRemovedCount === 0,
      label: "Sources current",
      detail: input.sourceRemovedCount === 0
        ? "No priced line is pointing at a deleted measurement."
        : `${input.sourceRemovedCount} draft line${input.sourceRemovedCount === 1 ? "" : "s"} marked source removed.`,
    },
  ];
  return { ready: checks.every((check) => check.ok), checks };
}
