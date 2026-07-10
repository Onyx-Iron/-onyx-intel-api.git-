// Mid-market US division-level starter rates (CSI MasterFormat 2-digit divisions).
// The cost lookup in takeoff-import.ts falls back to 2-char prefix matching,
// so "03" matches any code starting with "03" (e.g. 03-30-00, 03-10-00, etc.)
export const STARTER_COST_CATALOG_RATES = [
  { csi_code: "01", description: "General Requirements", trade: "General", uom: "LS",  unit_cost: 15000 },
  { csi_code: "02", description: "Existing Conditions / Demolition", trade: "General", uom: "SF",  unit_cost: 4.50 },
  { csi_code: "03", description: "Concrete (placed in place)", trade: "Concrete", uom: "CY",  unit_cost: 850 },
  { csi_code: "04", description: "Masonry (CMU / brick)", trade: "Masonry", uom: "SF",  unit_cost: 38 },
  { csi_code: "05", description: "Structural Steel", trade: "Steel", uom: "TON", unit_cost: 4400 },
  { csi_code: "06", description: "Rough Carpentry / Wood Framing", trade: "Carpentry", uom: "SF",  unit_cost: 14 },
  { csi_code: "07", description: "Thermal & Moisture Protection", trade: "Roofing", uom: "SF",  unit_cost: 4.25 },
  { csi_code: "08", description: "Doors, Frames & Hardware", trade: "Carpentry", uom: "EA",  unit_cost: 1100 },
  { csi_code: "09", description: "Finishes (drywall, paint, flooring)", trade: "Finishes", uom: "SF",  unit_cost: 9.50 },
  { csi_code: "10", description: "Specialties", trade: "General", uom: "LS",  unit_cost: 3500 },
  { csi_code: "11", description: "Equipment", trade: "General", uom: "EA",  unit_cost: 6500 },
  { csi_code: "12", description: "Furnishings", trade: "General", uom: "EA",  unit_cost: 350 },
  { csi_code: "13", description: "Special Construction", trade: "General", uom: "LS",  unit_cost: 25000 },
  { csi_code: "14", description: "Conveying Equipment (elevators)", trade: "General", uom: "EA",  unit_cost: 45000 },
  { csi_code: "21", description: "Fire Suppression", trade: "Fire Protection", uom: "SF",  unit_cost: 7.50 },
  { csi_code: "22", description: "Plumbing", trade: "Plumbing", uom: "SF",  unit_cost: 14 },
  { csi_code: "23", description: "HVAC", trade: "HVAC", uom: "SF",  unit_cost: 22 },
  { csi_code: "25", description: "Integrated Automation", trade: "Electrical", uom: "SF",  unit_cost: 3.50 },
  { csi_code: "26", description: "Electrical", trade: "Electrical", uom: "SF",  unit_cost: 24 },
  { csi_code: "27", description: "Communications / Low Voltage", trade: "Electrical", uom: "SF",  unit_cost: 6.50 },
  { csi_code: "28", description: "Electronic Safety & Security", trade: "Electrical", uom: "SF",  unit_cost: 4.50 },
  { csi_code: "31", description: "Earthwork / Excavation", trade: "Civil", uom: "CY",  unit_cost: 32 },
  { csi_code: "32", description: "Exterior Improvements / Paving", trade: "Civil", uom: "SF",  unit_cost: 9 },
  { csi_code: "33", description: "Site Utilities", trade: "Civil", uom: "LF",  unit_cost: 75 },
  { csi_code: "34", description: "Transportation", trade: "Civil", uom: "LS",  unit_cost: 10000 },
  { csi_code: "35", description: "Waterway & Marine Construction", trade: "Civil", uom: "LS",  unit_cost: 20000 },
];

/**
 * Seeds a tenant's cost_catalog with starter rates if it's empty. Called
 * once when a tenant is first created (getOrCreateTenant) so a brand-new
 * tenant never silently sits with zero pricing data until someone manually
 * discovers and clicks "Seed starter rates" — the same failure mode that
 * previously affected the (now-seeded) global cost_codes catalog.
 */
export async function seedStarterCostCatalog(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  tenantId: string,
): Promise<number> {
  const { count } = await db
    .from("cost_catalog")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId);
  if ((count ?? 0) > 0) return 0;

  const payload = STARTER_COST_CATALOG_RATES.map((r) => ({ ...r, tenant_id: tenantId }));
  const { data, error } = await db.from("cost_catalog").insert(payload).select("id");
  if (error) {
    console.error("[seedStarterCostCatalog]", error);
    return 0;
  }
  return data?.length ?? 0;
}
