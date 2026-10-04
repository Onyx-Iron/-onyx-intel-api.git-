export const RFI_STATUSES = ["draft", "open", "answered", "closed", "void"] as const;
export const CONTROL_PRIORITIES = ["low", "medium", "high", "critical"] as const;
export const SUBMITTAL_STATUSES = [
  "draft",
  "submitted",
  "under_review",
  "approved",
  "approved_as_noted",
  "revise_resubmit",
  "rejected",
  "closed",
] as const;
export const SUBMITTAL_TYPES = [
  "product_data",
  "shop_drawing",
  "sample",
  "mix_design",
  "manual",
  "other",
] as const;
export const CHANGE_ORDER_STATUSES = ["draft", "pending", "approved", "rejected", "void"] as const;

export type RfiStatus = (typeof RFI_STATUSES)[number];
export type ControlPriority = (typeof CONTROL_PRIORITIES)[number];
export type SubmittalStatus = (typeof SUBMITTAL_STATUSES)[number];
export type SubmittalType = (typeof SUBMITTAL_TYPES)[number];
export type ChangeOrderStatus = (typeof CHANGE_ORDER_STATUSES)[number];

export interface ProjectControlScope {
  tenantId: string;
  projectId: string;
}

type RawPayload = Record<string, unknown>;

export interface RfiPayload {
  tenant_id: string;
  project_id: string;
  number: string | null;
  subject: string;
  description: string | null;
  discipline: string | null;
  status: RfiStatus;
  priority: ControlPriority;
  submitted_date: string | null;
  due_date: string | null;
  assigned_to: string | null;
  response: string | null;
  response_date: string | null;
  meta: Record<string, never>;
}

export interface SubmittalPayload {
  tenant_id: string;
  project_id: string;
  number: string | null;
  spec_section: string | null;
  title: string;
  description: string | null;
  submittal_type: SubmittalType;
  status: SubmittalStatus;
  revision: string | null;
  submitted_date: string | null;
  due_date: string | null;
  returned_date: string | null;
  responsible: string | null;
  notes: string | null;
  meta: Record<string, never>;
}

export interface ChangeOrderPayload {
  tenant_id: string;
  project_id: string;
  number: string | null;
  description: string;
  reason: string | null;
  status: ChangeOrderStatus;
  trade: string | null;
  request_date: string | null;
  submitted_date: string | null;
  approved_date: string | null;
  amount: number | null;
  labor_cost: number | null;
  material_cost: number | null;
  equipment_cost: number | null;
  subcontract_cost: number | null;
  markup: number | null;
  notes: string | null;
  cost_code: string | null;
  meta: Record<string, never>;
}

export interface ControlSummaryInput {
  rfis: Array<{ status: string | null }>;
  submittals: Array<{ status: string | null }>;
  changeOrders: Array<{ status: string | null; amount: number | null }>;
}

type UpdatePayload = Record<string, string | number | null>;

export interface ControlSummary {
  rfis_open: number;
  submittals_open: number;
  change_orders_pending: number;
  change_orders_approved: number;
  pending_change_order_value: number;
  approved_change_order_value: number;
}

export function cleanText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text.length > 0 ? text : null;
}

export function requiredText(value: unknown, field: string): string {
  const text = cleanText(value);
  if (!text) throw new Error(`${field} required`);
  return text;
}

export function normalizeDate(value: unknown): string | null {
  const text = cleanText(value);
  if (!text) return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

export function normalizeNumber(value: unknown): number | null {
  if (value == null || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function normalizeEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T,
): T {
  return typeof value === "string" && allowed.includes(value as T) ? (value as T) : fallback;
}

/** The form sends `title`. The stored RFI column is `subject`. */
export function rfiRawWithSubject(raw: RawPayload): RawPayload {
  if (cleanText(raw.subject)) return raw;
  const title = cleanText(raw.title);
  if (!title) return raw;
  return { ...raw, subject: title };
}

export function controlWriteStatus(error: { message?: string | null; code?: string | null }): 422 | 503 {
  const code = error.code ?? "";
  const message = error.message ?? "";
  if (code === "42P01" || code === "PGRST205" || /does not exist|schema cache/i.test(message)) return 503;
  return 422;
}

export function buildRfiPayload(raw: RawPayload, scope: ProjectControlScope): RfiPayload {
  return {
    tenant_id: scope.tenantId,
    project_id: scope.projectId,
    number: cleanText(raw.number),
    subject: requiredText(raw.subject, "subject"),
    description: cleanText(raw.description),
    discipline: cleanText(raw.discipline),
    status: normalizeEnum(raw.status, RFI_STATUSES, "open"),
    priority: normalizeEnum(raw.priority, CONTROL_PRIORITIES, "medium"),
    submitted_date: normalizeDate(raw.submitted_date),
    due_date: normalizeDate(raw.due_date),
    assigned_to: cleanText(raw.assigned_to),
    response: cleanText(raw.response),
    response_date: normalizeDate(raw.response_date),
    meta: {},
  };
}

export function buildSubmittalPayload(raw: RawPayload, scope: ProjectControlScope): SubmittalPayload {
  return {
    tenant_id: scope.tenantId,
    project_id: scope.projectId,
    number: cleanText(raw.number),
    spec_section: cleanText(raw.spec_section),
    title: requiredText(raw.title, "title"),
    description: cleanText(raw.description),
    submittal_type: normalizeEnum(raw.submittal_type, SUBMITTAL_TYPES, "other"),
    status: normalizeEnum(raw.status, SUBMITTAL_STATUSES, "draft"),
    revision: cleanText(raw.revision),
    submitted_date: normalizeDate(raw.submitted_date),
    due_date: normalizeDate(raw.due_date),
    returned_date: normalizeDate(raw.returned_date),
    responsible: cleanText(raw.responsible),
    notes: cleanText(raw.notes),
    meta: {},
  };
}

export function buildChangeOrderPayload(raw: RawPayload, scope: ProjectControlScope): ChangeOrderPayload {
  return {
    tenant_id: scope.tenantId,
    project_id: scope.projectId,
    number: cleanText(raw.number),
    description: requiredText(raw.description, "description"),
    reason: cleanText(raw.reason),
    status: normalizeEnum(raw.status, CHANGE_ORDER_STATUSES, "draft"),
    trade: cleanText(raw.trade),
    request_date: normalizeDate(raw.request_date),
    submitted_date: normalizeDate(raw.submitted_date),
    approved_date: normalizeDate(raw.approved_date),
    amount: normalizeNumber(raw.amount),
    labor_cost: normalizeNumber(raw.labor_cost),
    material_cost: normalizeNumber(raw.material_cost),
    equipment_cost: normalizeNumber(raw.equipment_cost),
    subcontract_cost: normalizeNumber(raw.subcontract_cost),
    markup: normalizeNumber(raw.markup),
    notes: cleanText(raw.notes),
    cost_code: typeof raw.cost_code === "string" && /^\d{2}-\d{2}-\d{2}$/.test(raw.cost_code.trim())
      ? raw.cost_code.trim()
      : null,
    meta: {},
  };
}

export function buildRfiUpdate(raw: RawPayload): UpdatePayload {
  return buildUpdate(raw, {
    text: ["number", "subject", "description", "discipline", "assigned_to", "response"],
    dates: ["submitted_date", "due_date", "response_date"],
    enums: {
      status: [RFI_STATUSES, "open"],
      priority: [CONTROL_PRIORITIES, "medium"],
    },
  });
}

export function buildSubmittalUpdate(raw: RawPayload): UpdatePayload {
  return buildUpdate(raw, {
    text: ["number", "spec_section", "title", "description", "revision", "responsible", "notes"],
    dates: ["submitted_date", "due_date", "returned_date"],
    enums: {
      submittal_type: [SUBMITTAL_TYPES, "other"],
      status: [SUBMITTAL_STATUSES, "draft"],
    },
  });
}

export function buildChangeOrderUpdate(raw: RawPayload): UpdatePayload {
  return buildUpdate(raw, {
    text: ["number", "description", "reason", "trade", "notes"],
    dates: ["request_date", "submitted_date", "approved_date"],
    numbers: ["amount", "labor_cost", "material_cost", "equipment_cost", "subcontract_cost", "markup"],
    enums: {
      status: [CHANGE_ORDER_STATUSES, "draft"],
    },
  });
}

export function getControlSummary(input: ControlSummaryInput): ControlSummary {
  const openRfiStatuses = new Set<string>(["open", "answered"]);
  const openSubmittalStatuses = new Set<string>([
    "submitted",
    "under_review",
    "revise_resubmit",
    "rejected",
  ]);

  const pendingChangeOrders = input.changeOrders.filter((item) => item.status === "pending");
  const approvedChangeOrders = input.changeOrders.filter((item) => item.status === "approved");

  return {
    rfis_open: input.rfis.filter((item) => openRfiStatuses.has(item.status ?? "")).length,
    submittals_open: input.submittals.filter((item) => openSubmittalStatuses.has(item.status ?? "")).length,
    change_orders_pending: pendingChangeOrders.length,
    change_orders_approved: approvedChangeOrders.length,
    pending_change_order_value: sumAmounts(pendingChangeOrders),
    approved_change_order_value: sumAmounts(approvedChangeOrders),
  };
}

function sumAmounts(items: Array<{ amount: number | null }>): number {
  return items.reduce((sum, item) => sum + (item.amount ?? 0), 0);
}

function buildUpdate(
  raw: RawPayload,
  config: {
    text?: string[];
    dates?: string[];
    numbers?: string[];
    enums?: Record<string, readonly [readonly string[], string]>;
  },
): UpdatePayload {
  const updates: UpdatePayload = {};

  for (const field of config.text ?? []) {
    if (field in raw) updates[field] = cleanText(raw[field]);
  }

  for (const field of config.dates ?? []) {
    if (field in raw) updates[field] = normalizeDate(raw[field]);
  }

  for (const field of config.numbers ?? []) {
    if (field in raw) updates[field] = normalizeNumber(raw[field]);
  }

  for (const [field, [allowed, fallback]] of Object.entries(config.enums ?? {})) {
    if (field in raw) updates[field] = normalizeEnum(raw[field], allowed, fallback);
  }

  return updates;
}
