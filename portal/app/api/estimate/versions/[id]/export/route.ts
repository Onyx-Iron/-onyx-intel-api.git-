import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { getOrCreateTenant, authTenantKey, authTenantName } from "@/lib/project-controls/server";
import { assertPermission, PermissionError } from "@/lib/project-controls/permissions";
import { getServiceDb, loadVersionForTenant, NotFoundError } from "@/lib/estimating/versioning";
import {
  buildEstimateCsv,
  buildEstimatePdf,
  buildEstimateXlsx,
  type EstimateGroupBy,
  type ExportLine,
} from "@/lib/estimating/estimate-export";
import { fetchAllPages } from "@/lib/supabase/fetch-all";

export const runtime = "nodejs";

function groupBy(value: string | null): EstimateGroupBy {
  if (value === "type" || value === "none") return value;
  return "division";
}

/** GET /api/estimate/versions/:id/export?format=xlsx|pdf|csv&group=division|type|none */
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { userId, orgId, orgSlug } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  const format = req.nextUrl.searchParams.get("format") ?? "xlsx";
  const grouped = groupBy(req.nextUrl.searchParams.get("group"));

  const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
  try {
    await assertPermission(tenantId, userId, "financial", "read");
  } catch (e) {
    if (e instanceof PermissionError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }

  const db = await getServiceDb();
  let version;
  try {
    version = await loadVersionForTenant(db, id, tenantId);
  } catch (e) {
    if (e instanceof NotFoundError) return NextResponse.json({ error: e.message }, { status: 404 });
    throw e;
  }

  const loaded = await fetchAllPages<ExportLine>((from, to) =>
    db
      .from("estimate_items")
      .select("description, csi_code, cost_code, item_type, quantity, uom, unit_cost, total_price, pricing_status, notes, drawing_ref, location_tag, source_takeoff_id, quantity_basis")
      .eq("estimate_version_id", id)
      .eq("tenant_id", tenantId)
      .order("id", { ascending: true })
      .range(from, to),
  );
  if (loaded.error) return NextResponse.json({ error: loaded.error }, { status: 500 });
  const lines = loaded.rows;

  const { data: project } = await db
    .from("projects")
    .select("name")
    .eq("id", version.project_id)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  const projectName = (project as { name?: string } | null)?.name ?? "Estimate";
  const filename = `${projectName.replace(/[^\w-]+/g, "_")}_v${version.version_number}`;

  if (format === "csv") {
    const csv = buildEstimateCsv(lines, grouped);
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}.csv"`,
      },
    });
  }
  if (format === "pdf") {
    const pdf = await buildEstimatePdf(lines, projectName, grouped);
    return new NextResponse(Buffer.from(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}.pdf"`,
      },
    });
  }
  const xlsx = await buildEstimateXlsx(lines, grouped);
  return new NextResponse(new Uint8Array(xlsx), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}.xlsx"`,
    },
  });
}
