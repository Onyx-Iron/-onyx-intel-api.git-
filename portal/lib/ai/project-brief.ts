export interface ProjectBriefInput {
  name: string;
  status: string;
  budget: number | null;
  start_date: string | null;
  end_date: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  meta: Record<string, unknown> | null;
}

/**
 * Project context placed in the model system prompt.
 * Budget and estimate are omitted unless the caller may read financials —
 * tool redaction is not enough if the numbers are already in the prompt.
 */
export function buildProjectBrief(project: ProjectBriefInput, today: string, includeFinancial: boolean): string {
  const lines: string[] = [`\n--- Active Project Context ---`];
  lines.push(`Project: ${project.name}`);
  const location = [project.address, project.city, project.state].filter(Boolean).join(", ");
  if (location) lines.push(`Location: ${location}`);
  lines.push(`Status: ${project.status}`);
  const meta = project.meta ?? {};
  const estimate = typeof meta.estimate === "number" ? meta.estimate : null;
  const completionPct = typeof meta.completion_pct === "number" ? meta.completion_pct : null;
  if (includeFinancial && project.budget != null) {
    let budgetLine = `Budget: $${project.budget.toLocaleString()}`;
    if (estimate != null) {
      const variance = project.budget - estimate;
      const sign = variance >= 0 ? "+" : "-";
      budgetLine += ` | Estimate: $${estimate.toLocaleString()} | Variance: ${sign}$${Math.abs(variance).toLocaleString()}`;
    }
    lines.push(budgetLine);
  }
  if (completionPct != null) lines.push(`Completion: ${completionPct}%`);
  if (project.start_date || project.end_date) {
    const parts: string[] = [];
    if (project.start_date) parts.push(`Start: ${project.start_date}`);
    if (project.end_date) {
      parts.push(`End: ${project.end_date}`);
      const daysRemaining = Math.ceil(
        (new Date(project.end_date).getTime() - new Date(today).getTime()) / 86_400_000,
      );
      parts.push(daysRemaining > 0 ? `${daysRemaining}d remaining` : `${Math.abs(daysRemaining)}d overdue`);
    }
    lines.push(parts.join(" | "));
  }
  lines.push(`Today: ${today}`);
  lines.push(`--- End Project Context ---`);
  return lines.join("\n");
}
