export interface SheetSourceIdentity {
  sheetNumber: string;
  discipline: string;
  revision?: string | null;
  issueDate?: string | null;
  checksum: string;
}

export type RevisionProposal =
  | { kind: "same_source"; reason: "same_checksum" }
  | { kind: "supersedes_proposed"; reason: "same_sheet_new_source" }
  | { kind: "conflict"; reason: "different_sheet_identity" | "ambiguous_issue_order" };

export function normalizeSheetIdentity(source: Pick<SheetSourceIdentity, "sheetNumber" | "discipline">): string {
  const discipline = source.discipline.trim().replace(/\s+/g, "_").toUpperCase();
  const sheet = source.sheetNumber.trim().replace(/[^A-Z0-9]/gi, "").toUpperCase();
  if (!discipline || !sheet) throw new Error("Sheet number and discipline are required for revision authority");
  return `${discipline}:${sheet}`;
}

export function proposeRevisionLineage(previous: SheetSourceIdentity, incoming: SheetSourceIdentity): RevisionProposal {
  if (normalizeSheetIdentity(previous) !== normalizeSheetIdentity(incoming)) {
    return { kind: "conflict", reason: "different_sheet_identity" };
  }
  if (previous.checksum === incoming.checksum) return { kind: "same_source", reason: "same_checksum" };
  const previousDate = previous.issueDate ? Date.parse(previous.issueDate) : Number.NaN;
  const incomingDate = incoming.issueDate ? Date.parse(incoming.issueDate) : Number.NaN;
  if (Number.isFinite(previousDate) && Number.isFinite(incomingDate) && incomingDate <= previousDate) {
    return { kind: "conflict", reason: "ambiguous_issue_order" };
  }
  return { kind: "supersedes_proposed", reason: "same_sheet_new_source" };
}

export function isCandidateCurrent(
  candidate: { manifestVersion: number; sourceChecksum: string },
  authority: { manifestVersion: number; sourceChecksum: string },
): boolean {
  return candidate.manifestVersion === authority.manifestVersion && candidate.sourceChecksum === authority.sourceChecksum;
}
