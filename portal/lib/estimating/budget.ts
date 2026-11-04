export interface BudgetSourceItem {
  id?: string;
  source_takeoff_id?: string | null;
  csi_code?: string | null;
  description?: string | null;
  quantity?: number | null;
  uom?: string | null;
  labor_cost?: number | null;
  material_cost?: number | null;
  equipment_cost?: number | null;
  total_price?: number | null;
  sort_order?: number | null;
}

export interface BudgetLineSnapshot {
  source_estimate_item_id: string | null;
  source_takeoff_id: string | null;
  csi_code: string | null;
  description: string;
  quantity: number | null;
  uom: string | null;
  labor_cost: number;
  material_cost: number;
  equipment_cost: number;
  total_price: number;
  sort_order: number;
}

export interface BudgetSnapshot {
  lines: BudgetLineSnapshot[];
  totalPrice: number;
  lineCount: number;
}

function money(value: number | null | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/** Copy the lines of one estimate version. The caller must pass that version's rows. */
export function snapshotBudget(items: BudgetSourceItem[]): BudgetSnapshot {
  const lines = items.map((item, index) => ({
    source_estimate_item_id: item.id ?? null,
    source_takeoff_id: item.source_takeoff_id ?? null,
    csi_code: item.csi_code ?? null,
    description: (item.description ?? "").trim() || "Estimate line",
    quantity: item.quantity ?? null,
    uom: item.uom ?? null,
    labor_cost: money(item.labor_cost),
    material_cost: money(item.material_cost),
    equipment_cost: money(item.equipment_cost),
    total_price: money(item.total_price),
    sort_order: item.sort_order ?? index,
  }));
  const totalPrice = lines.reduce((sum, line) => sum + line.total_price, 0);
  return { lines, totalPrice, lineCount: lines.length };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = any;

export class BudgetPublishError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BudgetPublishError";
  }
}

interface StoredBudgetHeader {
  id: string;
  is_current?: boolean;
  total_price?: number;
  line_count?: number;
}

export interface PublishedBudget {
  created: boolean;
  budget: StoredBudgetHeader;
  lines: Array<Record<string, unknown>>;
}

function isUniqueViolation(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  if (error.code === "23505") return true;
  const message = error.message ?? "";
  return /duplicate key|unique constraint/i.test(message);
}

async function readVersionBudget(
  db: AnyDb,
  tenantId: string,
  versionId: string,
): Promise<{ budget: StoredBudgetHeader; lines: Array<Record<string, unknown>> } | null> {
  const { data: budget, error } = await db
    .from("project_budgets")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("source_estimate_version_id", versionId)
    .maybeSingle();
  if (error) throw new BudgetPublishError(error.message);
  if (!budget) return null;
  const { data: lines, error: lineError } = await db
    .from("project_budget_lines")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("budget_id", budget.id)
    .order("sort_order", { ascending: true });
  if (lineError) throw new BudgetPublishError(lineError.message);
  return { budget: budget as StoredBudgetHeader, lines: (lines ?? []) as Array<Record<string, unknown>> };
}

async function makeBudgetCurrent(
  db: AnyDb,
  tenantId: string,
  projectId: string,
  budgetId: string,
  totalPrice: number,
): Promise<void> {
  const { error: demoteError } = await db
    .from("project_budgets")
    .update({ is_current: false })
    .eq("tenant_id", tenantId)
    .eq("project_id", projectId)
    .eq("is_current", true)
    .neq("id", budgetId);
  if (demoteError) throw new BudgetPublishError(demoteError.message);

  const { error: promoteError } = await db
    .from("project_budgets")
    .update({ is_current: true })
    .eq("id", budgetId)
    .eq("tenant_id", tenantId);
  if (promoteError) throw new BudgetPublishError(promoteError.message);

  const { error: projectError } = await db
    .from("projects")
    .update({ budget: totalPrice })
    .eq("id", projectId)
    .eq("tenant_id", tenantId);
  if (projectError) throw new BudgetPublishError(projectError.message);
}

/**
 * Save an approved estimate as the project's current budget.
 *
 * The previous current budget stays current until the new header and its
 * lines are stored. A second save of the same version loses the unique
 * insert and must not clear that current flag on the way out.
 */
async function finishExistingBudget(
  db: AnyDb,
  args: {
    tenantId: string;
    projectId: string;
    versionId: string;
    snapshot: BudgetSnapshot;
  },
  existing: { budget: StoredBudgetHeader; lines: Array<Record<string, unknown>> },
): Promise<PublishedBudget> {
  const hasLines = existing.lines.length > 0 || args.snapshot.lines.length === 0;
  if (!existing.budget.is_current && hasLines) {
    const { data: current, error } = await db
      .from("project_budgets")
      .select("id")
      .eq("tenant_id", args.tenantId)
      .eq("project_id", args.projectId)
      .eq("is_current", true)
      .maybeSingle();
    if (error) throw new BudgetPublishError(error.message);
    if (!current) {
      await makeBudgetCurrent(
        db,
        args.tenantId,
        args.projectId,
        existing.budget.id,
        args.snapshot.totalPrice,
      );
      const refreshed = await readVersionBudget(db, args.tenantId, args.versionId);
      return {
        created: false,
        budget: refreshed?.budget ?? { ...existing.budget, is_current: true },
        lines: refreshed?.lines ?? existing.lines,
      };
    }
  }
  return { created: false, budget: existing.budget, lines: existing.lines };
}

export async function publishApprovedBudget(
  db: AnyDb,
  args: {
    tenantId: string;
    projectId: string;
    versionId: string;
    versionNumber: number;
    userId: string;
    snapshot: BudgetSnapshot;
  },
): Promise<PublishedBudget> {
  const existing = await readVersionBudget(db, args.tenantId, args.versionId);
  if (existing) return finishExistingBudget(db, args, existing);

  const { data: budget, error: budgetError } = await db
    .from("project_budgets")
    .insert({
      tenant_id: args.tenantId,
      project_id: args.projectId,
      source_estimate_version_id: args.versionId,
      version_number: args.versionNumber,
      total_price: args.snapshot.totalPrice,
      line_count: args.snapshot.lineCount,
      created_by: args.userId,
      is_current: false,
    })
    .select("*")
    .single();
  if (budgetError || !budget) {
    if (isUniqueViolation(budgetError)) {
      const raced = await readVersionBudget(db, args.tenantId, args.versionId);
      if (raced) return finishExistingBudget(db, args, raced);
    }
    throw new BudgetPublishError(budgetError?.message ?? "Budget header was not saved");
  }

  if (args.snapshot.lines.length > 0) {
    const { error: lineError } = await db.from("project_budget_lines").insert(
      args.snapshot.lines.map((line) => ({
        ...line,
        budget_id: budget.id,
        tenant_id: args.tenantId,
        project_id: args.projectId,
        original_amount: line.total_price,
        approved_change_amount: 0,
      })),
    );
    if (lineError) {
      await db.from("project_budgets").delete().eq("id", budget.id).eq("tenant_id", args.tenantId);
      throw new BudgetPublishError(lineError.message);
    }
  }

  await makeBudgetCurrent(db, args.tenantId, args.projectId, budget.id, args.snapshot.totalPrice);
  const saved = await readVersionBudget(db, args.tenantId, args.versionId);
  return {
    created: true,
    budget: saved?.budget ?? { ...budget, is_current: true },
    lines: saved?.lines ?? [],
  };
}
