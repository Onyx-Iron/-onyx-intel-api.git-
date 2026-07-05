import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import type { TablesUpdate } from "@/lib/supabase/types";
import { getOrCreateTenant, authTenantKey, authTenantName } from "@/lib/project-controls/server";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function PUT(req: NextRequest, context: RouteContext): Promise<NextResponse> {
  try {
    const { userId, orgId, orgSlug } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await context.params;
    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }

    const body = await req.json();
    const { name, company, role, email, phone, notes, project_id } = body as {
      name?: string;
      company?: string;
      role?: string;
      email?: string;
      phone?: string;
      notes?: string;
      project_id?: string;
    };

    const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));

    const updates: TablesUpdate<"contacts"> = { updated_at: new Date().toISOString() };
    if (name !== undefined) updates.name = name;
    if (company !== undefined) updates.company = company;
    if (role !== undefined) updates.role = role;
    if (email !== undefined) updates.email = email;
    if (phone !== undefined) updates.phone = phone;
    if (notes !== undefined) updates.notes = notes;
    if (project_id !== undefined) updates.project_id = project_id;

    const db = await createServiceClient();
    const { data, error } = await db
      .from("contacts")
      .update(updates)
      .eq("id", id)
      .eq("tenant_id", tenantId)
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: `[PUT /api/contacts/${id}] ${error.message}` }, { status: 422 });
    }

    return NextResponse.json({ contact: data });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `[PUT /api/contacts/[id]] ${msg}` }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, context: RouteContext): Promise<NextResponse> {
  try {
    const { userId, orgId, orgSlug } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await context.params;
    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }

    const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));

    const db = await createServiceClient();
    const { error } = await db
      .from("contacts")
      .delete()
      .eq("id", id)
      .eq("tenant_id", tenantId);

    if (error) {
      return NextResponse.json({ error: `[DELETE /api/contacts/${id}] ${error.message}` }, { status: 422 });
    }

    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `[DELETE /api/contacts/[id]] ${msg}` }, { status: 500 });
  }
}
