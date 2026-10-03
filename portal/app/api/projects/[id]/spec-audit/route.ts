import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getOrCreateTenant, authTenantKey, authTenantName, assertProjectBelongsToTenant } from "@/lib/project-controls/server";
import { requirePermission, ownershipDenied } from "@/lib/project-controls/route-guards";
import { draftSpecRfi, specCodesMissingFromTakeoff, type SpecChunk } from "@/lib/documents/spec-takeoff-audit";
import type { Json } from "@/lib/supabase/types";

export const runtime = "nodejs";

/**
 * POST /api/projects/:id/spec-audit
 *
 * Compares CSI codes written in spec chunks with takeoff CSI codes.
 * A miss becomes one pending-review audit row. Nothing is sent.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { userId, orgId, orgSlug } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id: projectId } = await params;
  const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
  const denied = await requirePermission(tenantId, userId, "field", "write");
  if (denied) return denied;
  try {
    await assertProjectBelongsToTenant(projectId, tenantId);
  } catch (err) {
    const owned = ownershipDenied(err);
    if (owned) return owned;
    throw err;
  }

  const db = await createServiceClient();
  const { data: specs } = await db
    .from("documents")
    .select("id, file_name")
    .eq("tenant_id", tenantId)
    .eq("project_id", projectId)
    .eq("doc_type", "spec")
    .limit(40);
  const specIds = (specs ?? []).map((doc) => doc.id);
  if (specIds.length === 0) return NextResponse.json({ drafted: 0, gaps: 0, reason: "no_specs" });

  const names = new Map((specs ?? []).map((doc) => [doc.id, doc.file_name]));
  const [{ data: chunks }, { data: takeoffs }] = await Promise.all([
    db.from("chunks")
      .select("document_id, page_number, content")
      .eq("tenant_id", tenantId)
      .eq("project_id", projectId)
      .in("document_id", specIds)
      .limit(400),
    db.from("takeoff_items")
      .select("csi_code")
      .eq("tenant_id", tenantId)
      .eq("project_id", projectId)
      .limit(500),
  ]);

  const specChunks: SpecChunk[] = (chunks ?? []).map((chunk) => ({
    document_id: chunk.document_id,
    page_number: chunk.page_number,
    content: chunk.content,
    file_name: names.get(chunk.document_id) ?? null,
  }));
  const gaps = specCodesMissingFromTakeoff(
    specChunks,
    (takeoffs ?? []).map((row) => row.csi_code).filter((code): code is string => typeof code === "string"),
  );
  if (gaps.length === 0) return NextResponse.json({ drafted: 0, gaps: 0 });

  const draft = draftSpecRfi(gaps);
  const { error } = await db.from("ai_agent_audit_trails").insert({
    tenant_id: tenantId,
    project_id: projectId,
    document_id: gaps[0].documentId,
    agent_name: "spec_takeoff_audit",
    execution_trigger: "manual_spec_audit",
    finding_summary: `${gaps.length} spec CSI code${gaps.length === 1 ? "" : "s"} are not on the takeoff. RFI drafted for review.`,
    recommendations: { action: "send_rfi", gaps, draft } as unknown as Json,
    severity: "warning",
    status: "pending_human_review",
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ drafted: 1, gaps: gaps.length });
}
