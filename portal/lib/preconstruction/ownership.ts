interface OpportunityLinkState {
  linkedProjectId: string | null;
  projectOwned: boolean;
  linkedEstimateVersionId: string | null;
  estimateProjectId: string | null;
}

export function assertCompatibleOpportunityLinks(state: OpportunityLinkState): void {
  if (state.linkedProjectId && !state.projectOwned) {
    throw new Error("linked_project_id does not belong to this tenant");
  }
  if (state.linkedEstimateVersionId && !state.estimateProjectId) {
    throw new Error("linked_estimate_version_id does not belong to this tenant");
  }
  if (
    state.linkedProjectId
    && state.linkedEstimateVersionId
    && state.estimateProjectId !== state.linkedProjectId
  ) {
    throw new Error("Linked estimate and opportunity must belong to the same project");
  }
}

interface OwnershipQuery {
  from(table: string): {
    select(columns: string): unknown;
  };
}

interface QueryBuilder extends PromiseLike<{ data: Record<string, unknown> | null; error: unknown }> {
  eq(column: string, value: unknown): QueryBuilder;
  maybeSingle(): QueryBuilder;
}

export async function assertOpportunityLinksBelongToTenant(
  db: OwnershipQuery,
  tenantId: string,
  linkedProjectId: string | null,
  linkedEstimateVersionId: string | null,
): Promise<void> {
  const projectResult = linkedProjectId
    ? await ((db.from("projects").select("id") as QueryBuilder)
      .eq("tenant_id", tenantId)
      .eq("id", linkedProjectId)
      .maybeSingle())
    : { data: null, error: null };

  const estimateResult = linkedEstimateVersionId
    ? await ((db.from("estimate_versions").select("id,project_id") as QueryBuilder)
      .eq("tenant_id", tenantId)
      .eq("id", linkedEstimateVersionId)
      .maybeSingle())
    : { data: null, error: null };

  if (projectResult.error) throw new Error("Unable to validate linked project");
  if (estimateResult.error) throw new Error("Unable to validate linked estimate");

  assertCompatibleOpportunityLinks({
    linkedProjectId,
    projectOwned: Boolean(projectResult.data),
    linkedEstimateVersionId,
    estimateProjectId: typeof estimateResult.data?.project_id === "string"
      ? estimateResult.data.project_id
      : null,
  });
}
