import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import {
  disconnectHubProvider,
  listConnectionChips,
  type HubProvider,
} from "@/lib/connections/store";
import { getOrCreateTenant, authTenantKey, authTenantName } from "@/lib/project-controls/server";

export const runtime = "nodejs";

const VALID_PROVIDERS = new Set<HubProvider>([
  "google", "dropbox", "sharefile", "meta", "gbp", "gsc", "linkedin", "icloud",
]);

export async function GET(): Promise<NextResponse> {
  const { userId, orgId, orgSlug } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
  const connections = await listConnectionChips(tenantId, userId);
  return NextResponse.json({ connections });
}

export async function DELETE(req: NextRequest): Promise<NextResponse> {
  const { userId, orgId, orgSlug } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const provider = req.nextUrl.searchParams.get("provider") as HubProvider | null;
  if (!provider || !VALID_PROVIDERS.has(provider)) {
    return NextResponse.json({ error: "provider query param required" }, { status: 400 });
  }
  if (provider === "icloud") {
    return NextResponse.json({ error: "iCloud has no OAuth connection to disconnect" }, { status: 400 });
  }

  const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
  await disconnectHubProvider(tenantId, userId, provider);
  const connections = await listConnectionChips(tenantId, userId);
  return NextResponse.json({ connections });
}
