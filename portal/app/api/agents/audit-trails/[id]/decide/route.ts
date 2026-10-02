import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getOrCreateTenant, authTenantKey, authTenantName } from "@/lib/project-controls/server";
import { logEvent } from "@/lib/activity";
import { getOrCreateDraftVersion } from "@/lib/estimating/versioning";
import { calculateItem } from "@/lib/estimating/calculations";

export const runtime = "nodejs";

/**
 * POST /api/agents/audit-trails/[id]/decide
 * Body: { decision: "approve" | "reject" | "modify", overrides?: { ... } }
 *
 * This is the ONLY route allowed to translate an agent finding into a
 * mutation to `estimate_items` (or into an outbound RFI record).
 * Nothing else in the codebase writes estimate lines on behalf of an
 * agent — the invariant "no autonomous mutation" is enforced HERE.
 */

interface Body {
  decision?: "approve" | "reject" | "modify";
  overrides?: Record<string, unknown>;
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const { userId, orgId, orgSlug } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({})) as Body;
  const decision = body.decision;
  if (decision !== "approve" && decision !== "reject" && decision !== "modify") {
    return NextResponse.json({ error: "decision must be approve|reject|modify" }, { status: 400 });
  }

  const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
  const db = await createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anyDb = db as any;

  // Load the audit row (tenant-scoped)
  const { data: audit, error: auditErr } = await anyDb
    .from("ai_agent_audit_trails")
    .select("*")
    .eq("id", id).eq("tenant_id", tenantId).single();
  if (auditErr || !audit) return NextResponse.json({ error: "Audit trail not found" }, { status: 404 });
  if (audit.status !== "pending_human_review") {
    return NextResponse.json({ error: `already ${audit.status}` }, { status: 409 });
  }

  let appliedResult: Record<string, unknown> = { decision };

  if (decision === "reject") {
    await anyDb.from("ai_agent_audit_trails")
      .update({
        status: "rejected",
        reviewed_by: userId,
        reviewed_at: new Date().toISOString(),
        applied_result: appliedResult,
      })
      .eq("id", id);
    return NextResponse.json({ ok: true, decision });
  }

  // ── Approve / modify: apply the recommendations ──────────────────────────
  // Different agents have different action shapes. Dispatch by agent_name.
  const overrides = (body.overrides ?? {}) as Record<string, unknown>;

  try {
    if (audit.agent_name === "scope_gap_verifier") {
      const gaps = ((audit.recommendations?.gaps ?? []) as Array<{ item: Record<string, unknown> }>);
      if (gaps.length === 0) {
        appliedResult.note = "no gaps to insert";
      } else {
        const { versionId } = await getOrCreateDraftVersion(anyDb, tenantId, audit.project_id, userId);
        const overrideItem = (overrides.item as Record<string, unknown> | undefined) ?? {};
        const toInsert = gaps.map((g) => {
          const item = { ...g.item, ...overrideItem };
          const quantity = Number(item.quantity ?? 0);
          const laborCost = Number(item.labor_unit ?? 0) * quantity;
          const materialCost = Number(item.material_unit ?? 0) * quantity;
          const equipmentCost = Number(item.equipment_unit ?? 0) * quantity;
          const subcontractCost = Number(item.subcontractor_unit ?? 0) * quantity;
          const truckingCost = Number(item.trucking_unit ?? 0) * quantity;
          const disposalCost = Number(item.disposal_unit ?? 0) * quantity;
          const calc = calculateItem({
            laborCost, materialCost, equipmentCost, subcontractCost, truckingCost, disposalCost, quantity,
          });
          const costCode = (item.cost_code as string | null) ?? null;
          return {
            tenant_id: tenantId,
            project_id: audit.project_id,
            estimate_version_id: versionId,
            cost_code: costCode,
            csi_code: costCode,
            description: String(item.description ?? "Scope gap item"),
            quantity,
            uom: (item.unit as string | null) ?? null,
            labor_cost: laborCost,
            material_cost: materialCost,
            equipment_cost: equipmentCost,
            subcontract_cost: subcontractCost,
            trucking_cost: truckingCost,
            disposal_cost: disposalCost,
            total_direct_cost: calc.totalDirectCost,
            total_price: calc.totalPrice,
            unit_price: calc.unitPrice,
            notes: (item.notes as string | null) ?? null,
            pricing_status: "manual",
            created_by: userId,
            updated_by: userId,
            meta: { source: item.source ?? "scope_gap_agent", audit_id: id },
          };
        });
        const { data: inserted, error: insErr } = await anyDb
          .from("estimate_items")
          .insert(toInsert)
          .select("id");
        if (insErr) throw new Error(`insert estimate: ${insErr.message}`);
        appliedResult = {
          decision,
          estimate_version_id: versionId,
          inserted_ids: (inserted ?? []).map((r: { id: string }) => r.id),
          count: inserted?.length ?? 0,
        };

        void logEvent({
          projectId: audit.project_id,
          tenantId,
          userId,
          entityType: "estimate",
          entityId: versionId,
          action: "created",
          title: `Scope-gap approved: ${gaps.length} line${gaps.length === 1 ? "" : "s"} added to estimate`,
          meta: { audit_id: id, estimate_version_id: versionId },
        });
      }
    }
    else if (audit.agent_name === "rfi_drafter") {
      // Approving an RFI draft persists it as a `documents` row of type "rfi_draft"
      // — actual outbound send is a separate explicit user action later.
      const draft = audit.recommendations?.draft as { subject?: string; body?: string } | undefined;
      if (!draft?.subject || !draft?.body) {
        appliedResult.note = "no draft body to persist";
      } else {
        const { data: doc, error: docErr } = await anyDb
          .from("documents")
          .insert({
            id: crypto.randomUUID(),
            tenant_id: tenantId,
            project_id: audit.project_id,
            file_name: `RFI · ${(draft.subject ?? "auto").slice(0, 80)}.txt`,
            status: "draft",
            uploaded_at: new Date().toISOString(),
            meta: {
              source: "rfi_drafter_agent",
              audit_id: id,
              subject: draft.subject,
              body: draft.body,
              contradictions: audit.recommendations?.contradictions ?? [],
            },
          })
          .select("id")
          .single();
        if (docErr) throw new Error(`insert rfi draft: ${docErr.message}`);
        appliedResult = { decision, rfi_document_id: doc.id };

        void logEvent({
          projectId: audit.project_id,
          tenantId,
          userId,
          entityType: "document",
          entityId: doc.id,
          action: "created",
          title: `RFI drafted: ${draft.subject}`,
          meta: { audit_id: id },
        });
      }
    }
    else {
      appliedResult.note = `no dispatcher for agent "${audit.agent_name}"`;
    }
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }

  await anyDb.from("ai_agent_audit_trails")
    .update({
      status: decision === "modify" ? "approved_with_modifications" : "approved",
      reviewed_by: userId,
      reviewed_at: new Date().toISOString(),
      applied_result: appliedResult,
    })
    .eq("id", id);

  return NextResponse.json({ ok: true, ...appliedResult });
}
