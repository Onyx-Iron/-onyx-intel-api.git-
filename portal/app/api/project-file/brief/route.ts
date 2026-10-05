import { NextRequest, NextResponse } from "next/server";
import { projectContext } from "@/lib/project-file/api";
import { buildProjectBrief, type BallItem } from "@/lib/project-file/records";
import { waiverCoversDraw } from "@/lib/project-file/money";

export const runtime = "nodejs";

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function yesterdayIso(): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const gate = await projectContext(req.nextUrl.searchParams.get("project_id"));
  if (!gate.ok) return gate.response;
  const db = gate.ctx.db;
  const tenantId = gate.ctx.tenantId;
  const projectId = gate.projectId;
  const today = todayIso();
  const yesterday = yesterdayIso();

  const [rfis, submittals, changeOrders, punch, links, payApps, waivers, logs, tasks] = await Promise.all([
    db.from("rfi_items").select("id, subject, status, due_date, ball_contact_id").eq("tenant_id", tenantId).eq("project_id", projectId),
    db.from("submittal_items").select("id, title, status, due_date, ball_contact_id").eq("tenant_id", tenantId).eq("project_id", projectId),
    db.from("change_order_items").select("id, description, status, ball_contact_id").eq("tenant_id", tenantId).eq("project_id", projectId),
    db.from("punch_list_items").select("id, description, status, due_date, ball_contact_id").eq("tenant_id", tenantId).eq("project_id", projectId),
    db.from("project_record_links").select("*").eq("tenant_id", tenantId).eq("project_id", projectId).in("link_role", ["blocks", "requires"]),
    db.from("pay_applications").select("id, number, status, draw_number").eq("tenant_id", tenantId).eq("project_id", projectId),
    db.from("lien_waivers").select("status, amount, draw_number").eq("tenant_id", tenantId).eq("project_id", projectId),
    db.from("daily_logs").select("id, log_date").eq("tenant_id", tenantId).eq("project_id", projectId).eq("log_date", yesterday),
    db.from("schedule_tasks").select("id, name, start_date, end_date, status").eq("tenant_id", tenantId).eq("project_id", projectId),
  ]);

  const balls: BallItem[] = [
    ...((rfis.data ?? []) as Array<{ id: string; subject: string; status: string; due_date: string | null; ball_contact_id: string | null }>).map((row) => ({
      id: row.id, kind: "rfi" as const, label: row.subject, status: row.status, due_date: row.due_date, ball_contact_id: row.ball_contact_id,
    })),
    ...((submittals.data ?? []) as Array<{ id: string; title: string; status: string; due_date: string | null; ball_contact_id: string | null }>).map((row) => ({
      id: row.id, kind: "submittal" as const, label: row.title, status: row.status, due_date: row.due_date, ball_contact_id: row.ball_contact_id,
    })),
    ...((changeOrders.data ?? []) as Array<{ id: string; description: string; status: string; ball_contact_id: string | null }>).map((row) => ({
      id: row.id, kind: "change_order" as const, label: row.description, status: row.status, due_date: null, ball_contact_id: row.ball_contact_id,
    })),
    ...((punch.data ?? []) as Array<{ id: string; description: string; status: string; due_date: string | null; ball_contact_id: string | null }>).map((row) => ({
      id: row.id, kind: "punch" as const, label: row.description, status: row.status, due_date: row.due_date, ball_contact_id: row.ball_contact_id,
    })),
  ];

  const linkRows = (links.data ?? []) as Array<{ from_type: string; from_id: string; to_type: string; to_id: string }>;
  const taskRows = (tasks.data ?? []) as Array<{ id: string; start_date: string | null }>;
  const taskById = new Map(taskRows.map((task) => [task.id, task]));
  const submittalBrief = ((submittals.data ?? []) as Array<{ id: string; title: string; status: string; due_date: string | null }>).map((row) => {
    const link = linkRows.find((item) =>
      (item.from_type === "submittal" && item.from_id === row.id && item.to_type === "schedule_task")
      || (item.to_type === "submittal" && item.to_id === row.id && item.from_type === "schedule_task"),
    );
    const taskId = link ? (link.from_type === "schedule_task" ? link.from_id : link.to_id) : null;
    const task = taskId ? taskById.get(taskId) : null;
    return { ...row, blocksTaskStart: task?.start_date ?? null };
  });

  const logIds = ((logs.data ?? []) as Array<{ id: string }>).map((log) => log.id);
  const { data: produced } = logIds.length
    ? await db.from("daily_log_quantities").select("budget_line_id").in("daily_log_id", logIds)
    : { data: [] };
  const producedLines = new Set((produced ?? []).map((row: { budget_line_id: string | null }) => row.budget_line_id).filter(Boolean));
  const activeYesterday = ((tasks.data ?? []) as Array<{ id: string; name: string; start_date: string | null; end_date: string | null; status: string }>)
    .filter((task) => task.status !== "complete" && task.start_date && task.end_date && task.start_date <= yesterday && task.end_date >= yesterday);
  const { data: installLinks } = await db
    .from("project_record_links")
    .select("from_id, to_id, from_type, to_type")
    .eq("tenant_id", tenantId)
    .eq("project_id", projectId)
    .eq("link_role", "installs");
  const tasksWithoutProduction = activeYesterday.filter((task) => {
    const linked = (installLinks ?? []).some((link: { from_type: string; from_id: string; to_type: string; to_id: string }) => {
      const lineId = link.from_type === "budget_line" ? link.from_id : link.to_type === "budget_line" ? link.to_id : null;
      const taskId = link.from_type === "schedule_task" ? link.from_id : link.to_type === "schedule_task" ? link.to_id : null;
      return taskId === task.id && lineId && producedLines.has(lineId);
    });
    return !linked;
  });

  const payAppBrief = ((payApps.data ?? []) as Array<{ id: string; number: string | null; status: string; draw_number: string | null }>).map((row) => ({
    id: row.id,
    number: row.number,
    status: row.status,
    waiverCovered: row.status !== "draft"
      || waiverCoversDraw(waivers.data ?? [], row.draw_number, 0.01),
  }));

  const lines = buildProjectBrief({
    projectId,
    today,
    balls,
    submittals: submittalBrief,
    payApps: payAppBrief,
    tasksWithoutProduction: tasksWithoutProduction.map((task) => ({ id: task.id, name: task.name })),
  });

  return NextResponse.json({ lines, open_balls: balls.filter((ball) => ball.ball_contact_id) });
}
