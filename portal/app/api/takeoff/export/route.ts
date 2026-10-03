import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import {
  getOrCreateTenant, authTenantKey, authTenantName, assertProjectBelongsToTenant,
} from "@/lib/project-controls/server";
import { ownershipDenied } from "@/lib/project-controls/route-guards";

export const runtime = "nodejs";

/** GET ?project_id=&format=csv|json — export manual takeoffs (+ mirrors summary). */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const { userId, orgId, orgSlug } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const projectId = req.nextUrl.searchParams.get("project_id");
  const format = (req.nextUrl.searchParams.get("format") ?? "json").toLowerCase();
  if (!projectId) return NextResponse.json({ error: "project_id required" }, { status: 400 });

  const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
  try { await assertProjectBelongsToTenant(projectId, tenantId); }
  catch (err) {
    const owned = ownershipDenied(err);
    if (owned) return owned;
    throw err;
  }

  const db = await createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (db as any)
    .from("manual_takeoffs")
    .select("id, label, cost_code, takeoff_type, quantity, unit, page_id, layer_id, geometry, review_status, created_at")
    .eq("tenant_id", tenantId)
    .eq("project_id", projectId)
    .is("deleted_at", null)
    .order("created_at", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const rows = data ?? [];

  if (format === "csv") {
    const header = ["id", "label", "cost_code", "takeoff_type", "quantity", "unit", "page_id", "layer_id"];
    const lines = [header.join(",")];
    for (const r of rows) {
      lines.push([
        r.id,
        JSON.stringify(r.label ?? ""),
        r.cost_code ?? "",
        r.takeoff_type ?? "",
        r.quantity ?? "",
        r.unit ?? "",
        r.page_id ?? "",
        r.layer_id ?? "",
      ].join(","));
    }
    return new NextResponse(lines.join("\n"), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="takeoff-${projectId}.csv"`,
      },
    });
  }

  return NextResponse.json({ project_id: projectId, count: rows.length, rows });
}
