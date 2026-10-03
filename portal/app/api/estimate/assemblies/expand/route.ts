import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getOrCreateTenant, authTenantKey, authTenantName } from "@/lib/project-controls/server";
import { requirePermission } from "@/lib/project-controls/route-guards";
import {
  expandRecipeComponents,
  inferRecipeKey,
  type AssemblyComponentRow,
  type RecipeVars,
} from "@/lib/estimating/assembly-recipes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/estimate/assemblies/expand
 * Body: { project_id, recipe_key?, cost_code?, description?, unit?, quantity, vars? }
 * Returns child estimate lines from a contractor recipe / global seed.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const { userId, orgId, orgSlug } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = (await req.json()) as {
      project_id?: string;
      recipe_key?: string;
      cost_code?: string;
      description?: string;
      unit?: string;
      quantity?: number;
      vars?: RecipeVars;
      assembly_id?: string;
    };

    if (!body.project_id) {
      return NextResponse.json({ error: "project_id required" }, { status: 400 });
    }
    const qty = Number(body.quantity);
    if (!Number.isFinite(qty) || qty <= 0) {
      return NextResponse.json({ error: "quantity must be > 0" }, { status: 400 });
    }

    const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
    const denied = await requirePermission(tenantId, userId, "financial", "write");
    if (denied) return denied;

    const db = await createServiceClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const anyDb = db as any;

    const recipeKey =
      body.recipe_key ||
      inferRecipeKey({
        cost_code: body.cost_code,
        description: body.description,
        unit: body.unit,
      });

    let assembly: {
      id: string;
      assembly_name: string;
      recipe_key: string | null;
      csi_code: string;
    } | null = null;

    if (body.assembly_id) {
      const { data } = await anyDb
        .from("cost_assemblies")
        .select("id, assembly_name, recipe_key, csi_code, tenant_id")
        .eq("id", body.assembly_id)
        .maybeSingle();
      assembly = data;
    } else if (recipeKey) {
      // Prefer tenant recipe, fall back to global seed (tenant_id null).
      const { data: tenantHit } = await anyDb
        .from("cost_assemblies")
        .select("id, assembly_name, recipe_key, csi_code")
        .eq("tenant_id", tenantId)
        .eq("recipe_key", recipeKey)
        .maybeSingle();
      if (tenantHit) {
        assembly = tenantHit;
      } else {
        const { data: globalHit } = await anyDb
          .from("cost_assemblies")
          .select("id, assembly_name, recipe_key, csi_code")
          .is("tenant_id", null)
          .eq("recipe_key", recipeKey)
          .maybeSingle();
        assembly = globalHit;
      }
    }

    if (!assembly) {
      return NextResponse.json(
        { error: "No matching assembly recipe", recipe_key: recipeKey },
        { status: 404 },
      );
    }

    const { data: components } = await anyDb
      .from("assembly_components")
      .select(
        "id, item_type, formula_expression, cost_code_ref, description, unit, labor_factor, material_factor, sort_order",
      )
      .eq("assembly_id", assembly.id)
      .order("sort_order", { ascending: true });

    const vars: RecipeVars = {
      qty,
      quantity: qty,
      quantity_lf: qty,
      height_ft: 8,
      thickness_in: 8,
      pipe_od_in: 8,
      depth_ft: 4,
      ...(body.vars || {}),
    };

    const lines = expandRecipeComponents(
      (components ?? []) as AssemblyComponentRow[],
      vars,
      assembly.id,
    );

    return NextResponse.json({
      assembly: {
        id: assembly.id,
        name: assembly.assembly_name,
        recipe_key: assembly.recipe_key,
        csi_code: assembly.csi_code,
      },
      driver_quantity: qty,
      vars,
      lines,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

/** GET lists available recipes for the tenant (tenant + global seeds). */
export async function GET(): Promise<NextResponse> {
  try {
    const { userId, orgId, orgSlug } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
    const denied = await requirePermission(tenantId, userId, "financial", "read");
    if (denied) return denied;

    const db = await createServiceClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const anyDb = db as any;
    const { data } = await anyDb
      .from("cost_assemblies")
      .select("id, assembly_name, recipe_key, csi_code, trigger_unit, description, tenant_id")
      .or(`tenant_id.eq.${tenantId},tenant_id.is.null`)
      .order("assembly_name");

    return NextResponse.json({ recipes: data ?? [] });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
