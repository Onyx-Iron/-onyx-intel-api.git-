import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { getOrCreateTenant, authTenantKey, authTenantName } from "@/lib/project-controls/server";
import { getServiceDb, loadVersionForTenant, NotFoundError } from "@/lib/estimating/versioning";
import { calculateEstimateTotals } from "@/lib/estimating/calculations";
import { buildProposalDocx, buildProposalPdf, type ProposalExportLine } from "@/lib/estimating/proposal-export";

export const runtime = "nodejs";

/**
 * GET /api/estimate/versions/:id/export?format=pdf|docx
 *
 * Approved versions download as a branded proposal. A draft downloads only
 * when allow_draft_preview=1, and the file says it is a preview.
 * Includes the budget snapshot when one has been saved from this version.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const { userId, orgId, orgSlug } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const format = req.nextUrl.searchParams.get("format") === "docx" ? "docx" : "pdf";
  const allowPreview = req.nextUrl.searchParams.get("allow_draft_preview") === "1";

  const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
  const db = await getServiceDb();
  let version;
  try {
    version = await loadVersionForTenant(db, id, tenantId);
  } catch (err) {
    if (err instanceof NotFoundError) return NextResponse.json({ error: err.message }, { status: 404 });
    throw err;
  }
  if (version.status !== "approved" && !allowPreview) {
    return NextResponse.json({
      error: "Only an approved version can be exported. Pass allow_draft_preview=1 to download a draft preview.",
    }, { status: 409 });
  }

  const [{ data: items, error }, { data: project }, { data: budget }] = await Promise.all([
    db.from("estimate_items")
      .select("csi_code, cost_code, description, quantity, uom, total_price, total_direct_cost, indirect_cost, contingency, overhead, profit, is_alternate, alternate_accepted")
      .eq("tenant_id", tenantId)
      .eq("estimate_version_id", id)
      .order("sort_order", { ascending: true }),
    db.from("projects").select("name").eq("id", version.project_id).eq("tenant_id", tenantId).maybeSingle(),
    db.from("project_budgets")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("source_estimate_version_id", id)
      .maybeSingle(),
  ]);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  let budgetLines: ProposalExportLine[] = [];
  if (budget?.id) {
    const { data: lines } = await db.from("project_budget_lines")
      .select("csi_code, description, quantity, uom, total_price")
      .eq("tenant_id", tenantId)
      .eq("budget_id", budget.id)
      .order("sort_order", { ascending: true });
    budgetLines = ((lines ?? []) as Array<{
      csi_code: string | null;
      description: string | null;
      quantity: number | null;
      uom: string | null;
      total_price: number | null;
    }>).map((line) => ({
      code: line.csi_code ?? "",
      description: line.description ?? "",
      quantity: Number(line.quantity ?? 0),
      unit: line.uom ?? "",
      total: Number(line.total_price ?? 0),
    }));
  }

  interface ExportItem {
    csi_code: string | null;
    cost_code: string | null;
    description: string | null;
    quantity: number | null;
    uom: string | null;
    total_price: number | null;
    total_direct_cost: number | null;
    indirect_cost: number | null;
    contingency: number | null;
    overhead: number | null;
    profit: number | null;
    is_alternate: boolean | null;
    alternate_accepted: boolean | null;
  }
  const exportItems = (items ?? []) as ExportItem[];
  const estimateLines: ProposalExportLine[] = exportItems.map((item) => ({
    code: item.csi_code || item.cost_code || "",
    description: item.description ?? "",
    quantity: Number(item.quantity ?? 0),
    unit: item.uom ?? "",
    total: Number(item.total_price ?? 0),
  }));
  const totals = calculateEstimateTotals(exportItems.map((item) => ({
    totalDirectCost: Number(item.total_direct_cost ?? 0),
    indirectCost: Number(item.indirect_cost ?? 0),
    contingency: Number(item.contingency ?? 0),
    overhead: Number(item.overhead ?? 0),
    profit: Number(item.profit ?? 0),
    totalPrice: Number(item.total_price ?? 0),
    isAlternate: Boolean(item.is_alternate),
    alternateAccepted: item.alternate_accepted == null ? null : Boolean(item.alternate_accepted),
  })));

  const input = {
    projectName: project?.name ?? "Project",
    versionLabel: `${version.version_name ?? `Version ${version.version_number}`} · ${version.status}`,
    preview: version.status !== "approved",
    lines: estimateLines,
    total: totals.totalPrice,
    budgetLines,
  };
  const bytes = format === "docx" ? buildProposalDocx(input) : await buildProposalPdf(input);
  const filename = `${(project?.name ?? "proposal").replace(/[^\w.-]+/g, "_")}.${format}`;
  return new NextResponse(Buffer.from(bytes), {
    status: 200,
    headers: {
      "Content-Type": format === "docx"
        ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        : "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
