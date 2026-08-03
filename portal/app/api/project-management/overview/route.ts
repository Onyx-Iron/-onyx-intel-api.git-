import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { authTenantKey, authTenantName, getOrCreateTenant } from "@/lib/project-controls/server";
import { canReadFinancial, getUserRole } from "@/lib/project-controls/permissions";
import { getControlSummary } from "@/lib/project-controls/schema";

export const runtime = "nodejs";

type ProjectRow = {
  id: string;
  name: string;
  status: string | null;
};

type RfiRow = {
  id: string;
  project_id: string;
  subject: string;
  status: string | null;
  priority: string | null;
  due_date: string | null;
  assigned_to: string | null;
  created_at: string | null;
};

type SubmittalRow = {
  id: string;
  project_id: string;
  title: string;
  status: string | null;
  due_date: string | null;
  responsible: string | null;
  spec_section: string | null;
  created_at: string | null;
};

type ChangeOrderRow = {
  id: string;
  project_id: string;
  description: string;
  status: string | null;
  amount: number | null;
  trade: string | null;
  submitted_date: string | null;
  created_at: string | null;
};

type ScheduleRow = {
  id: string;
  project_id: string;
  name: string;
  status: string | null;
  end_date: string | null;
  critical: boolean | null;
  created_at: string | null;
};

type PunchRow = {
  id: string;
  project_id: string;
  item_number: number | null;
  description: string;
  status: string | null;
  priority: string | null;
  due_date: string | null;
  responsible: string | null;
  location: string | null;
  created_at: string | null;
};

type DailyLogRow = {
  id: string;
  project_id: string;
  log_date: string;
  crew_count: number | null;
  weather: string | null;
  work_performed: string | null;
  notes: string | null;
  created_at: string | null;
};

type WeeklyLogRow = {
  id: string;
  project_id: string;
  week_start: string;
  week_end: string;
  schedule_status: string | null;
  budget_status: string | null;
  open_issues: string | null;
  decisions_needed: string | null;
  summary: string | null;
  created_at: string | null;
};

type StaffRow = {
  id: string;
  project_id: string;
  name: string;
  role: string | null;
  project_role: string | null;
  removed_at: string | null;
  created_at: string | null;
};

type WorkItem = {
  id: string;
  kind: "RFI" | "Submittal" | "Change Order" | "Schedule" | "Punch";
  project_id: string;
  project_name: string;
  title: string;
  status: string | null;
  priority: string | null;
  owner: string | null;
  due_date: string | null;
  sort_date: string | null;
  href: string;
};

const OPEN_RFI_STATUSES = new Set(["draft", "open", "answered"]);
const OPEN_SUBMITTAL_STATUSES = new Set(["draft", "submitted", "under_review", "revise_resubmit", "rejected"]);
const OPEN_CHANGE_ORDER_STATUSES = new Set(["draft", "pending"]);
const OPEN_PUNCH_STATUSES = new Set(["open", "in_progress"]);
const COMPLETE_SCHEDULE_STATUSES = new Set(["complete", "completed", "done"]);

function isBeforeToday(value: string | null, today: string): boolean {
  return Boolean(value && value < today);
}

function byNearestDate(a: WorkItem, b: WorkItem): number {
  if (!a.sort_date && !b.sort_date) return a.title.localeCompare(b.title);
  if (!a.sort_date) return 1;
  if (!b.sort_date) return -1;
  return a.sort_date.localeCompare(b.sort_date);
}

function projectName(projects: Map<string, string>, projectId: string): string {
  return projects.get(projectId) ?? projectId;
}

function buildWorkItems(
  projectNames: Map<string, string>,
  rows: {
    rfis: RfiRow[];
    submittals: SubmittalRow[];
    changeOrders: ChangeOrderRow[];
    scheduleTasks: ScheduleRow[];
    punchItems: PunchRow[];
  },
): WorkItem[] {
  const rfis = rows.rfis
    .filter((item) => OPEN_RFI_STATUSES.has(item.status ?? ""))
    .map((item): WorkItem => ({
      id: item.id,
      kind: "RFI",
      project_id: item.project_id,
      project_name: projectName(projectNames, item.project_id),
      title: item.subject,
      status: item.status,
      priority: item.priority,
      owner: item.assigned_to,
      due_date: item.due_date,
      sort_date: item.due_date ?? item.created_at,
      href: `/dashboard/projects/${item.project_id}?section=project-controls`,
    }));

  const submittals = rows.submittals
    .filter((item) => OPEN_SUBMITTAL_STATUSES.has(item.status ?? ""))
    .map((item): WorkItem => ({
      id: item.id,
      kind: "Submittal",
      project_id: item.project_id,
      project_name: projectName(projectNames, item.project_id),
      title: item.spec_section ? `${item.spec_section} - ${item.title}` : item.title,
      status: item.status,
      priority: null,
      owner: item.responsible,
      due_date: item.due_date,
      sort_date: item.due_date ?? item.created_at,
      href: `/dashboard/projects/${item.project_id}?section=project-controls`,
    }));

  const changeOrders = rows.changeOrders
    .filter((item) => OPEN_CHANGE_ORDER_STATUSES.has(item.status ?? ""))
    .map((item): WorkItem => ({
      id: item.id,
      kind: "Change Order",
      project_id: item.project_id,
      project_name: projectName(projectNames, item.project_id),
      title: item.description,
      status: item.status,
      priority: item.trade,
      owner: null,
      due_date: item.submitted_date,
      sort_date: item.submitted_date ?? item.created_at,
      href: `/dashboard/projects/${item.project_id}?section=project-controls`,
    }));

  const scheduleTasks = rows.scheduleTasks
    .filter((item) => !COMPLETE_SCHEDULE_STATUSES.has(item.status ?? ""))
    .map((item): WorkItem => ({
      id: item.id,
      kind: "Schedule",
      project_id: item.project_id,
      project_name: projectName(projectNames, item.project_id),
      title: item.name,
      status: item.status,
      priority: item.critical ? "critical" : null,
      owner: null,
      due_date: item.end_date,
      sort_date: item.end_date ?? item.created_at,
      href: `/dashboard/projects/${item.project_id}?section=schedule`,
    }));

  const punchItems = rows.punchItems
    .filter((item) => OPEN_PUNCH_STATUSES.has(item.status ?? ""))
    .map((item): WorkItem => ({
      id: item.id,
      kind: "Punch",
      project_id: item.project_id,
      project_name: projectName(projectNames, item.project_id),
      title: item.item_number ? `#${item.item_number} - ${item.description}` : item.description,
      status: item.status,
      priority: item.priority,
      owner: item.responsible,
      due_date: item.due_date,
      sort_date: item.due_date ?? item.created_at,
      href: `/dashboard/projects/${item.project_id}?section=closeout`,
    }));

  return [...rfis, ...submittals, ...changeOrders, ...scheduleTasks, ...punchItems]
    .sort(byNearestDate)
    .slice(0, 75);
}

export async function GET(): Promise<NextResponse> {
  try {
    const { userId, orgId, orgSlug } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
    const today = new Date().toISOString().slice(0, 10);
    const recentLogCutoff = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const db = await createServiceClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const anyDb = db as any;

    const [
      projectsResult,
      rfisResult,
      submittalsResult,
      changeOrdersResult,
      scheduleResult,
      punchResult,
      dailyLogsResult,
      weeklyLogsResult,
      staffResult,
    ] = await Promise.all([
      anyDb
        .from("projects")
        .select("id,name,status")
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: false })
        .limit(500),
      anyDb
        .from("rfi_items")
        .select("id,project_id,subject,status,priority,due_date,assigned_to,created_at")
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: false })
        .limit(1000),
      anyDb
        .from("submittal_items")
        .select("id,project_id,title,status,due_date,responsible,spec_section,created_at")
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: false })
        .limit(1000),
      anyDb
        .from("change_order_items")
        .select("id,project_id,description,status,amount,trade,submitted_date,created_at")
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: false })
        .limit(1000),
      anyDb
        .from("schedule_tasks")
        .select("id,project_id,name,status,end_date,critical,created_at")
        .eq("tenant_id", tenantId)
        .order("end_date", { ascending: true, nullsFirst: false })
        .limit(1000),
      anyDb
        .from("punch_list_items")
        .select("id,project_id,item_number,description,status,priority,due_date,responsible,location,created_at")
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: false })
        .limit(1000),
      anyDb
        .from("daily_logs")
        .select("id,project_id,log_date,crew_count,weather,work_performed,notes,created_at")
        .eq("tenant_id", tenantId)
        .order("log_date", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(40),
      anyDb
        .from("weekly_logs")
        .select("id,project_id,week_start,week_end,schedule_status,budget_status,open_issues,decisions_needed,summary,created_at")
        .eq("tenant_id", tenantId)
        .order("week_start", { ascending: false })
        .limit(40),
      anyDb
        .from("staff_members")
        .select("id,project_id,name,role,project_role,removed_at,created_at")
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: false })
        .limit(1000),
    ]);

    const results = [
      projectsResult,
      rfisResult,
      submittalsResult,
      changeOrdersResult,
      scheduleResult,
      punchResult,
      dailyLogsResult,
      weeklyLogsResult,
      staffResult,
    ];
    const failed = results.find((result) => result.error);
    if (failed?.error) {
      return NextResponse.json({ error: `[GET /api/project-management/overview] ${failed.error.message}` }, { status: 500 });
    }

    const projects = (projectsResult.data ?? []) as ProjectRow[];
    const rfis = (rfisResult.data ?? []) as RfiRow[];
    const submittals = (submittalsResult.data ?? []) as SubmittalRow[];
    const changeOrders = (changeOrdersResult.data ?? []) as ChangeOrderRow[];
    const scheduleTasks = (scheduleResult.data ?? []) as ScheduleRow[];
    const punchItems = (punchResult.data ?? []) as PunchRow[];
    const dailyLogs = (dailyLogsResult.data ?? []) as DailyLogRow[];
    const weeklyLogs = (weeklyLogsResult.data ?? []) as WeeklyLogRow[];
    const staff = (staffResult.data ?? []) as StaffRow[];
    const role = await getUserRole(tenantId, userId);
    const showFinancialValues = canReadFinancial(role);

    const projectNames = new Map(projects.map((project) => [project.id, project.name]));
    const controlSummary = getControlSummary({
      rfis,
      submittals,
      changeOrders,
    });
    const scheduleComplete = scheduleTasks.filter((item) => COMPLETE_SCHEDULE_STATUSES.has(item.status ?? "")).length;
    const openPunchItems = punchItems.filter((item) => OPEN_PUNCH_STATUSES.has(item.status ?? ""));
    const activeStaff = staff.filter((member) => !member.removed_at);
    const openItems = buildWorkItems(projectNames, {
      rfis,
      submittals,
      changeOrders,
      scheduleTasks,
      punchItems,
    });
    const overdueItems = openItems.filter((item) => isBeforeToday(item.due_date, today)).length;
    const criticalTasks = scheduleTasks.filter((item) => item.critical && !COMPLETE_SCHEDULE_STATUSES.has(item.status ?? "")).length;

    return NextResponse.json({
      summary: {
        project_count: projects.length,
        active_project_count: projects.filter((project) => (project.status ?? "active") === "active").length,
        open_rfis: controlSummary.rfis_open,
        open_submittals: controlSummary.submittals_open,
        pending_change_orders: controlSummary.change_orders_pending,
        pending_change_order_value: showFinancialValues ? controlSummary.pending_change_order_value : null,
        change_order_values_visible: showFinancialValues,
        schedule_total: scheduleTasks.length,
        schedule_complete: scheduleComplete,
        schedule_completion: scheduleTasks.length > 0 ? Math.round((scheduleComplete / scheduleTasks.length) * 100) : 0,
        open_punch_items: openPunchItems.length,
        overdue_items: overdueItems,
        critical_tasks: criticalTasks,
        daily_logs_recent: dailyLogs.filter((log) => log.log_date >= recentLogCutoff).length,
        active_staff: activeStaff.length,
      },
      projects,
      open_items: openItems,
      recent_daily_logs: dailyLogs.slice(0, 12).map((log) => ({
        ...log,
        project_name: projectName(projectNames, log.project_id),
      })),
      recent_weekly_logs: weeklyLogs.slice(0, 12).map((log) => ({
        ...log,
        project_name: projectName(projectNames, log.project_id),
      })),
      active_staff: activeStaff.slice(0, 50).map((member) => ({
        ...member,
        project_name: projectName(projectNames, member.project_id),
      })),
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `[GET /api/project-management/overview] ${msg}` }, { status: 500 });
  }
}
