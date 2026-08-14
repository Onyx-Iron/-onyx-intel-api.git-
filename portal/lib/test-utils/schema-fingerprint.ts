export const REQUIRED_TAKEOFF_SCHEMA_PATHS = [
  "/tenants",
  "/projects",
  "/documents",
  "/document_pages",
  "/takeoff_items",
  "/takeoff_item_history",
  "/manual_takeoffs",
  "/sheet_calibrations",
  "/estimate_versions",
  "/estimate_items",
  "/estimate_sync_outbox",
  "/estimate_approval_previews",
  "/takeoff_jobs",
  "/takeoff_job_units",
  "/takeoff_job_events",
  "/takeoff_source_manifests",
  "/takeoff_source_lineage",
  "/project_memberships",
  "/takeoff_approval_previews",
  "/takeoff_approval_confirmations",
  "/takeoff_import_commands",
  "/takeoff_reconciliation_exceptions",
  "/rpc/apply_vision_extraction_takeoff_items",
  "/rpc/claim_outbox_events",
  "/rpc/complete_outbox_event",
  "/rpc/fail_outbox_event",
  "/rpc/retry_outbox_event",
  "/rpc/save_manual_takeoff_tx",
  "/rpc/soft_delete_manual_takeoff_tx",
  "/rpc/update_manual_takeoff_tx",
  "/rpc/transition_takeoff_state",
  "/rpc/recover_expired_takeoff_units",
  "/rpc/claim_takeoff_work_units",
  "/rpc/approve_takeoff_source_revision",
  "/rpc/confirm_takeoff_approval_preview",
  "/rpc/confirm_estimate_approval",
  "/rpc/save_estimate_version",
  "/price_observation_review_previews",
  "/price_observation_reviews",
  "/rpc/confirm_price_observation_review",
] as const;

interface OpenApiDocument {
  openapi?: unknown;
  swagger?: unknown;
  paths?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function assertTakeoffSchemaDocument(document: unknown): void {
  if (!isRecord(document)) {
    throw new Error("Supabase did not return a PostgREST OpenAPI document");
  }

  const candidate = document as OpenApiDocument;
  if ((typeof candidate.openapi !== "string" && typeof candidate.swagger !== "string") || !isRecord(candidate.paths)) {
    throw new Error("Supabase did not return a PostgREST OpenAPI document");
  }

  const available = new Set(Object.keys(candidate.paths));
  const missing = REQUIRED_TAKEOFF_SCHEMA_PATHS.filter((path) => !available.has(path));
  if (missing.length > 0) {
    throw new Error(
      "Integration test schema is not current. Apply every portal/supabase migration " +
      `to the isolated test database. Missing Data API paths: ${missing.join(", ")}`,
    );
  }
}

export interface VerifyRemoteTakeoffSchemaOptions {
  supabaseUrl: string;
  serviceKey: string;
  fetchImpl?: typeof fetch;
}

export interface VerifiedTakeoffSchema {
  projectRef: string;
  checkedPathCount: number;
}

export async function verifyRemoteTakeoffSchema({
  supabaseUrl,
  serviceKey,
  fetchImpl = fetch,
}: VerifyRemoteTakeoffSchemaOptions): Promise<VerifiedTakeoffSchema> {
  const url = new URL(supabaseUrl);
  const projectRef = url.hostname.match(/^([a-z0-9-]+)\.supabase\.co$/)?.[1];
  if (!projectRef) {
    throw new Error(`TEST_SUPABASE_URL is not a recognizable Supabase project URL: ${supabaseUrl}`);
  }

  const response = await fetchImpl(new URL("/rest/v1/", url), {
    headers: {
      Accept: "application/openapi+json",
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
    },
  });
  if (!response.ok) {
    throw new Error(
      `Could not read the isolated Supabase schema (${response.status} ${response.statusText || "HTTP error"})`,
    );
  }

  const document = await response.json();
  assertTakeoffSchemaDocument(document);
  return { projectRef, checkedPathCount: REQUIRED_TAKEOFF_SCHEMA_PATHS.length };
}
