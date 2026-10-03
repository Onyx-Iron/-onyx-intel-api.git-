import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getOrCreateTenant, authTenantKey, authTenantName } from "@/lib/project-controls/server";
import { requirePermission } from "@/lib/project-controls/route-guards";
import { logEvent } from "@/lib/activity";
import { auditInsert, auditUpdate } from "@/lib/audit";
import { getOrCreateDraftVersion } from "@/lib/estimating/versioning";
import { applyVersionPercentages, calculateItem } from "@/lib/estimating/calculations";

export const runtime = "nodejs";

/**
 * POST /api/agents/audit-trails/[id]/decide
 * Body: { decision: "approve" | "reject" | "modify", overrides?: { ... } }
 *
 * This is the ONLY route allowed to translate an agent finding into a
 * mutation to `estimate_items` (or into an outbound RFI record).
 * Nothing else in the codebase writes to those tables on behalf of an
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
  // Money-impacting path (estimate inserts / RFI docs) — financial write gate.
  const denied = await requirePermission(tenantId, userId, "financial", "write");
  if (denied) return denied;

  const db = await createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anyDb = db as any;

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
    const { data: rejected, error: rejErr } = await anyDb.from("ai_agent_audit_trails")
      .update({
        status: "rejected",
        reviewed_by: userId,
        reviewed_at: new Date().toISOString(),
        applied_result: appliedResult,
      })
      .eq("id", id)
      .eq("status", "pending_human_review")
      .select("id");
    if (rejErr) return NextResponse.json({ error: rejErr.message }, { status: 500 });
    if (!rejected?.length) {
      return NextResponse.json({ error: "already decided by another reviewer" }, { status: 409 });
    }
    auditUpdate({
      tenant_id: tenantId,
      user_id: userId,
      table_name: "ai_agent_audit_trails",
      record_id: id,
      old_values: { status: "pending_human_review" },
      new_values: { status: "rejected", decision },
    });
    return NextResponse.json({ ok: true, decision });
  }

  const overrides = (body.overrides ?? {}) as Record<string, unknown>;

  try {
    if (audit.agent_name === "scope_gap_verifier") {
      const gaps = ((audit.recommendations?.gaps ?? []) as Array<{ item: Record<string, unknown> }>);
      if (gaps.length === 0) {
        appliedResult.note = "no gaps to insert";
      } else {
        const { versionId } = await getOrCreateDraftVersion(anyDb, tenantId, audit.project_id, userId);
        const { data: versionRow } = await anyDb
          .from("estimate_versions")
          .select("contingency_pct, overhead_pct, profit_pct")
          .eq("id", versionId)
          .single();
        const pct = {
          contingencyPct: versionRow?.contingency_pct ?? 0,
          overheadPct: versionRow?.overhead_pct ?? 0,
          profitPct: versionRow?.profit_pct ?? 0,
        };

        const payload = gaps.map((g) => {
          const item = {
            ...g.item,
            ...(overrides.item as Record<string, unknown> | undefined ?? {}),
          };
          const quantity = Number(item.quantity ?? 0) || 0;
          const laborUnit = Number(item.labor_unit ?? 0) || 0;
          const materialUnit = Number(item.material_unit ?? 0) || 0;
          const equipmentUnit = Number(item.equipment_unit ?? 0) || 0;
          const laborCost = laborUnit * quantity;
          const materialCost = materialUnit * quantity;
          const equipmentCost = equipmentUnit * quantity;
          const totalDirectCost = laborCost + materialCost + equipmentCost;
          const unitCost = quantity > 0
            ? (laborUnit + materialUnit + equipmentUnit)
            : (laborUnit + materialUnit + equipmentUnit);
          const { contingency, overhead, profit } = applyVersionPercentages(totalDirectCost, 0, pct);
          const calc = calculateItem({
            laborCost, materialCost, equipmentCost, quantity,
            indirectCost: 0, contingency, overhead, profit,
          });
          const costCode = (item.cost_code as string | null | undefined) ?? null;
          return {
            tenant_id: tenantId,
            project_id: audit.project_id,
            estimate_version_id: versionId,
            description: String(item.description ?? "Scope gap item"),
            csi_code: costCode,
            cost_code: costCode,
            quantity,
            uom: (item.unit as string | null | undefined) ?? null,
            unit_cost: unitCost,
            labor_cost: laborCost,
            material_cost: materialCost,
            equipment_cost: equipmentCost,
            total_direct_cost: calc.totalDirectCost,
            contingency,
            overhead,
            profit,
            total_price: calc.totalPrice,
            unit_price: calc.unitPrice,
            pricing_status: unitCost > 0 ? "priced" : "unpriced",
            notes: (item.notes as string | null | undefined) ?? null,
            item_type: "material",
            created_by: userId,
            updated_by: userId,
          };
        });

        const { data: inserted, error: insErr } = await anyDb
          .from("estimate_items")
          .insert(payload)
          .select("id");
        if (insErr) throw new Error(`insert estimate: ${insErr.message}`);
        appliedResult = { decision, inserted_ids: (inserted ?? []).map((r: { id: string }) => r.id), count: inserted?.length ?? 0, version_id: versionId };

        for (const row of inserted ?? []) {
          auditInsert({
            tenant_id: tenantId,
            user_id: userId,
            table_name: "estimate_items",
            record_id: row.id,
            new_values: { source: "scope_gap_verifier", audit_id: id, version_id: versionId },
          });
        }

        void logEvent({
          projectId: audit.project_id,
          tenantId,
          userId,
          entityType: "estimate",
          entityId: (inserted?.[0]?.id as string) ?? audit.project_id,
          action: "created",
          title: `Scope-gap approved: ${gaps.length} line${gaps.length === 1 ? "" : "s"} added to estimate`,
          meta: { audit_id: id, version_id: versionId },
        });
      }
    }
    else if (audit.agent_name === "rfi_drafter") {
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

        auditInsert({
          tenant_id: tenantId,
          user_id: userId,
          table_name: "documents",
          record_id: doc.id,
          new_values: { source: "rfi_drafter_agent", audit_id: id, subject: draft.subject },
        });

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

  const nextStatus = decision === "modify" ? "approved_with_modifications" : "approved";
  const { data: decided, error: decideErr } = await anyDb.from("ai_agent_audit_trails")
    .update({
      status: nextStatus,
      reviewed_by: userId,
      reviewed_at: new Date().toISOString(),
      applied_result: appliedResult,
    })
    .eq("id", id)
    .eq("status", "pending_human_review")
    .select("id");
  if (decideErr) return NextResponse.json({ error: decideErr.message }, { status: 500 });
  if (!decided?.length) {
    return NextResponse.json({ error: "already decided by another reviewer" }, { status: 409 });
  }

  auditUpdate({
    tenant_id: tenantId,
    user_id: userId,
    table_name: "ai_agent_audit_trails",
    record_id: id,
    old_values: { status: "pending_human_review" },
    new_values: { status: nextStatus, ...appliedResult },
  });

  return NextResponse.json({ ok: true, ...appliedResult });
}
