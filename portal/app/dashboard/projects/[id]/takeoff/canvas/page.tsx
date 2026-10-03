import { auth } from "@clerk/nextjs/server";
import { notFound, redirect } from "next/navigation";
import { createServiceClient } from "@/lib/supabase/server";
import { getOrCreateTenant, authTenantKey, authTenantName } from "@/lib/project-controls/server";
import SheetCanvas from "@/components/takeoff/canvas/SheetCanvas";
import { sheetProgressCopy } from "@/lib/documents/sheet-progress";
import Link from "next/link";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ page_id?: string; document_id?: string }>;
}

interface PageRow {
  id: string;
  page_number: number;
  document_id: string;
  status: string;
}

/**
 * Sheet Canvas workspace. Renders a single page of a project drawing with
 * calibration + count/length/area tools overlaid. Persistence hits:
 *   - /api/takeoff/canvas/page-url        (signed URL for the PDF)
 *   - /api/takeoff/canvas/calibration     (get/put scale)
 *   - /api/takeoff/canvas/manual          (list/save takeoffs)
 *
 * Query params:
 *   ?page_id=<uuid>            → open a specific page directly
 *   ?document_id=<uuid>        → default to page 1 of that document
 * If neither is present, we pick the newest split page for the project.
 */
export default async function CanvasPage({ params, searchParams }: PageProps) {
  const { id: projectId } = await params;
  const sp = await searchParams;

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

  // Resolve the target page.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anyDb = db as any;
  let page: PageRow | null = null;
  if (sp.page_id) {
    const { data } = await anyDb
      .from("document_pages")
      .select("id, page_number, document_id, status")
      .eq("id", sp.page_id).eq("tenant_id", tenantId).single();
    page = (data ?? null) as PageRow | null;
  } else if (sp.document_id) {
    const { data } = await anyDb
      .from("document_pages")
      .select("id, page_number, document_id, status")
      .eq("document_id", sp.document_id).eq("tenant_id", tenantId)
      .order("page_number", { ascending: true }).limit(1);
    page = (data?.[0] ?? null) as PageRow | null;
  } else {
    // Fallback: latest split document's first page in this project.
    const { data: docs } = await anyDb
      .from("documents")
      .select("id")
      .eq("tenant_id", tenantId).eq("project_id", projectId)
      .in("status", ["split", "processing", "done", "complete", "ready"])
      .order("uploaded_at", { ascending: false }).limit(1);
    if (docs?.[0]?.id) {
      const { data } = await anyDb
        .from("document_pages")
        .select("id, page_number, document_id, status")
        .eq("document_id", docs[0].id).eq("tenant_id", tenantId)
        .order("page_number", { ascending: true }).limit(1);
      page = (data?.[0] ?? null) as PageRow | null;
    }
  }

  if (!page) {
    const { data: splitting } = await anyDb
      .from("documents")
      .select("id, file_name, page_count, status")
      .eq("tenant_id", tenantId)
      .eq("project_id", projectId)
      .in("status", ["queued", "pending", "processing", "split", "complete_with_errors"])
      .order("uploaded_at", { ascending: false })
      .limit(8);
    const docIds = ((splitting ?? []) as Array<{ id: string }>).map((doc) => doc.id);
    let readyCount = 0;
    let readyPages: Array<{ id: string; page_number: number; document_id: string }> = [];
    if (docIds.length > 0) {
      const [{ count }, { data: ready }] = await Promise.all([
        anyDb.from("document_pages").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).in("document_id", docIds),
        anyDb.from("document_pages").select("id, page_number, document_id").eq("tenant_id", tenantId).in("document_id", docIds).order("page_number", { ascending: true }).limit(8),
      ]);
      readyCount = count ?? 0;
      readyPages = (ready ?? []) as Array<{ id: string; page_number: number; document_id: string }>;
    }
    const expected = ((splitting ?? []) as Array<{ page_count: number | null }>).reduce(
      (sum, doc) => sum + (Number(doc.page_count) || 0),
      0,
    );
    const progress = sheetProgressCopy(readyCount, expected);
    return (
      <div className="min-h-screen bg-[#06070A] text-white">
        <div className="mx-auto max-w-3xl px-6 py-16 text-center">
          <p className="text-[11px] font-bold uppercase tracking-[0.32em] text-[#CCFF00]">Sheet Canvas</p>
          <h1 className="mt-4 text-3xl font-light tracking-tight">{progress ?? "Nothing to draw on yet."}</h1>
          <p className="mt-3 text-sm text-white/50">
            {progress
              ? "Sheets appear here as soon as the split finishes a page. Open any sheet that is already ready."
              : "Import a PDF plan through the Drive picker first — the page-split pipeline creates the individual sheets this workspace renders."}
          </p>
          {readyPages.length > 0 && (
            <div className="mt-6 flex flex-wrap justify-center gap-2">
              {readyPages.map((ready) => (
                <Link
                  key={ready.id}
                  href={`/dashboard/projects/${projectId}/takeoff/canvas?page_id=${ready.id}`}
                  className="inline-flex h-8 items-center rounded-full border border-white/15 px-3 text-[11px] uppercase tracking-widest text-white/70 hover:text-white"
                >
                  Sheet {ready.page_number}
                </Link>
              ))}
            </div>
          )}
          <div className="mt-8 flex justify-center gap-3">
            <Link
              href={`/dashboard/projects/${projectId}`}
              className="inline-flex h-10 items-center justify-center rounded-full border border-white/15 bg-white/5 px-5 text-xs font-semibold uppercase tracking-widest text-white/80 hover:border-white/30 hover:text-white"
            >
              Back to project
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <SheetCanvas
      projectId={projectId}
      projectName={project.name}
      pageId={page.id}
      pageNumber={page.page_number}
      documentId={page.document_id}
    />
  );
}
