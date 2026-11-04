/** Rows already stored under a different tenant, project, or estimate version. */

export interface ProjectScopedId {
  id: string;
  tenant_id: string;
  project_id: string | null;
}

export interface VersionScopedId {
  id: string;
  tenant_id: string;
  estimate_version_id: string | null;
}

export function takeoffIdsOutsideProject(
  found: ProjectScopedId[],
  tenantId: string,
  projectId: string,
): string[] {
  return found
    .filter((row) => row.tenant_id !== tenantId || row.project_id !== projectId)
    .map((row) => row.id);
}

export function estimateItemIdsOutsideVersion(
  found: VersionScopedId[],
  tenantId: string,
  versionId: string,
): string[] {
  return found
    .filter((row) => row.tenant_id !== tenantId || row.estimate_version_id !== versionId)
    .map((row) => row.id);
}
