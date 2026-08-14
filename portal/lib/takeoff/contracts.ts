export const TAKEOFF_JOB_STATES = [
  "uploaded",
  "validated",
  "split",
  "classified",
  "extracted",
  "quantity_validated",
  "review_ready",
  "approved",
  "estimate_imported",
  "blocked",
  "conflicted",
  "failed_retryable",
  "failed_terminal",
  "superseded",
  "cancelled",
] as const;

export type TakeoffJobState = (typeof TAKEOFF_JOB_STATES)[number];
export type TakeoffWorkUnitState = TakeoffJobState;

export type TakeoffScopeMode = "complete" | "trades" | "bid_packages" | "documents" | "alternates";

export interface ConfirmedTakeoffScope {
  mode: TakeoffScopeMode;
  tradeCodes: string[];
  bidPackageIds: string[];
  documentIds: string[];
  sheetIds: string[];
  alternateIds: string[];
  confirmedAt: string;
  confirmedBy: string;
}

export interface TakeoffJobRecord {
  id: string;
  tenantId: string;
  projectId: string;
  state: TakeoffJobState;
  rowVersion: number;
  scope: ConfirmedTakeoffScope;
}

export interface TakeoffWorkUnitStatus {
  state: TakeoffWorkUnitState;
  exclusionAuthorized?: boolean;
}

export interface TakeoffJobCompletion {
  complete: boolean;
  terminal: boolean;
  unresolved: number;
  failed: number;
}
