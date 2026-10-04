import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { visionStoredQuantity } from "@/lib/takeoff/vision-quantity";
import { itemsFromPageGeometry, itemsFromScheduleRows, loadPageGeometry, type LocalSheetItem } from "@/lib/takeoff/local-sheet-items";
import type { ExtractedVector } from "@/lib/cad/pdf-vector-extract";
import { getOrCreateTenant, authTenantKey, authTenantName, assertPageBelongsToProject } from "@/lib/project-controls/server";
import { requirePermission, ownershipDenied } from "@/lib/project-controls/route-guards";
import { auditUpdate } from "@/lib/audit";
import { runScopeGapAgent } from "@/lib/agents/scope-gap";
import { runRfiDrafterAgent } from "@/lib/agents/rfi-drafter";
import { quantitiesAllowedForDocType, takeoffBlockReason } from "@/lib/documents/processing-display";
import { countAlreadyDecided } from "@/lib/takeoff/extraction-skip";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/supabase/types";

type ServiceClient = SupabaseClient<Database>;

export const runtime = "nodejs";
export const maxDuration = 90;

const PLANS_BUCKET = "plans-bucket";

/**
 * POST /api/takeoff/canvas/vision-extract { page_id, force? }
 *
 * Shows geometry already saved on the page: vectors and schedule rows.
 * A page with no text and no vectors stays empty.
 *
 * Idempotent: cached in document_pages.vision_extractions. Pass force=true
 * to re-run.
 *
 * GET /api/takeoff/canvas/vision-extract?page_id=  → returns cached result only.
 */

type VisionItem = LocalSheetItem;

interface VisionResult {
  items: VisionItem[];
  page_summary: string;
  extracted_at: string;
  model: string;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const { userId, orgId, orgSlug } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const pageId = req.nextUrl.searchParams.get("page_id");
  if (!pageId) return NextResponse.json({ error: "page_id required" }, { status: 400 });

  const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
  const db = await createServiceClient();
  const { data } = await db
    .from("document_pages")
    .select("vision_extractions, vision_extracted_at, document_id")
    .eq("id", pageId).eq("tenant_id", tenantId)
    .maybeSingle();

  const takeoffItems = await fetchVisionTakeoffItems(db, tenantId, data?.document_id ?? null, pageId);

  return NextResponse.json({
    result: (data?.vision_extractions ?? null) as VisionResult | null,
    extracted_at: data?.vision_extracted_at ?? null,
    takeoffItems,
  });
}

interface VisionTakeoffItemRef {
  id: string;
  review_status: string;
  rejected_reason: string | null;
}

// Vision items are matched back to their takeoff_items row via a stable
// content key (meta.item_key, set by the SQL function at insert time),
// returned as a key -> ref map rather than an array — the caller looks up
// by key, never by position.
async function fetchVisionTakeoffItems(db: ServiceClient, tenantId: string, documentId: string | null, pageId: string): Promise<Record<string, VisionTakeoffItemRef>> {
  const { data } = await db
    .from("takeoff_items")
    .select("id, review_status, rejected_reason, meta")
    .eq("tenant_id", tenantId)
    .eq("document_id", documentId ?? "")
    .contains("meta", { vision_page_id: pageId });
  const byKey: Record<string, VisionTakeoffItemRef> = {};
  for (const r of (data ?? []) as Array<{ id: string; review_status: string; rejected_reason: string | null; meta?: { item_key?: string } }>) {
    const key = r.meta?.item_key;
    if (key) byKey[key] = { id: r.id, review_status: r.review_status, rejected_reason: r.rejected_reason };
  }
  return byKey;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const { userId, orgId, orgSlug } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({})) as { page_id?: string; force?: boolean };
  if (!body.page_id) return NextResponse.json({ error: "page_id required" }, { status: 400 });

  const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
  const denied = await requirePermission(tenantId, userId, "field", "write");
  if (denied) return denied;
  const db = await createServiceClient();

  const { data: page } = await db
    .from("document_pages")
    .select("id, storage_path, page_number, vision_extractions, vision_extracted_at, document_id, vectors, ocr_text")
    .eq("id", body.page_id).eq("tenant_id", tenantId).single();
  if (!page) return NextResponse.json({ error: "Page not found" }, { status: 404 });

  {
    const { data: doc } = page.document_id
      ? await db.from("documents").select("project_id").eq("id", page.document_id).eq("tenant_id", tenantId).maybeSingle()
      : { data: null };
    const projectIdForPage = (doc as { project_id?: string } | null)?.project_id;
    if (projectIdForPage) {
      try {
        await assertPageBelongsToProject(body.page_id, projectIdForPage, tenantId);
      } catch (err) {
        const owned = ownershipDenied(err);
        if (owned) return owned;
        throw err;
      }
    }
  }

  const quantityGate = await assertDrawingQuantities(db, tenantId, page.document_id ?? null);
  if (quantityGate) return quantityGate;

  if (page.vision_extractions && !body.force) {
    const takeoffItems = await fetchVisionTakeoffItems(db, tenantId, page.document_id ?? null, body.page_id);
    const cached = page.vision_extractions as unknown as VisionResult;
    const alreadyDecided = await countDecidedVisionItems(db, tenantId, page.document_id ?? null, body.page_id, cached.items ?? []);
    return NextResponse.json({ result: cached, cached: true, takeoffItems, already_decided: alreadyDecided });
  }

  let vectors = Array.isArray(page.vectors) ? page.vectors as unknown as ExtractedVector[] : [];
  let pageText = typeof page.ocr_text === "string" ? page.ocr_text : "";
  if (vectors.length === 0 || !pageText.trim()) {
    const dl = await db.storage.from(PLANS_BUCKET).download(page.storage_path);
    if (!dl.error && dl.data) {
      const loaded = await loadPageGeometry(new Uint8Array(await dl.data.arrayBuffer()));
      if (vectors.length === 0) vectors = loaded.vectors;
      if (!pageText.trim()) pageText = loaded.text;
    }
  }
  const geometry = itemsFromPageGeometry(vectors, pageText);
  const { data: scheduleRows } = page.document_id
    ? await db.from("takeoff_items")
      .select("label, quantity, unit, csi_code")
      .eq("tenant_id", tenantId)
      .eq("document_id", page.document_id)
      .eq("page", page.page_number ?? 0)
      .eq("source_method", "deterministic")
    : { data: [] };
  const items: VisionItem[] = [...geometry.items, ...itemsFromScheduleRows(scheduleRows ?? [])].slice(0, 500);

  const result: VisionResult = {
    items,
    page_summary: geometry.page_summary,
    extracted_at: new Date().toISOString(),
    model: "pdfjs",
  };

  await db
    .from("document_pages")
    .update({ vision_extractions: result as unknown as Json, vision_extracted_at: result.extracted_at })
    .eq("id", body.page_id).eq("tenant_id", tenantId);

  auditUpdate({
    tenant_id: tenantId,
    user_id: userId,
    table_name: "document_pages",
    record_id: body.page_id,
    old_values: {
      vision_extractions: page.vision_extractions,
      vision_extracted_at: page.vision_extracted_at,
    } as unknown as Record<string, unknown>,
    new_values: {
      vision_extractions: result,
      vision_extracted_at: result.extracted_at,
    } as unknown as Record<string, unknown>,
  });

  // ── Auto-commit into takeoff_items (atomically, via Postgres function) ───
  // Every AI-vision finding is committed as review_status "suggested" —
  // visible in the takeoff grid immediately, but excluded from the estimate
  // until a human explicitly approves or rejects it via
  // PATCH /api/takeoff/items/[id]/review.
  //
  // apply_vision_extraction_takeoff_items (see the migration that defines
  // it) does the delete-stale-suggestions + insert-fresh-ones + history
  // logging in ONE Postgres function call — a single transaction, not two
  // separate round trips. Critically, it only replaces rows still in
  // "suggested"/"reviewed" state; a previously approved or rejected item is
  // never touched by a re-extraction, and a freshly extracted finding whose
  // content matches an already-decided item is skipped rather than
  // re-suggested. This fixes a real bug where "refresh" used to delete
  // every AI-vision row for the page unconditionally, silently reverting
  // any decisions an estimator had already made.
  let projectId: string | null = null;
  {
    const { data: doc } = page.document_id
      ? await db.from("documents").select("project_id").eq("id", page.document_id).eq("tenant_id", tenantId).maybeSingle()
      : { data: null };
    projectId = (doc as { project_id?: string } | null)?.project_id ?? null;
  }
  if (projectId && page.document_id) {
    const { error: rpcErr } = await db.rpc("apply_vision_extraction_takeoff_items", {
      p_tenant_id: tenantId,
      p_project_id: projectId,
      p_document_id: page.document_id,
      p_page_id: body.page_id,
      p_page_number: (page as { page_number?: number }).page_number ?? 0,
      p_items: items.map((it) => ({
        description: it.description,
        quantity: visionStoredQuantity(it.source, it.quantity),
        unit: it.unit,
        cost_code: it.cost_code ?? null,
        layer_hint: it.layer_hint ?? null,
        source: it.source,
        confidence: it.confidence,
        raw_text: it.raw_text ?? null,
      })),
    });
    if (rpcErr) console.error("[vision-extract] apply_vision_extraction_takeoff_items failed", rpcErr);
    // Do NOT sync to estimate here — "suggested" items are excluded by
    // buildEstimateImportRows anyway, so a sync call here would be wasted
    // work (nothing new can be approved without a human action first).
  }

  // ── Background agents (fire-and-forget) ──────────────────────────────────
  // Agents ONLY write to `ai_agent_audit_trails` with status
  // 'pending_human_review'. They cannot mutate estimates, send RFIs, or push
  // purchasing metrics until the human clicks Approve.
  void runBackgroundAgents({
    db: db,
    tenantId,
    projectId: null,
    pageId: page.id,
    documentId: (page as { document_id?: string }).document_id ?? null,
    pageNumber: (page as { page_number?: number }).page_number ?? 1,
    visionItems: items,
  }).catch((e) => console.error("[agents]", e));

  const takeoffItems = await fetchVisionTakeoffItems(db, tenantId, page.document_id ?? null, body.page_id);
  const alreadyDecided = await countDecidedVisionItems(db, tenantId, page.document_id ?? null, body.page_id, items);
  return NextResponse.json({ result, cached: false, takeoffItems, already_decided: alreadyDecided });
}

async function assertDrawingQuantities(db: ServiceClient, tenantId: string, documentId: string | null): Promise<NextResponse | null> {
  if (!documentId) return null;
  const { data: doc } = await db
    .from("documents")
    .select("status, doc_type, page_count, last_error, last_error_step, split_status, ocr_status, vector_status, meta")
    .eq("id", documentId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (!doc) return null;
  if (!quantitiesAllowedForDocType(doc.doc_type)) {
    return NextResponse.json({ error: "Only drawings produce quantities. This file stays available to search.", code: "not_a_drawing" }, { status: 422 });
  }
  const meta = doc.meta && typeof doc.meta === "object" && !Array.isArray(doc.meta)
    ? doc.meta as Record<string, unknown>
    : null;
  const block = takeoffBlockReason({ ...doc, meta });
  if (block) return NextResponse.json({ error: block, code: "takeoff_blocked" }, { status: 422 });
  return null;
}

async function countDecidedVisionItems(db: ServiceClient, tenantId: string, documentId: string | null, pageId: string, items: Array<{ description?: string | null; quantity?: number | null; unit?: string | null }>): Promise<number> {
  const { data } = await db
    .from("takeoff_items")
    .select("review_status, meta")
    .eq("tenant_id", tenantId)
    .eq("document_id", documentId ?? "")
    .in("review_status", ["approved", "rejected"])
    .contains("meta", { vision_page_id: pageId });
  const keys = ((data ?? []) as Array<{ meta?: { item_key?: string } }>)
    .map((row) => row.meta?.item_key)
    .filter((key): key is string => Boolean(key));
  return countAlreadyDecided(items, keys);
}

async function runBackgroundAgents(args: { db: ServiceClient; tenantId: string; projectId: string | null; pageId: string; documentId: string | null; pageNumber: number; visionItems: VisionItem[] }): Promise<void> {
  const { db, tenantId, pageId, pageNumber, visionItems } = args;
  let projectId = args.projectId;
  let documentName: string | null = null;

  // Resolve project via document_id (page → document → project)
  if (args.documentId) {
    const { data: doc } = await db.from("documents")
      .select("project_id, file_name")
      .eq("id", args.documentId).eq("tenant_id", tenantId).maybeSingle();
    projectId = (doc as { project_id?: string })?.project_id ?? projectId;
    documentName = (doc as { file_name?: string })?.file_name ?? null;
  }
  if (!projectId) return;

  await Promise.allSettled([
    runScopeGapAgent({
      db, tenantId, projectId, pageId,
      documentId: args.documentId,
      visionItems,
    }),
    runRfiDrafterAgent({
      db, tenantId, projectId, pageId, pageNumber,
      documentId: args.documentId,
      documentName,
      visionItems,
    }),
  ]);
}
