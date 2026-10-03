import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getOrCreateTenant, authTenantKey, authTenantName } from "@/lib/project-controls/server";

export const runtime = "nodejs";

/**
 * List cost assemblies + components for "Place assembly" on the takeoff canvas.
 * Maps assembly_components.cost_code_ref / formula_expression → placeable rows.
 */
export async function GET(): Promise<NextResponse> {
  const { userId, orgId, orgSlug } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  // Auth-bound tenant resolution (catalog tables are global; gate by tenant membership).
  const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
  if (!tenantId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const db = await createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anyDb = db as any;
  const { data: assemblies, error } = await anyDb
    .from("cost_assemblies")
    .select("id, assembly_name, csi_code")
    .order("assembly_name", { ascending: true })
    .limit(100);
  if (error) {
    return NextResponse.json({ assemblies: [], hint: error.message });
  }

  const ids = (assemblies ?? []).map((a: { id: string }) => a.id);
  type CompRow = {
    assembly_id: string;
    cost_code_ref: string | null;
    formula_expression: string;
    item_type: string;
  };
  let components: CompRow[] = [];
  if (ids.length > 0) {
    const { data: comps } = await anyDb
      .from("assembly_components")
      .select("assembly_id, cost_code_ref, formula_expression, item_type")
      .in("assembly_id", ids)
      .order("sort_order", { ascending: true });
    components = comps ?? [];
  }

  const byAsm = new Map<string, Array<{
    cost_code: string;
    quantity_factor: number;
    unit: string;
    label: string | null;
  }>>();
  for (const c of components) {
    const code = c.cost_code_ref?.trim();
    if (!code) continue;
    const factorMatch = c.formula_expression?.match(/(\d+(?:\.\d+)?)/);
    const quantity_factor = factorMatch ? Number(factorMatch[1]) : 1;
    const list = byAsm.get(c.assembly_id) ?? [];
    list.push({
      cost_code: code,
      quantity_factor: Number.isFinite(quantity_factor) ? quantity_factor : 1,
      unit: c.item_type?.toUpperCase().includes("LF") ? "LF"
        : c.item_type?.toUpperCase().includes("SF") ? "SF"
          : "EA",
      label: c.item_type ?? null,
    });
    byAsm.set(c.assembly_id, list);
  }

  return NextResponse.json({
    assemblies: (assemblies ?? []).map((a: { id: string; assembly_name: string; csi_code: string }) => ({
      id: a.id,
      name: a.assembly_name,
      csi_code: a.csi_code,
      components: byAsm.get(a.id) ?? [],
    })),
  });
}
