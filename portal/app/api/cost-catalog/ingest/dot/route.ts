import { auth, currentUser } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ADMIN_EMAIL = "justinatteberry@onyx-iron.com";

async function requireAdmin(): Promise<NextResponse | null> {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const user = await currentUser();
  const email = user?.primaryEmailAddress?.emailAddress ?? "";
  if (email !== ADMIN_EMAIL) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return null;
}

interface DotRow {
  csi_code: string;
  description?: string;
  unit_cost: number;
  uom?: string | null;
  observed_at: string;
  labor_cost?: number | null;
  material_cost?: number | null;
  equipment_cost?: number | null;
  meta?: Record<string, unknown> | null;
}

interface DotBody {
  state?: string;
  rows?: DotRow[];
}

// POST /api/cost-catalog/ingest/dot  — bulk ingest state DOT bid tab data.
// Upserts cost_codes (by csi_code), then inserts cost_prices with
// source = "dot_<state>", region_type = "state", region_code = <state>.
export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const guard = await requireAdmin();
    if (guard) return guard;
    const body = (await req.json()) as DotBody;
    const state = (body.state ?? "").trim().toUpperCase();
    const rows = Array.isArray(body.rows) ? body.rows : [];
    if (!state) {
      return NextResponse.json(
        { error: "state required (e.g. 'TX')" },
        { status: 400 },
      );
    }
    if (rows.length === 0) {
      return NextResponse.json(
        { error: "rows[] required" },
        { status: 400 },
      );
    }
    const db = await createServiceClient();

    // 1) Upsert cost_codes
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

    // 2) Look up ids for these csi_codes
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

    // 3) Insert cost_prices
    const priceInserts = rows.map((r) => {
      const id = idByCsi.get(r.csi_code);
      if (!id) {
        throw new Error(`cost_code id missing for ${r.csi_code}`);
      }
      if (typeof r.unit_cost !== "number" || !r.observed_at) {
        throw new Error(
          `row for ${r.csi_code} needs unit_cost and observed_at`,
        );
      }
      return {
        cost_code_id: id,
        source: `dot_${state.toLowerCase()}`,
        region_type: "state",
        region_code: state,
        unit_cost: r.unit_cost,
        labor_cost: r.labor_cost ?? null,
        material_cost: r.material_cost ?? null,
        equipment_cost: r.equipment_cost ?? null,
        observed_at: r.observed_at,
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
      { inserted: data?.length ?? 0, state },
      { status: 201 },
    );
  } catch (err: unknown) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
