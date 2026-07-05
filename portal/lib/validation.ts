import { z } from "zod";

// ── primitives ────────────────────────────────────────────────────────────────

export const uuidSchema = z.string().uuid();
export const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD");
export const projectIdBody = z.object({ project_id: z.string().uuid() });

// ── RFIs ──────────────────────────────────────────────────────────────────────

export const rfiCreateSchema = z.object({
  project_id: z.string().uuid(),
  title: z.string().min(1).max(500),
  description: z.string().max(10_000).optional(),
  status: z.enum(["open", "pending", "answered", "closed"]).optional(),
  priority: z.enum(["low", "medium", "high"]).optional(),
  due_date: dateSchema.nullable().optional(),
  assigned_to: z.string().max(255).nullable().optional(),
  spec_section: z.string().max(255).nullable().optional(),
  number: z.number().int().positive().optional(),
});

export const rfiUpdateSchema = rfiCreateSchema.partial().omit({ project_id: true });

// ── Schedule ─────────────────────────────────────────────────────────────────

export const scheduleTaskCreateSchema = z.object({
  project_id: z.string().uuid(),
  name: z.string().min(1).max(500),
  status: z.string().max(50).optional(),
  start_date: dateSchema.nullable().optional(),
  end_date: dateSchema.nullable().optional(),
  duration: z.number().int().nonnegative().nullable().optional(),
  critical: z.boolean().optional(),
  parent_id: z.string().uuid().nullable().optional(),
  dependencies: z.array(z.string().uuid()).max(50).optional(),
  meta: z.record(z.unknown()).optional(),
});

export const scheduleTaskUpdateSchema = scheduleTaskCreateSchema.partial().omit({ project_id: true });

// ── Takeoff ───────────────────────────────────────────────────────────────────

export const takeoffRowSchema = z.object({
  id: z.string().uuid().optional(),
  label: z.string().min(1).max(500),
  csi_code: z.string().max(20).nullable().optional(),
  division: z.string().max(100).nullable().optional(),
  quantity: z.number().nonnegative().nullable().optional(),
  unit: z.string().max(50).nullable().optional(),
  rate: z.number().nonnegative().nullable().optional(),
  type: z.string().max(100).nullable().optional(),
  page: z.number().int().nonnegative().nullable().optional(),
  document_id: z.string().uuid().nullable().optional(),
  meta: z.record(z.unknown()).optional(),
});

export const takeoffItemsSchema = z.object({
  project_id: z.string().uuid(),
  rows: z.array(takeoffRowSchema).min(1).max(500),
});

// ── Estimate ──────────────────────────────────────────────────────────────────

export const estimateItemCreateSchema = z.object({
  project_id: z.string().uuid(),
  description: z.string().min(1).max(1000),
  csi_code: z.string().max(20).nullable().optional(),
  division: z.string().max(100).nullable().optional(),
  quantity: z.number().nonnegative().optional(),
  unit: z.string().max(50).nullable().optional(),
  unit_cost: z.number().nonnegative().optional(),
  total: z.number().optional(),
  category: z.string().max(100).nullable().optional(),
  meta: z.record(z.unknown()).optional(),
});

export const estimateItemUpdateSchema = estimateItemCreateSchema.partial().omit({ project_id: true });

// ── Permits ───────────────────────────────────────────────────────────────────

export const permitCreateSchema = z.object({
  project_id: z.string().uuid(),
  permit_type: z.string().min(1).max(200),
  status: z.enum(["pending", "submitted", "approved", "expired", "denied"]).optional(),
  permit_number: z.string().max(100).nullable().optional(),
  issued_by: z.string().max(255).nullable().optional(),
  submitted_at: dateSchema.nullable().optional(),
  approved_at: dateSchema.nullable().optional(),
  expires_at: dateSchema.nullable().optional(),
  notes: z.string().max(5000).nullable().optional(),
  meta: z.record(z.unknown()).optional(),
});

export const permitUpdateSchema = permitCreateSchema.partial().omit({ project_id: true });

// ── Punch List ────────────────────────────────────────────────────────────────

export const punchListCreateSchema = z.object({
  project_id: z.string().uuid(),
  title: z.string().min(1).max(500),
  description: z.string().max(5000).nullable().optional(),
  status: z.enum(["open", "in_progress", "resolved", "closed"]).optional(),
  priority: z.enum(["low", "medium", "high"]).optional(),
  assigned_to: z.string().max(255).nullable().optional(),
  location: z.string().max(255).nullable().optional(),
  due_date: dateSchema.nullable().optional(),
  meta: z.record(z.unknown()).optional(),
});

export const punchListUpdateSchema = punchListCreateSchema.partial().omit({ project_id: true });

// ── Contacts ──────────────────────────────────────────────────────────────────

export const contactCreateSchema = z.object({
  project_id: z.string().uuid(),
  name: z.string().min(1).max(255),
  role: z.string().max(100).nullable().optional(),
  company: z.string().max(255).nullable().optional(),
  email: z.string().email().max(255).nullable().optional(),
  phone: z.string().max(50).nullable().optional(),
  notes: z.string().max(5000).nullable().optional(),
  meta: z.record(z.unknown()).optional(),
});

export const contactUpdateSchema = contactCreateSchema.partial().omit({ project_id: true });

// ── Procurement ───────────────────────────────────────────────────────────────

export const procurementCreateSchema = z.object({
  project_id: z.string().uuid(),
  item: z.string().min(1).max(500),
  vendor: z.string().max(255).nullable().optional(),
  status: z.enum(["pending", "ordered", "delivered", "cancelled"]).optional(),
  quantity: z.number().nonnegative().nullable().optional(),
  unit_cost: z.number().nonnegative().nullable().optional(),
  total_cost: z.number().nonnegative().nullable().optional(),
  ordered_at: dateSchema.nullable().optional(),
  expected_at: dateSchema.nullable().optional(),
  notes: z.string().max(5000).nullable().optional(),
  meta: z.record(z.unknown()).optional(),
});

export const procurementUpdateSchema = procurementCreateSchema.partial().omit({ project_id: true });

// ── Change Orders ─────────────────────────────────────────────────────────────

export const changeOrderCreateSchema = z.object({
  project_id: z.string().uuid(),
  title: z.string().min(1).max(500),
  description: z.string().max(10_000).nullable().optional(),
  status: z.enum(["draft", "pending", "approved", "rejected"]).optional(),
  amount: z.number().nullable().optional(),
  reason: z.string().max(2000).nullable().optional(),
  number: z.number().int().positive().nullable().optional(),
  meta: z.record(z.unknown()).optional(),
});

export const changeOrderUpdateSchema = changeOrderCreateSchema.partial().omit({ project_id: true });

// ── Daily Logs ────────────────────────────────────────────────────────────────

export const dailyLogCreateSchema = z.object({
  project_id: z.string().uuid(),
  log_date: dateSchema,
  weather: z.string().max(255).nullable().optional(),
  crew_count: z.number().int().nonnegative().nullable().optional(),
  notes: z.string().max(20_000).nullable().optional(),
  work_performed: z.string().max(20_000).nullable().optional(),
  issues: z.string().max(10_000).nullable().optional(),
  meta: z.record(z.unknown()).optional(),
});

export const dailyLogUpdateSchema = dailyLogCreateSchema.partial().omit({ project_id: true });

// ── Notes ─────────────────────────────────────────────────────────────────────

export const noteCreateSchema = z.object({
  project_id: z.string().uuid(),
  content: z.string().min(1).max(50_000),
  title: z.string().max(500).nullable().optional(),
  meta: z.record(z.unknown()).optional(),
});

// ── Query params ─────────────────────────────────────────────────────────────

export const listQuerySchema = z.object({
  project_id: z.string().uuid(),
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

// ── Helper ────────────────────────────────────────────────────────────────────

export function parseBody<T>(schema: z.ZodType<T>, body: unknown):
  | { success: true; data: T }
  | { success: false; error: string } {
  const result = schema.safeParse(body);
  if (result.success) return { success: true, data: result.data };
  const first = result.error.errors[0];
  return {
    success: false,
    error: first ? `${first.path.join(".")}: ${first.message}` : "Invalid request body",
  };
}
