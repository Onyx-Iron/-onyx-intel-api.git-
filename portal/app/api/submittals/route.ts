import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { buildSubmittalPayload } from "@/lib/project-controls/schema";
import {
  authTenantKey,
  authTenantName,
  getControlDb,
  getOrCreateTenant,
  requireProjectId,
} from "@/lib/project-controls/server";

export const runtime = "nodejs";

const UNAVAILABLE = { error: "Submittals are not yet available in this workspace.", code: "FEATURE_UNAVAILABLE" };

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const { userId, orgId, orgSlug } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const projectId = requireProjectId(req.nextUrl.searchParams.get("project_id"));
    const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
    const db = await getControlDb();

    const { data, error } = await db
      .from<unknown[]>("submittal_items")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("project_id", projectId)
      .order("created_at", { ascending: false });

    if (error) return NextResponse.json({ items: [] });
    return NextResponse.json({ items: data ?? [] });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    const status = msg.includes("project_id") ? 400 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const { userId, orgId, orgSlug } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = (await req.json()) as Record<string, unknown>;
    const projectId = requireProjectId(body.project_id);
    const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
    const payload = buildSubmittalPayload(body, { tenantId, projectId });
    const db = await getControlDb();

    const { data, error } = await db
      .from<unknown>("submittal_items")
      .insert(payload)
      .select()
      .single();

    if (error) return NextResponse.json({ ...UNAVAILABLE }, { status: 503 });
    return NextResponse.json({ item: data }, { status: 201 });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    const status = msg.includes("required") ? 400 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
