export const LINK_ROLES = [
  "related",
  "blocks",
  "requires",
  "prices",
  "bills",
  "installs",
  "distributes",
] as const;

export type LinkRole = (typeof LINK_ROLES)[number];

export const RECORD_TYPES = [
  "rfi",
  "submittal",
  "change_order",
  "change_event",
  "punch",
  "schedule_task",
  "purchase_order",
  "commitment",
  "invoice",
  "pay_app",
  "budget_line",
  "estimate_item",
  "takeoff",
  "daily_log",
  "todo",
  "meeting",
  "inspection",
  "document",
  "project_contact",
  "contact",
] as const;

export type RecordType = (typeof RECORD_TYPES)[number];

export function isLinkRole(value: string): value is LinkRole {
  return (LINK_ROLES as readonly string[]).includes(value);
}

export function isRecordType(value: string): value is RecordType {
  return (RECORD_TYPES as readonly string[]).includes(value);
}

export interface SheetPinDraft {
  project_id: string;
  page_id: string;
  entity_type: RecordType;
  entity_id: string;
  x: number;
  y: number;
  label: string | null;
}

/** A sheet pin is a location. It never carries takeoff quantity fields. */
export function sheetPinInsert(draft: SheetPinDraft, tenantId: string): Record<string, unknown> {
  return {
    tenant_id: tenantId,
    project_id: draft.project_id,
    page_id: draft.page_id,
    entity_type: draft.entity_type,
    entity_id: draft.entity_id,
    x: draft.x,
    y: draft.y,
    label: draft.label,
  };
}

export function pinCreatesTakeoff(_draft: SheetPinDraft): boolean {
  return false;
}

export interface RemainingLine {
  budgetLineId: string;
  quantity: number | null;
  installed: number;
  sourceTakeoffId: string | null;
  description: string;
}

export function remainingQuantity(budgetQty: number | null, installed: number): number | null {
  if (budgetQty == null) return null;
  return budgetQty - installed;
}

export function remainingForLines(
  lines: Array<{ id: string; quantity: number | null; source_takeoff_id: string | null; description: string }>,
  installedByLine: Map<string, number>,
): RemainingLine[] {
  return lines.map((line) => ({
    budgetLineId: line.id,
    quantity: line.quantity,
    installed: installedByLine.get(line.id) ?? 0,
    sourceTakeoffId: line.source_takeoff_id,
    description: line.description,
  })).map((line) => ({
    ...line,
    quantity: remainingQuantity(line.quantity, line.installed),
  }));
}

const RECORD_HREF: Record<RecordType, { phase: string; tab: string }> = {
  rfi: { phase: "controls", tab: "controls" },
  submittal: { phase: "controls", tab: "controls" },
  change_order: { phase: "controls", tab: "controls" },
  change_event: { phase: "controls", tab: "controls" },
  punch: { phase: "closeout", tab: "punchlist" },
  schedule_task: { phase: "schedule", tab: "scheduling" },
  purchase_order: { phase: "procurement", tab: "procurement" },
  commitment: { phase: "estimate", tab: "budget" },
  invoice: { phase: "financials", tab: "open" },
  pay_app: { phase: "financials", tab: "pay-apps" },
  budget_line: { phase: "estimate", tab: "budget" },
  estimate_item: { phase: "estimate", tab: "estimates" },
  takeoff: { phase: "takeoff", tab: "takeoff" },
  daily_log: { phase: "field", tab: "daily-log" },
  todo: { phase: "field", tab: "todo" },
  meeting: { phase: "field", tab: "meetings" },
  inspection: { phase: "closeout", tab: "inspections" },
  document: { phase: "documents", tab: "documents" },
  project_contact: { phase: "procurement", tab: "subs" },
  contact: { phase: "procurement", tab: "subs" },
};

export function recordHref(projectId: string, type: RecordType): string {
  const target = RECORD_HREF[type];
  return `/dashboard/projects/${projectId}?phase=${target.phase}&tab=${target.tab}`;
}

export interface BallItem {
  id: string;
  kind: "rfi" | "submittal" | "change_order" | "punch";
  label: string;
  due_date: string | null;
  ball_contact_id: string | null;
  status: string;
}

export function openBalls(items: BallItem[], today: string): Array<BallItem & { overdue: boolean; hrefKind: RecordType }> {
  const kindMap = {
    rfi: "rfi",
    submittal: "submittal",
    change_order: "change_order",
    punch: "punch",
  } as const;
  return items
    .filter((item) => item.ball_contact_id && !["closed", "void", "approved", "complete"].includes(item.status))
    .map((item) => ({
      ...item,
      overdue: Boolean(item.due_date && item.due_date < today),
      hrefKind: kindMap[item.kind],
    }));
}

export interface BriefLine {
  text: string;
  href: string;
}

export function buildProjectBrief(input: {
  projectId: string;
  today: string;
  balls: BallItem[];
  submittals: Array<{ id: string; title: string; status: string; due_date: string | null; blocksTaskStart: string | null }>;
  payApps: Array<{ id: string; number: string | null; waiverCovered: boolean; status: string }>;
  tasksWithoutProduction: Array<{ id: string; name: string }>;
}): BriefLine[] {
  const lines: BriefLine[] = [];
  for (const ball of openBalls(input.balls, input.today)) {
    if (!ball.overdue) continue;
    lines.push({
      text: `Overdue ${ball.kind.replace("_", " ")}: ${ball.label}`,
      href: recordHref(input.projectId, ball.hrefKind),
    });
  }
  for (const submittal of input.submittals) {
    if (!submittal.blocksTaskStart || !submittal.due_date) continue;
    if (submittal.due_date > submittal.blocksTaskStart && !["approved", "approved_as_noted", "closed"].includes(submittal.status)) {
      lines.push({
        text: `Submittal misses activity start: ${submittal.title}`,
        href: recordHref(input.projectId, "submittal"),
      });
    }
  }
  for (const payApp of input.payApps) {
    if (payApp.status === "draft" && !payApp.waiverCovered) {
      lines.push({
        text: `Pay app ${payApp.number ?? payApp.id} is blocked on lien waivers`,
        href: recordHref(input.projectId, "pay_app"),
      });
    }
  }
  for (const task of input.tasksWithoutProduction) {
    lines.push({
      text: `No production yesterday: ${task.name}`,
      href: recordHref(input.projectId, "schedule_task"),
    });
  }
  return lines;
}

export type AgentDecision = "approve" | "reject" | "modify";

/** Rejected audit rows write nothing. Approved drafters write one project record. */
export function mutationForAgentDecision(decision: AgentDecision): "write" | "none" {
  if (decision === "reject") return "none";
  return "write";
}

export function approvedRfiWritesTo(): "rfi_items" {
  return "rfi_items";
}

export interface ScopedViewer {
  role: "ClientView" | "Subcontractor" | "other";
  contactId: string | null;
}

export function clientCanSeeDailyLog(role: ScopedViewer["role"], clientVisible: boolean): boolean {
  if (role !== "ClientView") return true;
  return clientVisible;
}

export function clientCanSeeChangeEvent(role: ScopedViewer["role"], status: string): boolean {
  if (role !== "ClientView") return true;
  return status === "pending";
}

export function subCanSeeRecord(
  viewer: ScopedViewer,
  responsibleContactId: string | null,
): boolean {
  if (viewer.role !== "Subcontractor") return true;
  return viewer.contactId != null && viewer.contactId === responsibleContactId;
}
