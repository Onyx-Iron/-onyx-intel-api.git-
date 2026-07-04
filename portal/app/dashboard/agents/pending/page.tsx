import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { createServiceClient } from "@/lib/supabase/server";
import { getOrCreateTenant, authTenantKey, authTenantName } from "@/lib/project-controls/server";
import AgentApprovalFeed from "@/components/agents/AgentApprovalFeed";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Central Human Approval Dashboard.
 * Lists every pending agent finding across all projects and lets the user
 * approve, modify, or reject each. Nothing background can write to
 * project_estimates or draft outbound comms without a click here.
 */
export default async function AgentApprovalPage() {
  const { userId, orgId, orgSlug } = await auth();
  if (!userId) redirect("/sign-in");

  const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
  const db = await createServiceClient();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: initialItems } = await (db as any)
    .from("ai_agent_audit_trails")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("status", "pending_human_review")
    .order("created_at", { ascending: false })
    .limit(200);

  // Preload project names so the feed can label rows.
  const projectIds = Array.from(new Set(((initialItems ?? []) as Array<{ project_id: string | null }>).map((r) => r.project_id).filter(Boolean))) as string[];
  let projectNames: Record<string, string> = {};
  if (projectIds.length > 0) {
    const { data: projects } = await db.from("projects").select("id, name").in("id", projectIds).eq("tenant_id", tenantId);
    projectNames = Object.fromEntries((projects ?? []).map((p) => [p.id, p.name]));
  }

  return <AgentApprovalFeed initialItems={initialItems ?? []} projectNames={projectNames} />;
}
