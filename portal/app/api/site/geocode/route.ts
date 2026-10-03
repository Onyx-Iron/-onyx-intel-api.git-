import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { geocodeAddress } from "@/lib/site/nominatim";
import { getOrCreateTenant, authTenantKey, authTenantName } from "@/lib/project-controls/server";

export const runtime = "nodejs";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const { userId, orgId, orgSlug } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));

  const q = req.nextUrl.searchParams.get("q") ?? "";
  try {
    const result = await geocodeAddress(q);
    return NextResponse.json({ result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
