import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getOrCreateTenant, authTenantKey, authTenantName } from "@/lib/project-controls/server";
import { requirePermission } from "@/lib/project-controls/route-guards";
import {
  runBidOmissionScanner,
  type PlanFinding,
} from "@/lib/agents/bid-omission-scanner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/estimate/bid-omission-scan
 * Cross-reference plan findings against CSI companion rules (+ optional pgvector).
 * Drafts RFIs into ai_agent_audit_trails for human approval.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const { userId, orgId, orgSlug } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = (await req.json()) as {
      project_id?: string;
      document_id?: string;
      findings?: PlanFinding[];
      /** When true, pull vision_extractions from document pages as findings. */
      from_vision?: boolean;
    };

    if (!body.project_id) {
      return NextResponse.json({ error: "project_id required" }, { status: 400 });
    }

    const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
    const denied = await requirePermission(tenantId, userId, "financial", "write");
    if (denied) return denied;

    const db = await createServiceClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const anyDb = db as any;

    let findings: PlanFinding[] = Array.isArray(body.findings) ? body.findings : [];

    if (body.from_vision || findings.length === 0) {
      let q = anyDb
        .from("document_pages")
        .select("id, page_number, vision_extractions, document_id")
        .eq("tenant_id", tenantId)
        .eq("project_id", body.project_id)
        .not("vision_extractions", "is", null)
        .limit(100);
      if (body.document_id) q = q.eq("document_id", body.document_id);
      const { data: pages } = await q;
      for (const page of pages ?? []) {
        const ve = page.vision_extractions as { items?: Array<Record<string, unknown>> } | null;
        for (const it of ve?.items ?? []) {
          findings.push({
            description: String(it.description ?? ""),
            cost_code: typeof it.cost_code === "string" ? it.cost_code : null,
            quantity: Number(it.quantity) || 0,
            unit: String(it.unit ?? "EA"),
            source: String(it.source ?? "vision"),
            sheet_ref: `p.${page.page_number}`,
            raw_text: typeof it.raw_text === "string" ? it.raw_text : undefined,
          });
        }
      }
    }

    // Also include current estimate lines so companions already in the bid aren't flagged.
    const { data: estimateLines } = await anyDb
      .from("estimate_items")
      .select("description, cost_code, quantity, unit")
      .eq("tenant_id", tenantId)
      .eq("project_id", body.project_id)
      .limit(500);
    for (const row of estimateLines ?? []) {
      findings.push({
        description: String(row.description ?? ""),
        cost_code: row.cost_code,
        quantity: Number(row.quantity) || 0,
        unit: String(row.unit ?? "EA"),
        source: "estimate",
      });
    }

    const result = await runBidOmissionScanner({
      db: anyDb,
      tenantId,
      projectId: body.project_id,
      documentId: body.document_id ?? null,
      findings,
    });

    return NextResponse.json({
      flagged: result.flagged,
      flags: result.flags,
      findings_scanned: findings.length,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
