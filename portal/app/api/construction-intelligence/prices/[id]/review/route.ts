import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { buildPriceReviewPreview } from "@/lib/construction-intelligence/price-review";
import { assertPermission, PermissionError } from "@/lib/project-controls/permissions";
import { authTenantKey, authTenantName, getOrCreateTenant } from "@/lib/project-controls/server";
import { createServiceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const previewSchema = z.object({
  decision: z.enum(["approved", "rejected"]),
  reason: z.string().trim().max(1000).default(""),
  confirm: z.literal(false).optional(),
});
const confirmSchema = z.object({
  confirm: z.literal(true),
  preview_id: z.string().uuid(),
  preview_hash: z.string().regex(/^[a-f0-9]{64}$/),
});

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const { userId, orgId, orgSlug } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
  try {
    await assertPermission(tenantId, userId, "financial", "write");
  } catch (error) {
    if (error instanceof PermissionError) return NextResponse.json({ error: error.message }, { status: error.status });
    throw error;
  }
  const body = await request.json().catch(() => null);
  const db = await createServiceClient();
  // Generated production types intentionally lag branch-only migrations.
  // Keep this cast scoped to the new review tables/RPC until promotion.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const reviewDb = db as any;

  if (body?.confirm === true) {
    const parsed = confirmSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid confirmation" }, { status: 400 });
    const { data, error } = await reviewDb.rpc("confirm_price_observation_review", {
      p_preview_id: parsed.data.preview_id, p_observation_id: id, p_tenant_id: tenantId,
      p_actor_user_id: userId, p_payload_hash: parsed.data.preview_hash,
    });
    if (error) return NextResponse.json({ error: error.message }, { status: /changed|pending|expired|another|already/i.test(error.message) ? 409 : 422 });
    return NextResponse.json({ observation: data });
  }

  const parsed = previewSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid review" }, { status: 400 });
  const { data: observation, error: readError } = await reviewDb.from("price_observations").select("*")
    .eq("id", id).eq("tenant_id", tenantId).maybeSingle();
  if (readError) return NextResponse.json({ error: readError.message }, { status: 500 });
  if (!observation) return NextResponse.json({ error: "Price observation not found" }, { status: 404 });

  let preview;
  try {
    preview = buildPriceReviewPreview(observation as Record<string, unknown>, parsed.data.decision, parsed.data.reason);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Review blocked" }, { status: 409 });
  }
  const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();
  const { data: stored, error: insertError } = await reviewDb.from("price_observation_review_previews").insert({
    tenant_id: tenantId, price_observation_id: id, actor_user_id: userId,
    decision: parsed.data.decision, reason: parsed.data.reason || null,
    payload: preview.payload, payload_hash: preview.payloadHash, expires_at: expiresAt,
  }).select("id").single();
  if (insertError) return NextResponse.json({ error: insertError.message }, { status: 422 });
  return NextResponse.json({
    preview: { id: stored.id, payload: preview.payload, payload_hash: preview.payloadHash, expires_at: expiresAt },
  });
}
