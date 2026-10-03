import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { getAccessToken } from "@/lib/google/oauth";
import { listPlanAttachments } from "@/lib/google/gmailPlans";
import { getOrCreateTenant, authTenantKey, authTenantName } from "@/lib/project-controls/server";

export const runtime = "nodejs";

/**
 * GET /api/google/gmail/plan-attachments?limit=15&q=&days=30
 * Lists PDF/DWG/DXF/XLSX attachments from recent Gmail messages.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const { userId, orgId, orgSlug } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
    const token = await getAccessToken(tenantId, userId);
    if (!token) {
      return NextResponse.json({ attachments: [], connected: false }, { status: 200 });
    }

    const limit = parseInt(req.nextUrl.searchParams.get("limit") ?? "15", 10);
    const days = parseInt(req.nextUrl.searchParams.get("days") ?? "30", 10);
    const extraQuery = req.nextUrl.searchParams.get("q") ?? "";

    const attachments = await listPlanAttachments(token, {
      limit: Number.isFinite(limit) ? limit : 15,
      newerThanDays: Number.isFinite(days) ? days : 30,
      extraQuery,
    });

    return NextResponse.json(
      { attachments, connected: true },
      { headers: { "Cache-Control": "private, max-age=60" } },
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
