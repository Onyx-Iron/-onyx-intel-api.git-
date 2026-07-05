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

interface BlsRow {
  series_code: string;
  division?: string | null;
  region_code: string;
  index_value: number;
  base_value?: number | null;
  observed_at: string;
  meta?: Record<string, unknown> | null;
}

interface BlsBody {
  rows?: BlsRow[];
}

// POST /api/cost-catalog/ingest/bls  — bulk ingest BLS PPI index series.
export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const guard = await requireAdmin();
    if (guard) return guard;
    const body = (await req.json()) as BlsBody;
    const rows = Array.isArray(body.rows) ? body.rows : [];
    if (rows.length === 0) {
      return NextResponse.json(
        { error: "rows[] required" },
        { status: 400 },
      );
    }
    const payload = rows.map((r) => {
      if (
        !r.series_code ||
        !r.region_code ||
        typeof r.index_value !== "number" ||
        !r.observed_at
      ) {
        throw new Error(
          "each row needs series_code, region_code, index_value, observed_at",
        );
      }
      return {
        source: "bls_ppi",
        series_code: r.series_code,
        division: r.division ?? null,
        region_code: r.region_code,
        index_value: r.index_value,
        base_value: r.base_value ?? null,
        observed_at: r.observed_at,
        meta: r.meta ?? null,
      };
    });
    const db = await createServiceClient();
    const { data, error } = await db
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .from("cost_indices" as any)
      .insert(payload)
      .select("id");
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 422 });
    }
    return NextResponse.json(
      { inserted: data?.length ?? 0 },
      { status: 201 },
    );
  } catch (err: unknown) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
