import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getOrCreateTenant, authTenantKey, authTenantName } from "@/lib/project-controls/server";
import { requirePermission } from "@/lib/project-controls/route-guards";
import { generateText } from "@/lib/ai/providers";
import { logEvent } from "@/lib/activity";

export const runtime = "nodejs";

/**
 * LLMO "Publish win" — draft case-study copy from a won bid / project via Gemini.
 * Human must approve before POST /api/presence/publish (confirm:true).
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const { userId, orgId, orgSlug } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
  const denied = await requirePermission(tenantId, userId, "financial", "write");
  if (denied) return denied;

  const body = await req.json().catch(() => ({})) as {
    opportunity_id?: string;
    project_id?: string;
    name?: string;
    client_name?: string;
  };

  const db = await createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anyDb = db as any;

  let name = body.name?.trim() ?? "";
  let clientName = body.client_name?.trim() ?? "";
  let projectId = body.project_id ?? null;

  if (body.opportunity_id) {
    const { data: opp, error } = await anyDb
      .from("bid_opportunities")
      .select("id, name, client_name, stage, project_id")
      .eq("tenant_id", tenantId)
      .eq("id", body.opportunity_id)
      .maybeSingle();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!opp) return NextResponse.json({ error: "Opportunity not found" }, { status: 404 });
    if (opp.stage !== "won") {
      return NextResponse.json({ error: "Publish win is only for stage=won opportunities" }, { status: 400 });
    }
    name = opp.name;
    clientName = opp.client_name ?? "";
    projectId = opp.project_id;
  }

  if (!name) {
    return NextResponse.json({ error: "name or opportunity_id required" }, { status: 400 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: presence } = await anyDb
    .from("tenant_presence")
    .select("website_url, service_areas, organization_jsonld")
    .eq("tenant_id", tenantId)
    .maybeSingle();

  const { text } = await generateText({
    system:
      "You write short, factual construction case-study posts for organic social and LLMO. " +
      "No fake awards or invented metrics. Output plain text only (no markdown fences).",
    prompt:
      `Draft a 90–140 word win announcement for a construction company.\n` +
      `Project/bid: ${name}\n` +
      `Client: ${clientName || "undisclosed"}\n` +
      `Website: ${presence?.website_url ?? "n/a"}\n` +
      `Service areas: ${JSON.stringify(presence?.service_areas ?? [])}\n` +
      `Include one sentence useful to AI crawlers (what was delivered).`,
    maxTokens: 400,
    temperature: 0.4,
  });

  const draft = (text ?? "").trim();
  if (!draft) {
    return NextResponse.json({ error: "Draft generation returned empty text" }, { status: 502 });
  }

  if (projectId) {
    await logEvent({
      tenantId,
      userId,
      projectId,
      entityType: "social_post",
      entityId: body.opportunity_id ?? projectId,
      action: "generated",
      title: `Publish-win draft: ${name}`,
      meta: {
        href: "/dashboard/marketing",
        opportunity_id: body.opportunity_id ?? null,
        project_id: projectId,
        source: "publish_win",
      },
    });
  }

  return NextResponse.json({
    draft,
    suggested_channels: ["meta", "gbp", "linkedin_share"],
    project_id: projectId,
    case_study_markdown: `## ${name}\n\n${draft}\n`,
  });
}
