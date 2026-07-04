import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getOrCreateTenant, authTenantKey, authTenantName } from "@/lib/project-controls/server";
import { logEvent } from "@/lib/activity";

export const runtime = "nodejs";

/**
 * POST /api/agents/audit-trails/[id]/decide
 * Body: { decision: "approve" | "reject" | "modify", overrides?: { ... } }
 *
 * This is the ONLY route allowed to translate an agent finding into a
 * mutation to `project_estimates` (or into an outbound RFI record).
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
        const merged = gaps.map((g) => ({
          ...g.item,
          ...(overrides.item as Record<string, unknown> | undefined ?? {}),
          tenant_id: tenantId,
          project_id: audit.project_id,
        }));
        const { data: inserted, error: insErr } = await anyDb
          .from("project_estimates")
          .insert(merged)
          .select("id");
        if (insErr) throw new Error(`insert estimate: ${insErr.message}`);
        appliedResult = { decision, inserted_ids: (inserted ?? []).map((r: { id: string }) => r.id), count: inserted?.length ?? 0 };

        void logEvent({
          projectId: audit.project_id,
          tenantId,
          userId,
          entityType: "estimate",
          entityId: (inserted?.[0]?.id as string) ?? audit.project_id,
          action: "created",
          title: `Scope-gap approved: ${gaps.length} line${gaps.length === 1 ? "" : "s"} added to estimate`,
          meta: { audit_id: id },
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
