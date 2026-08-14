import type { ConfirmedTakeoffScope, TakeoffScopeMode } from "./contracts";

const MODES = new Set<TakeoffScopeMode>(["complete", "trades", "bid_packages", "documents", "alternates"]);

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value
    .filter((item): item is string => typeof item === "string" && item.trim() !== "")
    .map((item) => item.trim()))].sort();
}

/** Allowlist user-selectable scope fields and stamp authority server-side. */
export function sanitizeConfirmedTakeoffScope(value: unknown, userId: string, now = new Date()): ConfirmedTakeoffScope {
  const input = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const mode = input.mode as TakeoffScopeMode;
  if (!MODES.has(mode)) throw new Error("Choose a complete estimate or a specific trade, package, document, sheet, or alternate scope");
  const scope: ConfirmedTakeoffScope = {
    mode,
    tradeCodes: stringArray(input.tradeCodes),
    bidPackageIds: stringArray(input.bidPackageIds),
    documentIds: stringArray(input.documentIds),
    sheetIds: stringArray(input.sheetIds),
    alternateIds: stringArray(input.alternateIds),
    confirmedAt: now.toISOString(),
    confirmedBy: userId,
  };
  const selected = scope.tradeCodes.length + scope.bidPackageIds.length + scope.documentIds.length + scope.sheetIds.length + scope.alternateIds.length;
  if (mode !== "complete" && selected === 0) throw new Error("The selected processing scope is empty");
  return scope;
}
