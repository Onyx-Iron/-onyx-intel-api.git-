/**
 * Pulls finished Railway CAD/IFC extracts into takeoff_items.
 *
 * POST /api/documents/upload-url/complete enqueues Celery and stores
 * meta.railway_job_id, then returns. Nothing previously polled the job, so
 * a successful extract never became takeoff rows and the documents list
 * later reclaimed the row as a timeout. Documents list polls call this
 * before that reclaim.
 */

import { createHash } from "node:crypto";
import { provenanceForNewItem } from "@/lib/takeoff/provenance";
import {
  RAILWAY_PROCESSING_KIND,
  interpretRailwayJob,
  type RailwayJobSnapshot,
} from "@/lib/documents/railwayJob";

/** Stable id so two overlapping list polls cannot insert the same extract row twice. */
function stableTakeoffId(jobId: string, index: number): string {
  const hash = createHash("sha256").update(`railway-extract:${jobId}:${index}`).digest();
  const bytes = Buffer.from(hash.subarray(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = any;

export interface SettleRailwayResult {
  imported: number;
  failed: number;
  waiting: number;
}

interface RailwayDocument {
  id: string;
  project_id: string | null;
  status: string;
  processing_started_at: string | null;
  last_error_step?: string | null;
  meta: Record<string, unknown> | null;
}

const JOB_ID_RE = /^[A-Za-z0-9_-]{1,80}$/;

async function defaultFetchJob(jobId: string): Promise<RailwayJobSnapshot | null> {
  if (!JOB_ID_RE.test(jobId)) return null;
  const { pythonApiBaseUrl, pythonApiHeaders } = await import("@/lib/python-api");
  const res = await fetch(`${pythonApiBaseUrl()}/api/jobs/${jobId}`, {
    headers: pythonApiHeaders({}),
    cache: "no-store",
  });
  if (!res.ok) return null;
  return await res.json() as RailwayJobSnapshot;
}

async function defaultSync(tenantId: string, projectId: string): Promise<void> {
  const { syncTakeoffToEstimate } = await import("@/lib/estimating/auto-sync");
  await syncTakeoffToEstimate(tenantId, projectId);
}

export async function settleRailwayExtracts(
  db: AnyDb,
  tenantId: string,
  options: {
    now?: Date;
    fetchJob?: (jobId: string) => Promise<RailwayJobSnapshot | null>;
    syncProject?: (tenantId: string, projectId: string) => Promise<void>;
  } = {},
): Promise<SettleRailwayResult> {
  const now = options.now ?? new Date();
  const fetchJob = options.fetchJob ?? defaultFetchJob;
  const syncProject = options.syncProject ?? defaultSync;
  const result: SettleRailwayResult = { imported: 0, failed: 0, waiting: 0 };

  const { data, error } = await db
    .from("documents")
    .select("id, project_id, status, processing_started_at, last_error_step, meta")
    .eq("tenant_id", tenantId)
    .in("status", ["processing", "error"])
    .contains("meta", { processing: RAILWAY_PROCESSING_KIND })
    .limit(8);
  if (error) throw error;

  const projectsToSync = new Set<string>();

  for (const doc of (data ?? []) as RailwayDocument[]) {
    const meta = doc.meta && typeof doc.meta === "object" ? doc.meta : {};
    if (typeof meta.railway_settled_at === "string") continue;
    const jobId = typeof meta.railway_job_id === "string" ? meta.railway_job_id : "";
    if (!jobId) continue;

    const enqueuedAt = typeof meta.railway_enqueued_at === "string"
      ? meta.railway_enqueued_at
      : doc.processing_started_at;

    let job: RailwayJobSnapshot | null = null;
    try {
      job = await fetchJob(jobId);
    } catch (err) {
      console.error("[settleRailwayExtracts] poll failed", doc.id, err);
      result.waiting += 1;
      continue;
    }
    if (!job) {
      result.waiting += 1;
      continue;
    }

    const decision = interpretRailwayJob(job, enqueuedAt, now);

    if (decision.action === "wait") {
      result.waiting += 1;
      const nextMeta = { ...meta };
      const patch: Record<string, unknown> = {
        processing_started_at: now.toISOString(),
      };
      if (typeof nextMeta.railway_enqueued_at !== "string" && enqueuedAt) {
        nextMeta.railway_enqueued_at = enqueuedAt;
        patch.meta = nextMeta;
      }
      // The 10-minute documents reclaim marks any processing row as error.
      // A live CAD job must stay processing, including one already mis-marked.
      if (doc.status === "error" && doc.last_error_step === "stuck_processing_reclaim") {
        patch.status = "processing";
        patch.last_error = null;
        patch.last_error_step = null;
      }
      await db.from("documents").update(patch).eq("id", doc.id).eq("tenant_id", tenantId);
      continue;
    }

    if (decision.action === "fail") {
      result.failed += 1;
      await db.from("documents").update({
        status: "error",
        last_error: decision.error.slice(0, 2000),
        last_error_step: "railway_extract",
        takeoff_status: "error",
        processing_completed_at: now.toISOString(),
        meta: {
          ...meta,
          railway_enqueued_at: enqueuedAt ?? meta.railway_enqueued_at ?? null,
          railway_settled_at: now.toISOString(),
          railway_job_status: "failure",
        },
      }).eq("id", doc.id).eq("tenant_id", tenantId);
      continue;
    }

    if (!doc.project_id) {
      result.failed += 1;
      await db.from("documents").update({
        status: "error",
        last_error: "CAD extraction finished but the document has no project.",
        last_error_step: "railway_extract",
        takeoff_status: "error",
        processing_completed_at: now.toISOString(),
        meta: {
          ...meta,
          railway_settled_at: now.toISOString(),
          railway_job_status: "failure",
        },
      }).eq("id", doc.id).eq("tenant_id", tenantId);
      continue;
    }

    const { data: existing, error: existingErr } = await db
      .from("takeoff_items")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("project_id", doc.project_id)
      .contains("meta", { railway_job_id: jobId })
      .limit(1);
    if (existingErr) {
      console.error("[settleRailwayExtracts] existing lookup failed", doc.id, existingErr);
      continue;
    }

    if ((!existing || existing.length === 0) && decision.rows.length > 0) {
      const stamp = provenanceForNewItem({
        sourceMethod: decision.sourceType || "deterministic",
      });
      const payload = decision.rows.map((row, index) => ({
        id: stableTakeoffId(jobId, index),
        tenant_id: tenantId,
        project_id: doc.project_id,
        document_id: doc.id,
        label: row.description || "Untitled item",
        csi_code: row.cost_code,
        division: row.cost_code && /^\d{2}/.test(row.cost_code) ? row.cost_code.slice(0, 2) : null,
        quantity: row.quantity,
        unit: row.unit,
        type: "takeoff_import",
        page: 0,
        created_by: null,
        review_status: stamp.review_status,
        source_method: stamp.source_method,
        origin_actor: stamp.origin_actor,
        origin_method: stamp.origin_method,
        origin_edited: stamp.origin_edited,
        meta: {
          trade: row.trade,
          quantity_basis: row.quantity_basis,
          drawing_ref: row.drawing_ref,
          location_tag: row.location_tag,
          extraction_method: stamp.source_method,
          origin_actor: stamp.origin_actor,
          origin_method: stamp.origin_method,
          railway_job_id: jobId,
        },
      }));
      const { error: insErr } = await db.from("takeoff_items").insert(payload).select("id");
      if (insErr) {
        const message = typeof insErr.message === "string" ? insErr.message : "";
        const duplicate = insErr.code === "23505" || /duplicate key/i.test(message);
        if (!duplicate) {
          console.error("[settleRailwayExtracts] insert failed", doc.id, insErr);
          continue;
        }
      }
    }

    const { error: doneErr } = await db.from("documents").update({
      status: "complete",
      processed_at: now.toISOString(),
      processing_completed_at: now.toISOString(),
      takeoff_status: "done",
      last_error: null,
      last_error_step: null,
      last_successful_step: "takeoff",
      meta: {
        ...meta,
        railway_enqueued_at: enqueuedAt ?? now.toISOString(),
        railway_settled_at: now.toISOString(),
        railway_job_status: "success",
        railway_row_count: decision.rows.length,
      },
    }).eq("id", doc.id).eq("tenant_id", tenantId).in("status", ["processing", "error"]);
    if (doneErr) {
      console.error("[settleRailwayExtracts] complete update failed", doc.id, doneErr);
      continue;
    }

    projectsToSync.add(doc.project_id);
    result.imported += 1;
  }

  for (const projectId of projectsToSync) {
    try {
      await syncProject(tenantId, projectId);
    } catch (err) {
      console.error("[settleRailwayExtracts] estimate sync failed", projectId, err);
    }
  }

  return result;
}
