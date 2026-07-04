import { auth } from "@clerk/nextjs/server";
import { notFound, redirect } from "next/navigation";
import { createServiceClient } from "@/lib/supabase/server";
import { getOrCreateTenant, authTenantKey, authTenantName } from "@/lib/project-controls/server";
import EstimateMatrix from "@/components/estimate/EstimateMatrix";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ id: string }>;
}

/**
 * Estimation Pricing Matrix + Schedule of Values workspace.
 * Server component just resolves the project, then hands off to the client
 * grid which fetches rows + settings and calculates everything live.
 */
export default async function EstimatePage({ params }: PageProps) {
  const { id: projectId } = await params;

  const { userId, orgId, orgSlug } = await auth();
  if (!userId) redirect("/sign-in");

  const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
  const db = await createServiceClient();

  const { data: project } = await db
    .from("projects")
    .select("id, name")
    .eq("id", projectId)
    .eq("tenant_id", tenantId)
    .single();
  if (!project) notFound();

  return <EstimateMatrix projectId={projectId} projectName={project.name} />;
}
