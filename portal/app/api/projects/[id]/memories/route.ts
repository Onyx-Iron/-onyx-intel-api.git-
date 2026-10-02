import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getOrCreateTenant, authTenantKey, authTenantName, assertProjectBelongsToTenant } from "@/lib/project-controls/server";
import { uuidSchema } from "@/lib/validation";
import { listProjectMemories, upsertMemoryFacts } from "@/lib/ai/project-memories";

export const runtime = "nodejs";

async function resolveTenant() {
  const { userId, orgId, orgSlug } = await auth();
  if (!userId) return { error: "Unauthorized", status: 401 } as const;
  const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
  return { userId, tenantId } as const;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const ctx = await resolveTenant();
    if ("error" in ctx) return NextResponse.json({ error: ctx.error }, { status: ctx.status });

    const { id } = await params;
    const parsed = uuidSchema.safeParse(id);
    if (!parsed.success) return NextResponse.json({ error: "id must be a valid UUID" }, { status: 400 });

    await assertProjectBelongsToTenant(parsed.data, ctx.tenantId);
    const db = await createServiceClient();
    const memories = await listProjectMemories(db, ctx.tenantId, parsed.data);
    return NextResponse.json({ memories });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("does not belong")) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }
    return NextResponse.json({ error: `[GET memories] ${msg}` }, { status: 500 });
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const ctx = await resolveTenant();
    if ("error" in ctx) return NextResponse.json({ error: ctx.error }, { status: ctx.status });

    const { id } = await params;
    const parsed = uuidSchema.safeParse(id);
    if (!parsed.success) return NextResponse.json({ error: "id must be a valid UUID" }, { status: 400 });

    await assertProjectBelongsToTenant(parsed.data, ctx.tenantId);

    const body = (await req.json().catch(() => ({}))) as {
      fact?: string;
      facts?: string[];
      source_document_id?: string | null;
      source_page?: number | null;
    };

    const facts = [
      ...(typeof body.fact === "string" ? [body.fact] : []),
      ...(Array.isArray(body.facts) ? body.facts.filter((f): f is string => typeof f === "string") : []),
    ];
    if (facts.length === 0) {
      return NextResponse.json({ error: "fact or facts required" }, { status: 400 });
    }

    const db = await createServiceClient();
    const inserted = await upsertMemoryFacts(
      db,
      ctx.tenantId,
      parsed.data,
      facts,
      body.source_document_id,
      body.source_page,
    );
    const memories = await listProjectMemories(db, ctx.tenantId, parsed.data);
    return NextResponse.json({ inserted, memories }, { status: inserted > 0 ? 201 : 200 });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("does not belong")) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }
    return NextResponse.json({ error: `[POST memories] ${msg}` }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const ctx = await resolveTenant();
    if ("error" in ctx) return NextResponse.json({ error: ctx.error }, { status: ctx.status });

    const { id } = await params;
    const parsed = uuidSchema.safeParse(id);
    if (!parsed.success) return NextResponse.json({ error: "id must be a valid UUID" }, { status: 400 });

    await assertProjectBelongsToTenant(parsed.data, ctx.tenantId);

    const memoryId = new URL(req.url).searchParams.get("memory_id");
    const memParsed = uuidSchema.safeParse(memoryId);
    if (!memParsed.success) {
      return NextResponse.json({ error: "memory_id query param required" }, { status: 400 });
    }

    const db = await createServiceClient();
    const { error } = await db
      .from("memories")
      .delete()
      .eq("id", memParsed.data)
      .eq("project_id", parsed.data)
      .eq("tenant_id", ctx.tenantId);

    if (error) return NextResponse.json({ error: error.message }, { status: 422 });
    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("does not belong")) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }
    return NextResponse.json({ error: `[DELETE memories] ${msg}` }, { status: 500 });
  }
}
