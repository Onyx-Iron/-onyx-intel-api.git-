import { MASTERFORMAT_DIVISIONS } from "./taxonomy";

export type ScopeMode = "all_scopes" | "selected_trades" | "bid_packages" | "selected_documents" | "alternates";

export interface ScopeSelection {
  mode: ScopeMode;
  divisionCodes: string[];
  tradeKeys: string[];
  bidPackageIds: string[];
  documentIds: string[];
  sheetIds: string[];
  alternateKeys: string[];
}

export function normalizeScopeSelection(input: ScopeSelection): ScopeSelection {
  const unique = (values: string[]) => [...new Set(values.map((value) => value.trim()).filter(Boolean))];
  const knownDivisions = new Set(MASTERFORMAT_DIVISIONS.map((division) => division.code));
  const divisionCodes = unique(unique(input.divisionCodes).map((code) => code.padStart(2, "0").slice(0, 2))).filter((code) => knownDivisions.has(code));
  return { ...input, divisionCodes, tradeKeys: unique(input.tradeKeys), bidPackageIds: unique(input.bidPackageIds), documentIds: unique(input.documentIds), sheetIds: unique(input.sheetIds), alternateKeys: unique(input.alternateKeys) };
}

export function validateScopeSelection(input: ScopeSelection): string[] {
  const scope = normalizeScopeSelection(input);
  if (scope.mode === "all_scopes") return [];
  const selected = scope.divisionCodes.length + scope.tradeKeys.length + scope.bidPackageIds.length + scope.documentIds.length + scope.sheetIds.length + scope.alternateKeys.length;
  return selected > 0 ? [] : ["Select at least one division, trade, bid package, document, sheet, or alternate."];
}

export function estimateScopeWorkUnits(input: ScopeSelection): number {
  const scope = normalizeScopeSelection(input);
  if (scope.mode === "all_scopes") return MASTERFORMAT_DIVISIONS.length;
  return Math.max(1, scope.divisionCodes.length + scope.tradeKeys.length + scope.bidPackageIds.length * 2 + scope.documentIds.length * 3 + scope.sheetIds.length + scope.alternateKeys.length);
}
