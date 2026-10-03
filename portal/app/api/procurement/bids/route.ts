import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { assertProjectBelongsToTenant } from "@/lib/project-controls/server";
import { ownershipDenied } from "@/lib/project-controls/route-guards";
import { auditInsert } from "@/lib/audit";

export const runtime = "nodejs";

/**
 * POST /api/procurement/bids — submit a vendor bid on a marketplace request.
 *
 * Deliberately UNAUTHENTICATED (no Clerk check): this is the endpoint the
 * public vendor page (/public/bids/[id]) posts to, since suppliers don't
 * have — and shouldn't need — a Clerk login. The `request_id` (a uuid) acts
 * as the capability token: knowing it is what grants permission to bid on
 * that one request, the same trust model as a Calendly/Stripe payment link.
 * We do NOT expose any endpoint that lists/enumerates requests without that
 * id, so this can't be used to browse other tenants' RFQs.
 *
 * Ownership is enforced via the looked-up request (tenant + project), not a
 * Clerk session — requirePermission cannot apply to anonymous vendors.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const body = await req.json().catch(() => ({})) as {
      request_id?: string;
      vendor_name?: string;
      contact_email?: string;
      unit_price?: number;
      lead_time_days?: number;
      notes?: string;
    };
    if (!body.request_id) return NextResponse.json({ error: "request_id required" }, { status: 400 });
    if (!body.vendor_name || !body.contact_email) return NextResponse.json({ error: "vendor_name and contact_email required" }, { status: 400 });
    if (typeof body.unit_price !== "number" || !Number.isFinite(body.unit_price) || body.unit_price <= 0) {
      return NextResponse.json({ error: "unit_price must be > 0" }, { status: 400 });
    }
    const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRe.test(body.contact_email)) return NextResponse.json({ error: "invalid contact_email" }, { status: 400 });

    const db = await createServiceClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const anyDb = db as any;

    // Look up the request ourselves (rather than trusting a client-supplied
    // tenant_id) so a bid can never be attached to the wrong tenant, and so we
    // can reject bids on requests that are no longer open.
    const { data: request, error: reqErr } = await anyDb
      .from("marketplace_requests")
      .select("id, tenant_id, project_id, status")
      .eq("id", body.request_id)
      .maybeSingle();
    if (reqErr) return NextResponse.json({ error: reqErr.message }, { status: 500 });
    if (!request) return NextResponse.json({ error: "Request not found" }, { status: 404 });
    if (request.status !== "open") return NextResponse.json({ error: `This request is no longer accepting bids (status: ${request.status})` }, { status: 409 });

    // Ownership via request: project must belong to the request's tenant.
    if (request.project_id) {
      await assertProjectBelongsToTenant(request.project_id, request.tenant_id);
    }

    const { data, error } = await anyDb.from("vendor_bids").insert({
      tenant_id: request.tenant_id,
      request_id: request.id,
      vendor_name: body.vendor_name,
      contact_email: body.contact_email,
      unit_price: body.unit_price,
      lead_time_days: Number.isFinite(body.lead_time_days) ? body.lead_time_days : null,
      notes: body.notes ?? null,
    }).select("id, tenant_id, request_id, vendor_name, contact_email, unit_price, lead_time_days, notes").single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    auditInsert({
      tenant_id: request.tenant_id,
      user_id: null,
      table_name: "vendor_bids",
      record_id: data.id,
      new_values: data as unknown as Record<string, unknown>,
    });

    return NextResponse.json({ ok: true, id: data.id });
  } catch (err: unknown) {
    const owned = ownershipDenied(err);
    if (owned) return owned;
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
