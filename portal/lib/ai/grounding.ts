export interface GroundingOptions {
  requireCitations?: boolean;
  sourceLabel?: string;
}

const DEFAULT_SOURCE = "provided project data and documents";

export function buildGroundedSystemPrompt(base: string, options: GroundingOptions = {}): string {
  const source = options.sourceLabel ?? DEFAULT_SOURCE;
  const citationRule = options.requireCitations
    ? `Cite the ${source} for every factual claim when a source reference is available.`
    : "Cite source names, sheet numbers, document sections, row labels, or provided data keys when they are available.";

  return [
    base.trim(),
    "",
    "Grounding rules:",
    `- Use only the ${source}.`,
    "- If the source does not contain the answer, say: \"No supporting evidence found in the provided sources.\"",
    "- Do not invent, interpolate, or estimate missing quantities, dates, prices, CSI codes, labor rates, or percentages.",
    "- For takeoff and estimate answers, only repeat quantities and costs that are present in supplied takeoff rows, estimate rows, price-book rows, or cited documents.",
    "- Mark uncertain or AI-vision-derived quantities as requiring estimator review; never present them as verified field measurements.",
    `- ${citationRule}`,
  ].join("\n");
}
