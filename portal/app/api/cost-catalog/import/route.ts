import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getOrCreateTenant, authTenantKey, authTenantName } from "@/lib/project-controls/server";
import { requirePermission } from "@/lib/project-controls/route-guards";
import { auditInsert, auditUpdate } from "@/lib/audit";
import { parsePriceCsv, unitsMatch, type ParsedPriceRow, type PriceReject } from "@/lib/cost/price-import";

export const runtime = "nodejs";

/**
 * POST { csv } writes company unit prices into cost_overrides.
 * Estimate lines are not written here.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const { userId, orgId, orgSlug } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
    const denied = await requirePermission(tenantId, userId, "financial", "write");
    if (denied) return denied;

    const body = await req.json().catch(() => ({})) as { csv?: unknown };
    const csv = typeof body.csv === "string" ? body.csv : "";
    if (!csv.trim()) return NextResponse.json({ error: "csv is required" }, { status: 400 });

    const parsed = parsePriceCsv(csv);
    if (parsed.rows.length === 0 && parsed.rejected.length === 0) {
      return NextResponse.json({ error: "csv is empty" }, { status: 400 });
    }

    const db = await createServiceClient();
    const codes = [...new Set(parsed.rows.map((row) => row.csi_code))];
    const { data: codeRows, error: codeErr } = await db
      .from("cost_codes")
      .select("id, csi_code, uom")
      .in("csi_code", codes);
    if (codeErr) return NextResponse.json({ error: codeErr.message }, { status: 500 });

    const byCode = new Map((codeRows ?? []).map((row) => [row.csi_code, row]));
    const accepted: ParsedPriceRow[] = [];
    const rejected: PriceReject[] = [...parsed.rejected];
    for (const row of parsed.rows) {
      const known = byCode.get(row.csi_code);
      if (!known) {
        rejected.push({ line: row.line, csi_code: row.csi_code, reason: "cost code is not in the catalog" });
        continue;
      }
      if (!unitsMatch(row.unit, known.uom)) {
        rejected.push({ line: row.line, csi_code: row.csi_code, reason: "unit does not match the cost code" });
        continue;
      }
      accepted.push(row);
    }

    const codeIds = [...new Set(accepted.map((row) => byCode.get(row.csi_code)!.id))];
    const { data: existing, error: existingErr } = codeIds.length === 0
      ? { data: [], error: null }
      : await db
        .from("cost_overrides")
        .select("id, cost_code_id, region_code")
        .eq("tenant_id", tenantId)
        .in("cost_code_id", codeIds);
    if (existingErr) return NextResponse.json({ error: existingErr.message }, { status: 500 });

    const priorByKey = new Map<string, string>();
    for (const row of existing ?? []) {
      priorByKey.set(`${row.cost_code_id}|${row.region_code ?? ""}`, row.id);
    }

    let inserted = 0;
    let updated = 0;
    for (const row of accepted) {
      const code = byCode.get(row.csi_code)!;
      const key = `${code.id}|${row.region_code ?? ""}`;
      const priorId = priorByKey.get(key);
      const payload = {
        tenant_id: tenantId,
        cost_code_id: code.id,
        region_code: row.region_code,
        unit_cost: row.unit_cost,
        labor_cost: row.labor_cost,
        material_cost: row.material_cost,
        equipment_cost: row.equipment_cost,
        notes: row.description,
        effective_from: row.effective_from,
        updated_at: new Date().toISOString(),
      };
      if (priorId) {
        const { data, error } = await db
          .from("cost_overrides")
          .update(payload)
          .eq("id", priorId)
          .eq("tenant_id", tenantId)
          .select("id")
          .single();
        if (error) {
          rejected.push({ line: row.line, csi_code: row.csi_code, reason: error.message });
          continue;
        }
        updated += 1;
        auditUpdate({
          tenant_id: tenantId,
          user_id: userId,
          table_name: "cost_overrides",
          record_id: data.id,
          old_values: { id: priorId },
          new_values: payload as unknown as Record<string, unknown>,
        });
      } else {
        const { data, error } = await db
          .from("cost_overrides")
          .insert(payload)
          .select("id")
          .single();
        if (error) {
          rejected.push({ line: row.line, csi_code: row.csi_code, reason: error.message });
          continue;
        }
        inserted += 1;
        priorByKey.set(key, data.id);
        auditInsert({
          tenant_id: tenantId,
          user_id: userId,
          table_name: "cost_overrides",
          record_id: data.id,
          new_values: payload as unknown as Record<string, unknown>,
        });
      }
    }

    return NextResponse.json({
      inserted,
      updated,
      rejected: rejected.sort((a, b) => a.line - b.line),
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
