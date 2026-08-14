// Current-estimate read helpers. These keep every project surface pointed at
// the same estimate version instead of re-querying all historical/draft rows.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = any;

export interface CurrentEstimateRef {
  estimateId: string;
  versionId: string;
}

export async function getCurrentEstimateRef(
  db: AnyDb,
  tenantId: string,
  projectId: string,
): Promise<CurrentEstimateRef | null> {
  const { data, error } = await db
    .from("estimates")
    .select("id,current_version_id")
    .eq("tenant_id", tenantId)
    .eq("project_id", projectId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data?.current_version_id) return null;
  return { estimateId: data.id, versionId: data.current_version_id };
}

export async function listCurrentEstimateItems(
  db: AnyDb,
  tenantId: string,
  projectId: string,
): Promise<Record<string, unknown>[]> {
  const current = await getCurrentEstimateRef(db, tenantId, projectId);
  if (!current) return [];

  const { data, error } = await db
    .from("estimate_items")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("project_id", projectId)
    .eq("estimate_version_id", current.versionId)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function listTenantCurrentEstimateItems(
  db: AnyDb,
  tenantId: string,
): Promise<Record<string, unknown>[]> {
  const { data: estimates, error: estimateError } = await db
    .from("estimates")
    .select("current_version_id")
    .eq("tenant_id", tenantId)
    .not("current_version_id", "is", null);
  if (estimateError) throw estimateError;

  const versionIds = (estimates ?? [])
    .map((row: { current_version_id: string | null }) => row.current_version_id)
    .filter((id: string | null): id is string => Boolean(id));
  if (versionIds.length === 0) return [];

  const { data, error } = await db
    .from("estimate_items")
    .select("*")
    .eq("tenant_id", tenantId)
    .in("estimate_version_id", versionIds)
    .order("project_id", { ascending: true })
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export function currentItemTotal(item: Record<string, unknown>): number {
  const totalPrice = Number(item.total_price ?? 0);
  if (Number.isFinite(totalPrice) && totalPrice > 0) return totalPrice;

  const quantity = Number(item.quantity ?? 0);
  const unitCost = Number(item.unit_cost ?? item.unit_price ?? 0);
  if (!Number.isFinite(quantity) || !Number.isFinite(unitCost)) return 0;
  return quantity * unitCost;
}

export function normalizeCurrentEstimateItemForProcurement(item: Record<string, unknown>) {
  return {
    id: String(item.id ?? ""),
    cost_code: String(item.cost_code ?? item.csi_code ?? ""),
    description: String(item.description ?? item.scope_category ?? "Estimate item"),
    quantity: Number(item.quantity ?? 1) || 1,
    unit: String(item.uom ?? item.unit ?? "EA"),
  };
}

export function normalizeCurrentEstimateItemForQc(item: Record<string, unknown>) {
  const quantity = typeof item.quantity === "number" ? item.quantity : Number(item.quantity ?? 0);
  const unitPrice = item.unit_cost ?? item.unit_price;
  const normalizedUnitPrice = typeof unitPrice === "number" ? unitPrice : Number(unitPrice ?? 0);
  return {
    ...item,
    csi_code: item.csi_code ?? item.cost_code ?? null,
    unit_cost: Number.isFinite(normalizedUnitPrice) && normalizedUnitPrice > 0
      ? normalizedUnitPrice
      : quantity > 0
        ? currentItemTotal(item) / quantity
        : null,
  };
}
