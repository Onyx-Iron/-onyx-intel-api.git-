import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { listPlanAttachments } from "@/lib/google/gmailPlans";
import { getAccessToken } from "@/lib/google/oauth";

export const runtime = "nodejs";

/**
 * Cron-friendly poll: notifies via project_events when plan emails appear.
 * Does NOT auto-ingest unless tenant_presence.auto_ingest_plan_email is true
 * (still requires a default project — left as notification-only for safety).
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET || process.env.INTERNAL_WORKER_SECRET;
  const authz = req.headers.get("authorization") ?? "";
  if (!secret || authz !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = await createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: connections } = await (db as any)
    .from("google_connections")
    .select("tenant_id, user_id, email")
    .limit(50);

  let scanned = 0;
  let found = 0;
  for (const conn of connections ?? []) {
    const token = await getAccessToken(conn.tenant_id, conn.user_id);
    if (!token) continue;
    scanned += 1;
    try {
      const attachments = await listPlanAttachments(token, { limit: 5, newerThanDays: 2 });
      found += attachments.length;
      if (attachments.length === 0) continue;
      // Find any project for the tenant to attach the event (notification only).
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: project } = await (db as any)
        .from("projects")
        .select("id")
        .eq("tenant_id", conn.tenant_id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!project) continue;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (db as any).from("project_events").insert({
        project_id: project.id,
        tenant_id: conn.tenant_id,
        user_id: conn.user_id,
        entity_type: "email_import",
        action: "queued",
        title: `${attachments.length} plan attachment(s) in Gmail — review in Documents → From Email`,
        meta: {
          href: "/dashboard/documents",
          count: attachments.length,
          filenames: attachments.map((a) => a.filename).slice(0, 5),
        },
      });
    } catch (err) {
      console.warn("[gmail plan-poll]", err);
    }
  }

  return NextResponse.json({ ok: true, scanned, found });
}
