import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import type { TablesInsert } from "@/lib/supabase/types";
import { getOrCreateTenant, authTenantKey, authTenantName } from "@/lib/project-controls/server";

export async function GET(): Promise<NextResponse> {
  try {
    const { userId, orgId, orgSlug } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));

    const db = await createServiceClient();
    const { data, error } = await db
      .from("projects")
      .select("*")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false });

    if (error) {
      return NextResponse.json(
        { error: `[GET /api/projects] ${error.message}` },
        { status: 500 },
      );
    }

    return NextResponse.json({ projects: data ?? [] });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `[GET /api/projects] ${msg}` }, { status: 500 });
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const { userId, orgId, orgSlug } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const { name, address, city, state, status, start_date, end_date, budget } = body;

    if (!name || typeof name !== "string" || name.trim().length === 0) {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }

    const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));

    const payload: TablesInsert<"projects"> = {
      tenant_id: tenantId,
      name: name.trim(),
      address: address ?? null,
      city: city ?? null,
      state: state ?? null,
      status: status ?? "active",
      start_date: start_date ?? null,
      end_date: end_date ?? null,
      budget: budget ?? null,
    };

    const db = await createServiceClient();
    const { data, error } = await db
      .from("projects")
      .insert(payload)
      .select()
      .single();

    if (error) {
      return NextResponse.json(
        { error: `[POST /api/projects] ${error.message}` },
        { status: 422 },
      );
    }

    return NextResponse.json({ project: data }, { status: 201 });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `[POST /api/projects] ${msg}` }, { status: 500 });
  }
}
