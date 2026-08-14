import type { ConfirmedTakeoffScope, TakeoffScopeMode } from "./contracts";

interface SheetDescriptor {
  discipline?: string | null;
  sheetNumber?: string | null;
  revision?: string | null;
  revisionDate?: string | null;
}

interface VisionSourceInput {
  documentId: string;
  pageId: string;
  pageNumber: number;
  checksum: string;
  sheet: SheetDescriptor | null;
}

export interface VisionSourceDescriptor {
  sheetIdentity: string;
  discipline: string;
  sheetNumber: string;
  revisionLabel: string | null;
  issueDate: string | null;
  sourceChecksum: string;
}

function clean(value: string | null | undefined): string | null {
  const normalized = value?.trim().toUpperCase();
  return normalized ? normalized : null;
}

export function buildVisionSourceDescriptor(input: VisionSourceInput): VisionSourceDescriptor {
  const discipline = clean(input.sheet?.discipline);
  const sheetNumber = clean(input.sheet?.sheetNumber);
  return {
    sheetIdentity: discipline && sheetNumber ? `${discipline}:${sheetNumber}` : `DOCUMENT:${input.documentId}:PAGE:${input.pageNumber}`,
    discipline: discipline ?? "UNCLASSIFIED",
    sheetNumber: sheetNumber ?? `PAGE-${input.pageNumber}`,
    revisionLabel: clean(input.sheet?.revision),
    issueDate: input.sheet?.revisionDate ?? null,
    sourceChecksum: input.checksum,
  };
}

interface StoredScopeRequest {
  mode: "all_scopes" | "selected_trades" | "bid_packages" | "selected_documents" | "alternates";
  division_codes?: string[] | null;
  trade_keys?: string[] | null;
  bid_package_ids?: string[] | null;
  document_ids?: string[] | null;
  sheet_ids?: string[] | null;
  alternate_keys?: string[] | null;
  confirmed_at?: string | null;
  requested_by?: string | null;
}

const MODE_MAP: Record<StoredScopeRequest["mode"], TakeoffScopeMode> = {
  all_scopes: "complete",
  selected_trades: "trades",
  bid_packages: "bid_packages",
  selected_documents: "documents",
  alternates: "alternates",
};

function sorted(values: string[] | null | undefined): string[] {
  return [...new Set((values ?? []).filter(Boolean))].sort();
}

export function scopeRequestToJobScope(scope: StoredScopeRequest, activeDocumentId: string, actorUserId: string): ConfirmedTakeoffScope {
  return {
    mode: MODE_MAP[scope.mode],
    tradeCodes: sorted([...(scope.division_codes ?? []), ...(scope.trade_keys ?? [])]),
    bidPackageIds: sorted(scope.bid_package_ids),
    documentIds: sorted([...(scope.document_ids ?? []), activeDocumentId]),
    sheetIds: sorted(scope.sheet_ids),
    alternateIds: sorted(scope.alternate_keys),
    confirmedAt: scope.confirmed_at ?? new Date().toISOString(),
    confirmedBy: scope.requested_by ?? actorUserId,
  };
}
