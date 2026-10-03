import type { Json } from "@/lib/supabase/types";

export interface DocumentRevisionMeta {
  source?: string;
  family_key: string;
  inferred_title: string;
  revision_token: string | null;
  revision_rank: number | null;
  plan_set_label: string;
  size?: number | null;
  storage?: string;
  storage_path?: string;
  drive_file_id?: string;
  content_type?: string;
  [key: string]: Json | undefined;
}

export interface DocumentRevisionSummary {
  family_key: string;
  inferred_title: string;
  plan_set_label: string;
  latest_revision: string | null;
  latest_rank: number;
  latest_document_id: string;
  latest_file_name: string;
  total_revisions: number;
  superseded_count: number;
}

export interface RevisionDocumentLike {
  id: string;
  file_name: string;
  uploaded_at: string | null;
  meta: Record<string, unknown> | null;
}

export function buildDocumentRevisionMeta(fileName: string, base: Omit<DocumentRevisionMeta, "family_key" | "inferred_title" | "revision_token" | "revision_rank" | "plan_set_label">): DocumentRevisionMeta {
  const parsed = parseDocumentRevision(fileName);
  return {
    ...base,
    family_key: parsed.familyKey,
    inferred_title: parsed.title,
    revision_token: parsed.revisionToken,
    revision_rank: parsed.revisionRank,
    plan_set_label: parsed.planSetLabel,
  };
}

export function buildDocumentRevisionSummaries(docs: RevisionDocumentLike[]): DocumentRevisionSummary[] {
  const grouped = new Map<string, RevisionDocumentLike[]>();
  for (const doc of docs) {
    const family = clean(doc.meta?.family_key) ?? parseDocumentRevision(doc.file_name).familyKey;
    if (!grouped.has(family)) grouped.set(family, []);
    grouped.get(family)?.push(doc);
  }

  const summaries: DocumentRevisionSummary[] = [];
  for (const [familyKey, familyDocs] of grouped) {
    const sorted = [...familyDocs].sort(compareRevisionDocs);
    const latest = sorted[0];
    const latestMeta = (latest.meta ?? {}) as Record<string, unknown>;
    const fallback = parseDocumentRevision(latest.file_name);
    summaries.push({
      family_key: familyKey,
      inferred_title: clean(latestMeta.inferred_title) ?? fallback.title,
      plan_set_label: clean(latestMeta.plan_set_label) ?? fallback.planSetLabel,
      latest_revision: clean(latestMeta.revision_token) ?? fallback.revisionToken,
      latest_rank: parseRank(latestMeta.revision_rank) ?? fallback.revisionRank ?? 0,
      latest_document_id: latest.id,
      latest_file_name: latest.file_name,
      total_revisions: familyDocs.length,
      superseded_count: Math.max(0, familyDocs.length - 1),
    });
  }

  return summaries.sort((a, b) => b.latest_rank - a.latest_rank || a.inferred_title.localeCompare(b.inferred_title));
}

export interface RevisionCandidate {
  id: string;
  file_name: string;
  uploaded_at: string | null;
  meta: Record<string, unknown> | null;
}

export function revisionIdentity(doc: RevisionCandidate): { familyKey: string; rank: number | null } {
  const meta = doc.meta ?? {};
  const parsed = parseDocumentRevision(doc.file_name);
  return {
    familyKey: clean(meta.family_key) ?? parsed.familyKey,
    rank: parseRank(meta.revision_rank) ?? parsed.revisionRank,
  };
}

/**
 * Immediate predecessor in the same family: highest revision_rank that is
 * still lower than the current sheet. Missing ranks are not guessed.
 */
export function selectPriorRevision(
  current: RevisionCandidate,
  docs: RevisionCandidate[],
): RevisionCandidate | null {
  const cur = revisionIdentity(current);
  if (cur.rank == null) return null;
  const priors = docs.filter((doc) => {
    if (doc.id === current.id) return false;
    const identity = revisionIdentity(doc);
    if (identity.familyKey !== cur.familyKey || identity.rank == null) return false;
    return identity.rank < cur.rank!;
  });
  if (priors.length === 0) return null;
  priors.sort((a, b) => {
    const rankA = revisionIdentity(a).rank ?? 0;
    const rankB = revisionIdentity(b).rank ?? 0;
    if (rankA !== rankB) return rankB - rankA;
    const timeA = a.uploaded_at ? new Date(a.uploaded_at).getTime() : 0;
    const timeB = b.uploaded_at ? new Date(b.uploaded_at).getTime() : 0;
    return timeB - timeA;
  });
  return priors[0];
}

export function parseDocumentRevision(fileName: string): {
  familyKey: string;
  title: string;
  revisionToken: string | null;
  revisionRank: number | null;
  planSetLabel: string;
} {
  const extStripped = fileName.replace(/\.[^.]+$/, "");
  const normalized = extStripped.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();

  const revisionMatch =
    normalized.match(/\b(?:rev(?:ision)?|ver(?:sion)?|add(?:endum)?)\s*([a-z0-9]+)\b/i) ??
    normalized.match(/\br\s*([0-9]{1,2})\b/i);

  const revisionToken = revisionMatch?.[1]?.toUpperCase() ?? null;
  const revisionRank = revisionToken ? revisionToRank(revisionToken) : null;
  const baseTitle = normalized
    .replace(/\b(?:rev(?:ision)?|ver(?:sion)?|add(?:endum)?)\s*[a-z0-9]+\b/ig, "")
    .replace(/\br\s*[0-9]{1,2}\b/ig, "")
    .replace(/\s+/g, " ")
    .trim();
  const title = baseTitle || normalized || fileName;
  const familyKey = slugify(title);
  const planSetLabel = revisionToken ? `${title} - Rev ${revisionToken}` : title;

  return { familyKey, title, revisionToken, revisionRank, planSetLabel };
}

function compareRevisionDocs(a: RevisionDocumentLike, b: RevisionDocumentLike): number {
  const metaA = (a.meta ?? {}) as Record<string, unknown>;
  const metaB = (b.meta ?? {}) as Record<string, unknown>;
  const parsedA = parseDocumentRevision(a.file_name);
  const parsedB = parseDocumentRevision(b.file_name);
  const rankA = parseRank(metaA.revision_rank) ?? parsedA.revisionRank ?? 0;
  const rankB = parseRank(metaB.revision_rank) ?? parsedB.revisionRank ?? 0;
  if (rankA !== rankB) return rankB - rankA;

  const timeA = a.uploaded_at ? new Date(a.uploaded_at).getTime() : 0;
  const timeB = b.uploaded_at ? new Date(b.uploaded_at).getTime() : 0;
  return timeB - timeA;
}

function revisionToRank(token: string): number {
  if (/^\d+$/.test(token)) return Number(token);
  if (/^[A-Z]$/.test(token)) return token.charCodeAt(0) - 64;
  return 0;
}

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function clean(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text ? text : null;
}

function parseRank(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}
