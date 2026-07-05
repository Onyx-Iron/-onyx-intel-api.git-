import { auth } from "@clerk/nextjs/server";
import { notFound, redirect } from "next/navigation";
import { createServiceClient } from "@/lib/supabase/server";
import { getOrCreateTenant, authTenantKey, authTenantName } from "@/lib/project-controls/server";
import ProcurementBoard from "@/components/procurement/ProcurementBoard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function ProcurementPage({ params }: PageProps) {
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

  return <ProcurementBoard projectId={projectId} projectName={project.name} />;
}
