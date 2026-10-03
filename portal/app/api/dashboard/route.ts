import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getOrCreateTenant, authTenantKey, authTenantName } from "@/lib/project-controls/server";
import { canReadFinancial, getUserRole } from "@/lib/project-controls/permissions";
import { captureException } from "@/lib/observability/errors";

export const runtime = "nodejs";

interface ProjectRow {
  id: string; name: string; city: string | null; state: string | null;
  status: string; budget: number | null; created_at: string;
  start_date: string | null; end_date: string | null;
}

export async function GET(): Promise<NextResponse> {
  try {
    const { userId, orgId, orgSlug } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
    const role = await getUserRole(tenantId, userId);
    const showFinancial = canReadFinancial(role);
    const db = await createServiceClient();

    const until7d = new Date();
    until7d.setDate(until7d.getDate() + 7);
    const [projects, takeoff, documents, tasks, estimate, bidsDue] = await Promise.all([
      db.from("projects").select("id,name,city,state,status,budget,created_at,start_date,end_date")
        .eq("tenant_id", tenantId).order("created_at", { ascending: false }),
      db.from("takeoff_items").select("id,project_id,created_at,label")
        .eq("tenant_id", tenantId).order("created_at", { ascending: false }).limit(3000),
      db.from("documents").select("id,project_id,file_name,uploaded_at,status")
        .eq("tenant_id", tenantId).order("uploaded_at", { ascending: false }).limit(1000),
      db.from("schedule_tasks").select("id,project_id,status,name,updated_at")
        .eq("tenant_id", tenantId).limit(3000),
      // estimate_items is newer — tolerate absence
      showFinancial
        ? db.from("estimate_items" as never).select("project_id,quantity,unit_cost")
            .eq("tenant_id", tenantId).limit(5000)
        : Promise.resolve({ data: [], error: null }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (db as any).from("bid_opportunities")
        .select("id,name,due_at,stage,project_id")
        .eq("tenant_id", tenantId)
        .not("due_at", "is", null)
        .gte("due_at", new Date().toISOString())
        .lte("due_at", until7d.toISOString())
        .not("stage", "in", '("won","lost","no_bid")')
        .order("due_at", { ascending: true })
        .limit(20),
    ]);

    const projectRows = (projects.data ?? []) as ProjectRow[];
    const takeoffRows = (takeoff.data ?? []) as Array<{ id: string; project_id: string; created_at: string; label: string | null }>;
    const docRows = (documents.data ?? []) as Array<{ id: string; project_id: string | null; file_name: string; uploaded_at: string; status: string }>;
    const taskRows = (tasks.data ?? []) as Array<{ id: string; project_id: string; status: string; name: string; updated_at: string }>;
    const estRows = (estimate.error ? [] : (estimate.data ?? [])) as Array<{ project_id: string; quantity: number | null; unit_cost: number | null }>;

    const countBy = <T,>(rows: T[], key: (r: T) => string | null) => {
      const m = new Map<string, number>();
      for (const r of rows) { const k = key(r); if (k) m.set(k, (m.get(k) ?? 0) + 1); }
      return m;
    };
    const takeoffByProj = countBy(takeoffRows, (r) => r.project_id);
    const docsByProj = countBy(docRows, (r) => r.project_id);

    // completion = completed tasks / total tasks per project
    const taskTotals = new Map<string, { done: number; total: number }>();
    for (const t of taskRows) {
      const e = taskTotals.get(t.project_id) ?? { done: 0, total: 0 };
      e.total += 1;
      if (t.status === "complete") e.done += 1;
      taskTotals.set(t.project_id, e);
    }
    const estByProj = new Map<string, number>();
    for (const e of estRows) {
      if (e.quantity != null && e.unit_cost != null) {
        estByProj.set(e.project_id, (estByProj.get(e.project_id) ?? 0) + e.quantity * e.unit_cost);
      }
    }

    const projectsOut = projectRows.map((p) => {
      const tt = taskTotals.get(p.id);
      const completion = tt && tt.total > 0 ? Math.round((tt.done / tt.total) * 100) : 0;
      return {
        id: p.id,
        name: p.name,
        location: [p.city, p.state].filter(Boolean).join(", ") || "—",
        status: p.status,
        completion,
        budget: showFinancial ? (p.budget ?? 0) : 0,
        estimated: showFinancial ? Math.round(estByProj.get(p.id) ?? 0) : 0,
        takeoffItems: takeoffByProj.get(p.id) ?? 0,
        documents: docsByProj.get(p.id) ?? 0,
        tasks: tt?.total ?? 0,
        start_date: p.start_date,
        end_date: p.end_date,
      };
    });

    const bidDueRows = (bidsDue.error ? [] : (bidsDue.data ?? [])) as Array<{
      id: string; name: string; due_at: string; stage: string; project_id: string | null;
    }>;

    const kpis = {
      projects: projectRows.length,
      activeProjects: projectRows.filter((p) => p.status === "active" || p.status === "bidding").length,
      takeoffItems: takeoffRows.length,
      documents: docRows.length,
      scheduleTasks: taskRows.length,
      estimatedValue: showFinancial
        ? Math.round([...estByProj.values()].reduce((a, b) => a + b, 0))
        : 0,
      bidsDue7d: bidDueRows.length,
      financial_redacted: !showFinancial,
    };

    // Activity feed — merge recent events across sources.
    const projName = new Map(projectRows.map((p) => [p.id, p.name]));
    type Act = { id: string; ts: string; kind: string; project: string; message: string; detail: string };
    const acts: Act[] = [];
    for (const d of docRows.slice(0, 20)) {
      acts.push({ id: `doc-${d.id}`, ts: d.uploaded_at, kind: "document",
        project: (d.project_id && projName.get(d.project_id)) || "—",
        message: `Document ${d.status === "complete" ? "processed" : "uploaded"}`, detail: d.file_name });
    }
    for (const t of takeoffRows.slice(0, 20)) {
      acts.push({ id: `to-${t.id}`, ts: t.created_at, kind: "takeoff",
        project: projName.get(t.project_id) || "—",
        message: "Takeoff item added", detail: t.label ?? "Line item" });
    }
    acts.sort((a, b) => (b.ts > a.ts ? 1 : -1));

    return NextResponse.json({
      kpis,
      projects: projectsOut,
      activity: acts.slice(0, 15),
      bids_due: bidDueRows.map((b) => ({
        id: b.id,
        name: b.name,
        due_at: b.due_at,
        stage: b.stage,
        project_id: b.project_id,
        href: "/dashboard/preconstruction",
      })),
    });
  } catch (err: unknown) {
    captureException(err, { route: "GET /api/dashboard" });
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `[GET /api/dashboard] ${msg}` }, { status: 500 });
  }
}
