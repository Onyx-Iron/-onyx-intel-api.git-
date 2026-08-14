import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import {
  authTenantKey,
  authTenantName,
  getOrCreateTenant,
} from "@/lib/project-controls/server";
import { runTenantGuard } from "@/lib/agents/tenantGuard";
import { assertPermission, PermissionError } from "@/lib/project-controls/permissions";

export const runtime = "nodejs";

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const { userId, orgId, orgSlug } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = (await req.json().catch(() => ({}))) as { files?: unknown };
    const supplied = Array.isArray(body.files)
      ? body.files.filter((f): f is string => typeof f === "string" && f.trim().length > 0)
      : undefined;

    const tenantId = await getOrCreateTenant(
      authTenantKey(userId, orgId),
      authTenantName(userId, orgSlug),
    );
    await assertPermission(tenantId, userId, "admin", "write");

    const result = await runTenantGuard(tenantId, supplied);
    return NextResponse.json(result);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: err instanceof PermissionError ? 403 : 500 });
  }
}
