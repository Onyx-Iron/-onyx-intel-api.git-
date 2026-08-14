import { createHash } from "node:crypto";
import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { prepareTakeoffRowsForSave } from "@/lib/estimating/takeoff-import";
import { createServiceClient } from "@/lib/supabase/server";
import { getOrCreateTenant, authTenantKey, authTenantName, assertProjectBelongsToTenant } from "@/lib/project-controls/server";
import { parsePagination, paginationMeta } from "@/lib/pagination";
import { logEvent } from "@/lib/activity";
import { takeoffItemsSchema, parseBody } from "@/lib/validation";
import { recordTakeoffHistory, recordTakeoffHistoryBatch } from "@/lib/takeoff/history";
import type { Json } from "@/lib/supabase/types";
import { automatedIntakeControlFields } from "@/lib/takeoff/intake-policy";
import { advanceTakeoffPageJob, createGovernedDocumentContext, createGovernedPageContext, type GovernedPageContext } from "@/lib/takeoff/governance-server";
import {
  validateExtractorQuantityCandidate,
  validateTextQuantityCandidate,
  type ExtractorQuantityEvidence,
  type ExtractorQuantityValidationResult,
  type TextQuantityValidationResult,
} from "@/lib/takeoff/quantity-validation";

function jsonObject(value: Json | null | undefined): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const { userId, orgId, orgSlug } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const projectId = req.nextUrl.searchParams.get("project_id");

    const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
    const { page, limit, offset } = parsePagination(req.nextUrl.searchParams, 100);
    const db = await createServiceClient();
    // project_id is optional here so the global Takeoff workspace can roll
    // up items across every project for the tenant; every project-scoped
    // caller still passes it explicitly.
    let query = db
      .from("takeoff_items")
      .select("*", { count: "exact" })
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: true });
    if (projectId) query = query.eq("project_id", projectId);
    const { data, error, count } = await query.range(offset, offset + limit - 1);

    if (error) {
      return NextResponse.json({ error: `[GET /api/takeoff/items] ${error.message}` }, { status: 500 });
    }

    return NextResponse.json({ items: data ?? [], pagination: paginationMeta(count ?? 0, page, limit) });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `[GET /api/takeoff/items] ${msg}` }, { status: 500 });
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const { userId, orgId, orgSlug } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const rawBody = await req.json();
    const validation = parseBody(takeoffItemsSchema, rawBody);
    if (!validation.success) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }
    const { project_id, rows } = validation.data;

    const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));

    // project_id is client-supplied — never trust it without verifying it
    // actually belongs to the caller's own tenant before using it to scope
    // an insert (STEP 7: "do not trust tenant_id or project_id supplied by
    // the browser without verification").
    try {
      await assertProjectBelongsToTenant(project_id, tenantId);
    } catch {
      return NextResponse.json({ error: "project_id does not belong to this tenant" }, { status: 403 });
    }

    const db = await createServiceClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const anyDb = db as any;
    const { data: existing, error: existingError } = await db
      .from("takeoff_items")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("project_id", project_id);

    if (existingError) {
      return NextResponse.json({ error: `[POST /api/takeoff/items] ${existingError.message}` }, { status: 422 });
    }

    const existingById = new Map((existing ?? []).map((row) => [row.id as string, row]));
    const existingRows = (existing ?? []).map((row) => ({
      id: row.id,
      label: row.label,
      csi_code: row.csi_code,
      division: row.division,
      quantity: row.quantity,
      unit: row.unit,
      type: row.type,
      meta: jsonObject(row.meta),
    }));

    const prepared = prepareTakeoffRowsForSave(rows, existingRows);
    if (prepared.rows.length === 0) {
      return NextResponse.json({ items: [], skipped: prepared.skipped }, { status: 201 });
    }

    type AutomatedValidation = TextQuantityValidationResult | ExtractorQuantityValidationResult;
    type GovernedRow = { context: GovernedPageContext; sourceId: string; sheetId: string | null; pageNumber: number; checksum: string; rawText: string; evidence: Record<string, unknown> | null; validation: AutomatedValidation };
    const governedRows = new Map<number, GovernedRow>();
    const sourceContexts = new Map<string, { context: GovernedPageContext; validations: AutomatedValidation[] }>();
    for (const [index, row] of prepared.rows.entries()) {
      const documentId = row.document_id;
      const pageNumber = row.page ?? 0;
      if (!documentId || pageNumber < 1) continue;
      const { data: page, error: pageError } = await anyDb.from("document_pages")
        .select("id,checksum,storage_path").eq("tenant_id", tenantId).eq("document_id", documentId)
        .eq("page_number", pageNumber).maybeSingle();
      if (pageError) return NextResponse.json({ error: pageError.message }, { status: 422 });
      let checksum = "";
      let sourceId = documentId;
      let sheetId: string | null = null;
      let groupKey = `document:${documentId}`;
      let group = sourceContexts.get(groupKey);
      if (page) {
        sourceId = page.id as string;
        sheetId = page.id as string;
        groupKey = `page:${page.id as string}`;
        checksum = typeof page.checksum === "string" ? page.checksum.trim() : "";
        if (!checksum) {
          const downloaded = await db.storage.from("plans-bucket").download(page.storage_path);
          if (downloaded.error || !downloaded.data) return NextResponse.json({ error: `Source page ${pageNumber} checksum could not be verified` }, { status: 409 });
          checksum = createHash("sha256").update(new Uint8Array(await downloaded.data.arrayBuffer())).digest("hex");
          await anyDb.from("document_pages").update({ checksum }).eq("id", page.id).eq("tenant_id", tenantId);
        }
        group = sourceContexts.get(groupKey);
        if (!group) {
          const context = await createGovernedPageContext({
            db: anyDb, tenantId, projectId: project_id, documentId, pageId: page.id,
            pageNumber, sourceChecksum: checksum, actorUserId: userId,
          });
          group = { context, validations: [] };
          sourceContexts.set(groupKey, group);
        }
      } else {
        const { data: document, error: documentError } = await anyDb.from("documents")
          .select("id,file_name,meta").eq("id", documentId).eq("tenant_id", tenantId).eq("project_id", project_id).maybeSingle();
        if (documentError) return NextResponse.json({ error: documentError.message }, { status: 422 });
        if (!document) return NextResponse.json({ error: "Source document is not available for provenance validation" }, { status: 409 });
        const documentMeta = jsonObject(document.meta as Json | null | undefined) ?? {};
        checksum = typeof documentMeta.source_checksum === "string" ? documentMeta.source_checksum.trim() : "";
        if (!checksum && typeof documentMeta.storage_path === "string") {
          const downloaded = await db.storage.from("plans-bucket").download(documentMeta.storage_path);
          if (!downloaded.error && downloaded.data) {
            checksum = createHash("sha256").update(new Uint8Array(await downloaded.data.arrayBuffer())).digest("hex");
            await anyDb.from("documents").update({ meta: { ...documentMeta, source_checksum: checksum } }).eq("id", documentId).eq("tenant_id", tenantId);
          }
        }
        if (!checksum) return NextResponse.json({ error: "Source document checksum could not be verified" }, { status: 409 });
        if (!group) {
          const documentIdentity = typeof documentMeta.revision_family === "string" ? documentMeta.revision_family : document.file_name;
          const context = await createGovernedDocumentContext({
            db: anyDb, tenantId, projectId: project_id, documentId,
            documentIdentity, documentLabel: document.file_name,
            revisionLabel: typeof documentMeta.revision === "string" ? documentMeta.revision : null,
            issueDate: typeof documentMeta.revision_date === "string" ? documentMeta.revision_date : null,
            sourceChecksum: checksum, actorUserId: userId,
          });
          group = { context, validations: [] };
          sourceContexts.set(groupKey, group);
        }
      }
      const meta = (row.meta ?? {}) as Record<string, unknown>;
      const rawText = typeof meta.quantity_basis === "string" ? meta.quantity_basis : "";
      const evidence = jsonObject(meta.quantity_evidence as Json | null | undefined);
      const validation = evidence
        ? validateExtractorQuantityCandidate(evidence as unknown as ExtractorQuantityEvidence, row.quantity ?? Number.NaN, row.unit ?? "")
        : validateTextQuantityCandidate({
            sourceChecksum: checksum,
            authoritativeChecksum: group.context.authoritativeChecksum,
            manifestVersion: group.context.manifestVersion,
            authoritativeManifestVersion: group.context.authoritativeManifestVersion,
            unit: row.unit ?? "",
            submittedQuantity: row.quantity ?? Number.NaN,
            rawText,
            sourceKind: "text",
            pageNumber,
          });
      group.validations.push(validation);
      governedRows.set(index, { context: group.context, sourceId, sheetId, pageNumber, checksum, rawText, evidence, validation });
    }

    const payload = prepared.rows.map((row, index) => {
      const isUpdate = row.id != null && existingById.has(row.id);
      const meta = (row.meta ?? {}) as Record<string, unknown>;
      const governed = governedRows.get(index);
      return {
        id: row.id ?? crypto.randomUUID(),
        tenant_id: tenantId,
        project_id,
        label: row.label ?? "Untitled item",
        csi_code: row.csi_code ?? null,
        division: row.division ?? null,
        quantity: row.quantity ?? null,
        unit: row.unit ?? null,
        rate: row.rate ?? null,
        type: row.type ?? "general",
        page: row.page ?? 0,
        document_id: row.document_id ?? null,
        meta: meta as Json,
        updated_by: userId,
        // This endpoint is automated/bulk intake. A browser-provided
        // extraction_method is never sufficient evidence for financial
        // approval; every create or edit returns to the governed review gate.
        ...automatedIntakeControlFields(meta.extraction_method),
        ...(governed ? {
          sheet_id: governed.sheetId,
          takeoff_job_id: governed.context.jobId,
          source_manifest_id: governed.context.manifestId,
          source_manifest_version: governed.context.manifestVersion,
          source_checksum: governed.checksum,
          quantity_validation_status: governed.validation.status,
          quantity_validation_reason: governed.validation.status === "blocked" ? governed.validation.reason : null,
          formula_version: governed.validation.status === "validated" ? governed.validation.formulaVersion : null,
          calculation_checksum: governed.validation.status === "validated" ? governed.validation.calculationChecksum : null,
          source_provenance: {
            source_id: governed.sourceId, page_id: governed.sheetId, document_id: row.document_id,
            page_number: governed.sheetId ? governed.pageNumber : null,
            source_kind: governed.evidence?.source_kind ?? "text",
            raw_text: governed.evidence?.source_quote ?? governed.rawText,
            source_locator: governed.evidence?.source_locator ?? null,
            measurement_basis: governed.evidence?.formula_version ?? "source_text",
            quantity_evidence: governed.evidence,
            source_checksum: governed.checksum,
            manifest_version: governed.context.manifestVersion,
          },
        } : {}),
        reviewed_by: null,
        reviewed_at: null,
        ...(isUpdate ? {} : { created_by: userId }),
      };
    });

    const { data, error } = await db
      .from("takeoff_items")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .upsert(payload as any, { onConflict: "id" })
      .select();

    if (error) {
      return NextResponse.json({ error: `[POST /api/takeoff/items] ${error.message}` }, { status: 422 });
    }

    for (const group of sourceContexts.values()) {
      await advanceTakeoffPageJob(anyDb, tenantId, group.context.jobId, group.context.unitId, userId, group.validations.every((validation) => validation.status === "validated"));
    }

    // Per-row history: "created" for genuinely new rows, "updated" (with
    // before/after) for edits to an existing row — satisfies "edits and
    // deletions preserve audit history". Batched into one insert (P-04 fix
    // from the milestone-1 validation pass — this was previously N
    // sequential awaited inserts for a batch of N takeoff items).
    await recordTakeoffHistoryBatch(anyDb, (data ?? []).map((row) => {
      const before = existingById.get(row.id as string);
      return {
        tenantId, projectId: project_id, takeoffItemId: row.id as string,
        action: (before ? "updated" : "created") as "updated" | "created",
        actorUserId: userId,
        before: before ?? null,
        after: row as Record<string, unknown>,
      };
    }));

    void logEvent({
      projectId: project_id,
      tenantId,
      userId,
      entityType: "takeoff",
      action: "created",
      title: `Takeoff updated: ${(data ?? []).length} items`,
      meta: { item_count: (data ?? []).length, skipped: prepared.skipped },
    });

    return NextResponse.json({ items: data ?? [], skipped: prepared.skipped, estimate_synced: null, approval_required: true }, { status: 201 });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `[POST /api/takeoff/items] ${msg}` }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest): Promise<NextResponse> {
  try {
    const { userId, orgId, orgSlug } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const id = req.nextUrl.searchParams.get("id");
    const project_id = req.nextUrl.searchParams.get("project_id");
    if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });
    if (!project_id) return NextResponse.json({ error: "project_id is required" }, { status: 400 });

    const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
    const db = await createServiceClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const anyDb = db as any;

    const { data: before } = await db
      .from("takeoff_items")
      .select("*")
      .eq("id", id).eq("tenant_id", tenantId).eq("project_id", project_id)
      .maybeSingle();

    const query = db.from("takeoff_items").delete().eq("id", id).eq("tenant_id", tenantId).eq("project_id", project_id);

    const { error } = await query;
    if (error) return NextResponse.json({ error: error.message }, { status: 422 });

    await recordTakeoffHistory(anyDb, {
      tenantId, projectId: project_id, takeoffItemId: id, action: "deleted",
      actorUserId: userId, before: before ?? null,
    });

    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `[DELETE /api/takeoff/items] ${msg}` }, { status: 500 });
  }
}
