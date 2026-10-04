import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getOrCreateTenant, authTenantKey, authTenantName } from "@/lib/project-controls/server";
import { requirePermission } from "@/lib/project-controls/route-guards";
import { getUserRole } from "@/lib/project-controls/permissions";
import { redactOpportunityRows } from "@/lib/project-controls/financial-redaction";
import { isBidStage } from "@/lib/preconstruction/stages";
import { logEvent } from "@/lib/activity";

export const runtime = "nodejs";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const { userId, orgId, orgSlug } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
  const db = await createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anyDb = db as any;

  const due = req.nextUrl.searchParams.get("due");
  const stage = req.nextUrl.searchParams.get("stage");
  const projectId = req.nextUrl.searchParams.get("project_id");

  let query = anyDb
    .from("bid_opportunities")
    .select("*")
    .eq("tenant_id", tenantId)
    .order("due_at", { ascending: true, nullsFirst: false });

  if (stage && isBidStage(stage)) query = query.eq("stage", stage);
  if (projectId) query = query.eq("project_id", projectId);

  if (due === "7d") {
    const until = new Date();
    until.setDate(until.getDate() + 7);
    query = query
      .not("due_at", "is", null)
      .lte("due_at", until.toISOString())
      .gte("due_at", new Date().toISOString())
      .not("stage", "in", '("won","lost","no_bid")');
  }

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const role = await getUserRole(tenantId, userId);
  const opportunities = redactOpportunityRows((data ?? []) as Record<string, unknown>[], role);
  return NextResponse.json({ opportunities });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const { userId, orgId, orgSlug } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
  const denied = await requirePermission(tenantId, userId, "field", "write");
  if (denied) return denied;

  const body = await req.json().catch(() => ({})) as {
    name?: string;
    client_name?: string;
    stage?: string;
    due_at?: string | null;
    bid_value?: number | null;
    win_probability?: number | null;
    project_id?: string | null;
    source?: string;
    notes?: string;
    meta?: Record<string, unknown>;
  };

  if (!body.name?.trim()) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }
  const stage = body.stage && isBidStage(body.stage) ? body.stage : "identified";

  const db = await createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (db as any)
    .from("bid_opportunities")
    .insert({
      tenant_id: tenantId,
      name: body.name.trim(),
      client_name: body.client_name?.trim() || null,
      stage,
      due_at: body.due_at ?? null,
      bid_value: body.bid_value ?? null,
      win_probability: body.win_probability ?? null,
      project_id: body.project_id ?? null,
      source: body.source ?? "manual",
      notes: body.notes ?? null,
      meta: body.meta ?? {},
      created_by: userId,
    })
    .select("*")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if (data.project_id) {
    void logEvent({
      projectId: data.project_id,
      tenantId,
      userId,
      entityType: "bid_opportunity",
      entityId: data.id,
      action: "created",
      title: `Bid opportunity created: ${data.name}`,
      meta: { href: "/dashboard/preconstruction", stage: data.stage },
    });
  }

  return NextResponse.json({ opportunity: data }, { status: 201 });
}
