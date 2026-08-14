import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { PlatformAdminError, requirePlatformAdmin } from "@/lib/auth/platform-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface OceRow {
  csi_code: string;
  description?: string;
  uom?: string | null;
  unit_cost: number;
  labor_cost?: number | null;
  material_cost?: number | null;
  equipment_cost?: number | null;
  region_type?: string;
  region_code?: string;
  observed_at?: string;
  meta?: Record<string, unknown> | null;
}

interface OceBody {
  rows?: OceRow[];
}

// POST /api/cost-catalog/ingest/oce  — OpenConstructionERP rows (national by default).
export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    await requirePlatformAdmin();
    const body = (await req.json()) as OceBody;
    const rows = Array.isArray(body.rows) ? body.rows : [];
    if (rows.length === 0) {
      return NextResponse.json(
        { error: "rows[] required" },
        { status: 400 },
      );
    }
    const db = await createServiceClient();

    const codeUpserts = rows
      .filter((r) => r.csi_code)
      .map((r) => ({
        csi_code: r.csi_code,
        division: r.csi_code.split("-")[0] ?? "00",
        description: r.description ?? r.csi_code,
        uom: r.uom ?? null,
      }));
    const { error: codeErr } = await db
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .from("cost_codes" as any)
      .upsert(codeUpserts, { onConflict: "csi_code", ignoreDuplicates: false });
    if (codeErr) {
      return NextResponse.json({ error: codeErr.message }, { status: 422 });
    }

    const csiList = Array.from(new Set(rows.map((r) => r.csi_code)));
    const { data: codeRows, error: lookupErr } = await db
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .from("cost_codes" as any)
      .select("id, csi_code")
      .in("csi_code", csiList);
    if (lookupErr) {
      return NextResponse.json(
        { error: lookupErr.message },
        { status: 500 },
      );
    }
    const idByCsi = new Map<string, string>();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const r of (codeRows ?? []) as any[]) {
      idByCsi.set(r.csi_code as string, r.id as string);
    }

    const today = new Date().toISOString().slice(0, 10);
    const priceInserts = rows.map((r) => {
      const id = idByCsi.get(r.csi_code);
      if (!id) {
        throw new Error(`cost_code id missing for ${r.csi_code}`);
      }
      if (typeof r.unit_cost !== "number") {
        throw new Error(`row for ${r.csi_code} needs unit_cost`);
      }
      return {
        cost_code_id: id,
        source: "oce",
        region_type: r.region_type ?? "national",
        region_code: r.region_code ?? "US",
        unit_cost: r.unit_cost,
        labor_cost: r.labor_cost ?? null,
        material_cost: r.material_cost ?? null,
        equipment_cost: r.equipment_cost ?? null,
        observed_at: r.observed_at ?? today,
        meta: r.meta ?? null,
      };
    });
    const { data, error } = await db
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .from("cost_prices" as any)
      .insert(priceInserts)
      .select("id");
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 422 });
    }
    return NextResponse.json(
      { inserted: data?.length ?? 0 },
      { status: 201 },
    );
  } catch (err: unknown) {
    return NextResponse.json({ error: String(err) }, { status: err instanceof PlatformAdminError ? err.status : 500 });
  }
}
