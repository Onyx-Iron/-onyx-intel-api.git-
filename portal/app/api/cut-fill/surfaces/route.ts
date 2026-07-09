import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getOrCreateTenant, authTenantKey, authTenantName } from "@/lib/project-controls/server";
import { computeBounds, type Point3 } from "@/lib/cutfill/sampling";
import type { Json } from "@/lib/supabase/types";

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const { userId, orgId, orgSlug } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const projectId = req.nextUrl.searchParams.get("project_id");
    if (!projectId) return NextResponse.json({ error: "project_id is required" }, { status: 400 });

    const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
    const db = await createServiceClient();
    const { data, error } = await db
      .from("cut_fill_surfaces")
      .select("id,name,type,bounds,point_count,uploaded_at")
      .eq("tenant_id", tenantId)
      .eq("project_id", projectId)
      .order("uploaded_at", { ascending: false });

    if (error) return NextResponse.json({ error: `[GET /api/cut-fill/surfaces] ${error.message}` }, { status: 500 });
    return NextResponse.json({ surfaces: data ?? [] });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `[GET /api/cut-fill/surfaces] ${msg}` }, { status: 500 });
  }
}

interface PostBody {
  project_id?: string;
  name?: string;
  type?: string;
  points?: unknown;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const { userId, orgId, orgSlug } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = (await req.json()) as PostBody;
    const { project_id, name, type } = body;
    if (!project_id) return NextResponse.json({ error: "project_id is required" }, { status: 400 });
    if (!name || !name.trim()) return NextResponse.json({ error: "name is required" }, { status: 400 });
    if (type !== "existing" && type !== "proposed") {
      return NextResponse.json({ error: "type must be 'existing' or 'proposed'" }, { status: 400 });
    }
    if (!Array.isArray(body.points) || body.points.length < 3) {
      return NextResponse.json({ error: "points must be an array of at least 3 {x,y,z}" }, { status: 400 });
    }

    const cleaned: Point3[] = [];
    for (const raw of body.points) {
      if (!raw || typeof raw !== "object") continue;
      const p = raw as { x?: unknown; y?: unknown; z?: unknown };
      const x = typeof p.x === "number" ? p.x : parseFloat(String(p.x));
      const y = typeof p.y === "number" ? p.y : parseFloat(String(p.y));
      const z = typeof p.z === "number" ? p.z : parseFloat(String(p.z));
      if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) cleaned.push({ x, y, z });
    }
    if (cleaned.length < 3) {
      return NextResponse.json({ error: "Need at least 3 valid numeric {x,y,z} points" }, { status: 400 });
    }

    const bounds = computeBounds(cleaned);
    const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
    const db = await createServiceClient();

    const { data, error } = await db
      .from("cut_fill_surfaces")
       
      .insert({
        tenant_id: tenantId,
        project_id,
        name: name.trim(),
        type,
        points: cleaned as unknown as Json,
        bounds: bounds as unknown as Json,
        point_count: cleaned.length,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any)
      .select("id,name,type,bounds,point_count,uploaded_at")
      .single();

    if (error) return NextResponse.json({ error: `[POST /api/cut-fill/surfaces] ${error.message}` }, { status: 422 });
    return NextResponse.json({ surface: data }, { status: 201 });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `[POST /api/cut-fill/surfaces] ${msg}` }, { status: 500 });
  }
}
