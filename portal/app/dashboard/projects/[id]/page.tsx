import { Suspense } from "react";
import { auth } from "@clerk/nextjs/server";
import { notFound } from "next/navigation";
import { createServiceClient } from "@/lib/supabase/server";
import StatusBadge from "@/components/ui/StatusBadge";
import RiskDigestCard from "@/components/project/RiskDigestCard";
import ActivityFeed from "@/components/project/ActivityFeed";
import ProjectTabs from "./ProjectTabs";
import PageHero from "@/components/layout/PageHero";
import ProjectUploadButton from "@/components/project/ProjectUploadButton";
import GenerateDocDropdown from "@/components/common/GenerateDocDropdown";
import ProjectLocationCard from "@/components/project/ProjectLocationCard";
import SyncActiveProject from "@/components/project/SyncActiveProject";

interface PageProps {
  params: Promise<{ id: string }>;
}

async function getProject(projectId: string, tenantId: string) {
  const db = await createServiceClient();
  const { data } = await db
    .from("projects")
    .select("*")
    .eq("id", projectId)
    .eq("tenant_id", tenantId)
    .single();
  return data;
}

async function getTenantId(userId: string, orgId: string | null): Promise<string | null> {
  const db = await createServiceClient();
  const orgKey = orgId ?? `user_${userId}`;
  const { data } = await db
    .from("tenants")
    .select("id")
    .eq("clerk_org_id", orgKey)
    .single();
  return data?.id ?? null;
}

export default async function ProjectDetailPage({ params }: PageProps) {
  const { id } = await params;
  const { userId, orgId } = await auth();
  if (!userId) return null;

  const tenantId = await getTenantId(userId, orgId ?? null);
  if (!tenantId) notFound();

  const project = await getProject(id, tenantId);
  if (!project) notFound();

  return (
    <div className="min-h-screen">
      <SyncActiveProject projectId={id} projectName={project.name} status={project.status} />
      <PageHero
        eyebrow="Project"
        title={project.name}
        compact
        actions={
          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            <StatusBadge status={project.status} />
            <GenerateDocDropdown projectId={id} />
            <ProjectUploadButton projectId={id} />
          </div>
        }
      >
        <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-white/40">
          <ProjectLocationCard
            projectId={id}
            initial={{
              city: project.city,
              state: project.state,
              zip_code: project.zip_code,
              latitude: project.latitude,
              longitude: project.longitude,
            }}
          />
          {project.budget != null && (
            <span className="font-mono text-white/55">${Number(project.budget).toLocaleString()} budget</span>
          )}
        </div>
      </PageHero>

      <div className="grid grid-cols-1 gap-4 px-4 pt-5 sm:px-6 lg:grid-cols-3 lg:px-10">
        <div className="lg:col-span-2">
          <ActivityFeed projectId={id} />
        </div>
        <div>
          <RiskDigestCard projectId={id} />
        </div>
      </div>

      <Suspense fallback={<div className="px-4 py-10 text-sm text-white/40 sm:px-6">Loading workspace…</div>}>
        <ProjectTabs projectId={id} projectName={project.name} />
      </Suspense>
    </div>
  );
}
