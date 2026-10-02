import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getOrCreateTenant, authTenantKey, authTenantName, assertProjectBelongsToTenant } from "@/lib/project-controls/server";
import { uuidSchema } from "@/lib/validation";
import { listProjectMemories, upsertMemoryFacts } from "@/lib/ai/project-memories";
import { generateText, NoProviderError } from "@/lib/ai/providers";

export const runtime = "nodejs";

async function resolveTenant() {
  const { userId, orgId, orgSlug } = await auth();
  if (!userId) return { error: "Unauthorized", status: 401 } as const;
  const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
  return { userId, tenantId } as const;
}

/**
 * Extract durable project facts from live project state + recent document
 * summaries so Takeoff, Estimating, Field, and AI all share the same memory.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const ctx = await resolveTenant();
    if ("error" in ctx) return NextResponse.json({ error: ctx.error }, { status: ctx.status });

    const { id } = await params;
    const parsed = uuidSchema.safeParse(id);
    if (!parsed.success) return NextResponse.json({ error: "id must be a valid UUID" }, { status: 400 });

    await assertProjectBelongsToTenant(parsed.data, ctx.tenantId);
    const db = await createServiceClient();

    const { data: project } = await db
      .from("projects")
      .select("id, name, status, budget, address, city, state, start_date, end_date, meta")
      .eq("id", parsed.data)
      .eq("tenant_id", ctx.tenantId)
      .single();

    if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const anyDb = db as any;

    const [{ data: docs }, { data: rfis }, { data: takeoffs }, { count: estimateCount }] = await Promise.all([
      db
        .from("documents")
        .select("id, file_name, meta, status")
        .eq("project_id", parsed.data)
        .eq("tenant_id", ctx.tenantId)
        .order("uploaded_at", { ascending: false })
        .limit(12),
      anyDb
        .from("rfi_items")
        .select("number, subject, status")
        .eq("project_id", parsed.data)
        .eq("tenant_id", ctx.tenantId)
        .eq("status", "open")
        .limit(10),
      db
        .from("takeoff_items")
        .select("label, type, quantity, unit, csi_code")
        .eq("project_id", parsed.data)
        .eq("tenant_id", ctx.tenantId)
        .limit(20),
      db
        .from("estimate_items")
        .select("id", { count: "exact", head: true })
        .eq("project_id", parsed.data)
        .eq("tenant_id", ctx.tenantId),
    ]);

    const docSummaries = (docs ?? [])
      .map((d) => {
        const meta = (d.meta ?? {}) as Record<string, unknown>;
        const summary = typeof meta.summary === "string" ? meta.summary : null;
        return summary ? `- ${d.file_name}: ${summary.slice(0, 400)}` : `- ${d.file_name} (${d.status})`;
      })
      .join("\n");

    const rfiList = ((rfis ?? []) as Array<{ number?: string | null; subject?: string | null }>)
      .map((r) => `#${r.number ?? "?"} ${r.subject ?? ""}`)
      .join("; ");

    const takeoffSample = ((takeoffs ?? []) as Array<{
      label?: string | null;
      type?: string | null;
      quantity?: number | null;
      unit?: string | null;
    }>)
      .slice(0, 8)
      .map((t) => `${t.label ?? t.type} ${t.quantity ?? ""} ${t.unit ?? ""}`)
      .join("; ");

    const prompt = [
      "Extract up to 12 durable project facts for a construction GC platform.",
      "Facts should be useful across Takeoff, Estimating, Procurement, Field, and Closeout.",
      "Prefer concrete, stable facts (owner, GC, address, key dates, budget, systems, constraints, open risks).",
      "Return ONLY a JSON array of strings. No markdown.",
      "",
      `Project: ${project.name}`,
      `Status: ${project.status}`,
      `Location: ${[project.address, project.city, project.state].filter(Boolean).join(", ") || "unknown"}`,
      `Budget: ${project.budget ?? "unknown"}`,
      `Dates: ${project.start_date ?? "TBD"} → ${project.end_date ?? "TBD"}`,
      `Estimate line items: ${estimateCount ?? 0}`,
      `Open RFIs: ${rfiList || "none"}`,
      `Sample takeoff: ${takeoffSample || "none"}`,
      `Documents:\n${docSummaries || "(none)"}`,
    ].join("\n");

    const result = await generateText({
      prompt,
      system:
        "You extract durable construction project memory facts. Output a JSON array of short factual strings only.",
      maxTokens: 1024,
      temperature: 0.2,
    });

    let facts: string[] = [];
    try {
      const match = result.text.match(/\[[\s\S]*\]/);
      const parsedJson = JSON.parse(match?.[0] ?? result.text) as unknown;
      if (Array.isArray(parsedJson)) {
        facts = parsedJson.filter((f): f is string => typeof f === "string");
      }
    } catch {
      facts = result.text
        .split("\n")
        .map((l) => l.replace(/^[-*\d.)\s]+/, "").trim())
        .filter((l) => l.length >= 8);
    }

    const inserted = await upsertMemoryFacts(db, ctx.tenantId, parsed.data, facts);
    const memories = await listProjectMemories(db, ctx.tenantId, parsed.data);
    return NextResponse.json({ inserted, memories, provider: result.provider });
  } catch (err: unknown) {
    if (err instanceof NoProviderError) {
      return NextResponse.json({ error: err.message, code: "NO_PROVIDER" }, { status: 503 });
    }
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("does not belong")) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }
    return NextResponse.json({ error: `[extract memories] ${msg}` }, { status: 500 });
  }
}
