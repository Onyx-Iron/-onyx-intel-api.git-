// Deterministic, server-side-only cost calculations for estimate items and
// versions. Never trust a total computed in the browser — every route that
// writes estimate_items must run its cost fields through these functions
// before persisting, and the review UI displays exactly what these
// functions compute (STEP 3/STEP 12: "do not hide pricing components
// behind unexplained totals").

export interface DirectCostInputs {
  laborCost?: number | null;
  materialCost?: number | null;
  equipmentCost?: number | null;
  truckingCost?: number | null;
  subcontractCost?: number | null;
  disposalCost?: number | null;
  testingCost?: number | null;
  otherDirectCost?: number | null;
}

export interface ItemCalculationInputs extends DirectCostInputs {
  quantity?: number | null;
  // Indirect/contingency/overhead/profit may each be supplied as an
  // explicit dollar amount (item-level override) OR left undefined, in
  // which case the caller applies the version-level percentages via
  // applyVersionPercentages below. Both paths write to the same fields —
  // there is exactly one total_price field, never two competing totals.
  indirectCost?: number | null;
  contingency?: number | null;
  overhead?: number | null;
  profit?: number | null;
}

export interface ItemCalculationResult {
  totalDirectCost: number;
  costBeforeProfit: number;
  totalPrice: number;
  unitPrice: number | null;
  markup: number | null; // profit / costBeforeProfit
  margin: number | null; // profit / sellingPrice (totalPrice)
}

const n = (v: number | null | undefined): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

// Rounds to the nearest cent using standard rounding (never truncation),
// applied once at the very end of a calculation chain — intermediate
// values are kept at full precision so rounding error cannot compound
// across labor+material+equipment+... sums.
export function roundCurrency(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function computeDirectCost(inputs: DirectCostInputs): number {
  return roundCurrency(
    n(inputs.laborCost) + n(inputs.materialCost) + n(inputs.equipmentCost) +
    n(inputs.truckingCost) + n(inputs.subcontractCost) + n(inputs.disposalCost) +
    n(inputs.testingCost) + n(inputs.otherDirectCost),
  );
}

// direct cost + indirect cost + contingency + overhead
export function computeCostBeforeProfit(directCost: number, indirectCost: number, contingency: number, overhead: number): number {
  return roundCurrency(n(directCost) + n(indirectCost) + n(contingency) + n(overhead));
}

// cost before profit + profit
export function computeSellingPrice(costBeforeProfit: number, profit: number): number {
  return roundCurrency(n(costBeforeProfit) + n(profit));
}

// Markup: profit divided by cost BEFORE profit — this is a percentage of
// cost, always >= 0 when profit >= 0, and can exceed 100%.
export function computeMarkup(profit: number, costBeforeProfit: number): number | null {
  if (costBeforeProfit === 0) return null; // undefined, not zero — division by zero is not "0% markup"
  return profit / costBeforeProfit;
}

// Margin: profit divided by SELLING PRICE — this is a percentage of
// revenue, always < 100% for any finite positive cost. Markup and margin
// use different denominators and must never be conflated or stored under
// the same field name.
export function computeMargin(profit: number, sellingPrice: number): number | null {
  if (sellingPrice === 0) return null;
  return profit / sellingPrice;
}

/**
 * Full item-level calculation. Given raw cost-category inputs and
 * indirect/contingency/overhead/profit (either explicit item-level dollar
 * overrides, or already resolved from version-level percentages by the
 * caller via applyVersionPercentages), returns every derived total. This is
 * the single function every write path must call — no route should compute
 * total_price by hand.
 */
export function calculateItem(inputs: ItemCalculationInputs): ItemCalculationResult {
  const totalDirectCost = computeDirectCost(inputs);
  const costBeforeProfit = computeCostBeforeProfit(totalDirectCost, n(inputs.indirectCost), n(inputs.contingency), n(inputs.overhead));
  const profit = roundCurrency(n(inputs.profit));
  const totalPrice = computeSellingPrice(costBeforeProfit, profit);
  const quantity = n(inputs.quantity);
  return {
    totalDirectCost,
    costBeforeProfit,
    totalPrice,
    unitPrice: quantity !== 0 ? roundCurrency(totalPrice / quantity) : null,
    markup: computeMarkup(profit, costBeforeProfit),
    margin: computeMargin(profit, totalPrice),
  };
}

export interface VersionPercentages {
  contingencyPct?: number | null;
  overheadPct?: number | null;
  profitPct?: number | null;
}

export interface ResolvedVersionAmounts {
  contingency: number;
  overhead: number;
  profit: number;
}

/**
 * Applies version-level percentages to a direct cost + explicit indirect
 * cost, using the same cascade the legacy Pricing Matrix used (direct ->
 * +contingency -> subtotal -> *(1+overhead%) -> *(1+profit%)), so migrated
 * totals reconcile exactly with pre-migration values. profit_pct here is a
 * MARKUP percentage (profit / cost-before-profit) by definition — never a
 * margin percentage; computeMargin above is always derived, never a stored
 * input.
 */
export function applyVersionPercentages(
  directCost: number,
  indirectCost: number,
  pct: VersionPercentages,
): ResolvedVersionAmounts {
  const direct = n(directCost);
  const indirect = n(indirectCost);
  const contingency = roundCurrency((direct + indirect) * (n(pct.contingencyPct) / 100));
  const overhead = roundCurrency((direct + indirect + contingency) * (n(pct.overheadPct) / 100));
  const profit = roundCurrency((direct + indirect + contingency + overhead) * (n(pct.profitPct) / 100));
  return { contingency, overhead, profit };
}

export interface EstimateTotals {
  totalDirectCost: number;
  totalIndirectCost: number;
  totalContingency: number;
  totalOverhead: number;
  totalProfit: number;
  costBeforeProfit: number;
  totalPrice: number;
  markup: number | null;
  margin: number | null;
}

export interface EstimateTotalsItemInput {
  totalDirectCost?: number | null;
  indirectCost?: number | null;
  contingency?: number | null;
  overhead?: number | null;
  profit?: number | null;
  totalPrice?: number | null;
  isAlternate?: boolean | null;
  alternateAccepted?: boolean | null;
}

/**
 * Rolls up item-level totals into an estimate/version-level total.
 * Alternates are excluded from the roll-up unless explicitly accepted —
 * this is the single source of truth both the estimate screen, the
 * proposal, and the SOV must call, so "proposal total equals estimate
 * total equals SOV total" holds by construction rather than by convention.
 */
export function calculateEstimateTotals(items: EstimateTotalsItemInput[]): EstimateTotals {
  const included = items.filter((it) => !it.isAlternate || it.alternateAccepted);
  const totalDirectCost = roundCurrency(included.reduce((s, it) => s + n(it.totalDirectCost), 0));
  const totalIndirectCost = roundCurrency(included.reduce((s, it) => s + n(it.indirectCost), 0));
  const totalContingency = roundCurrency(included.reduce((s, it) => s + n(it.contingency), 0));
  const totalOverhead = roundCurrency(included.reduce((s, it) => s + n(it.overhead), 0));
  const totalProfit = roundCurrency(included.reduce((s, it) => s + n(it.profit), 0));
  const totalPrice = roundCurrency(included.reduce((s, it) => s + n(it.totalPrice), 0));
  const costBeforeProfit = roundCurrency(totalDirectCost + totalIndirectCost + totalContingency + totalOverhead);
  return {
    totalDirectCost,
    totalIndirectCost,
    totalContingency,
    totalOverhead,
    totalProfit,
    costBeforeProfit,
    totalPrice,
    markup: computeMarkup(totalProfit, costBeforeProfit),
    margin: computeMargin(totalProfit, totalPrice),
  };
}
