import type { createServiceClient } from "@/lib/supabase/server";

type ServiceClient = Awaited<ReturnType<typeof createServiceClient>>;

export interface ProjectMemory {
  id: string;
  project_id: string;
  tenant_id: string;
  fact: string;
  source_document_id: string | null;
  source_page: number | null;
  created_at: string;
}

export async function listProjectMemories(
  db: ServiceClient,
  tenantId: string,
  projectId: string,
  limit = 40,
): Promise<ProjectMemory[]> {
  const { data } = await db
    .from("memories")
    .select("id, project_id, tenant_id, fact, source_document_id, source_page, created_at")
    .eq("tenant_id", tenantId)
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(limit);

  return (data ?? []) as ProjectMemory[];
}

const CURRENCY_AMOUNT = /\$\s*\d/;
const MONEY_WORD = /\b(budget|retainage|markup|profit|contract value|unit cost|unit price)\b/i;
const LARGE_AMOUNT = /\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d{4,}(?:\.\d+)?/;

/** True when free text states a dollar figure a restricted role must not receive. */
export function isFinancialMemoryFact(fact: string): boolean {
  if (CURRENCY_AMOUNT.test(fact)) return true;
  return MONEY_WORD.test(fact) && LARGE_AMOUNT.test(fact);
}

export function memoriesForFinancialAccess(
  memories: ProjectMemory[],
  canReadFinancial: boolean,
): ProjectMemory[] {
  if (canReadFinancial) return memories;
  return memories.filter((memory) => !isFinancialMemoryFact(memory.fact));
}

export function formatMemoriesBlock(memories: ProjectMemory[]): string {
  if (memories.length === 0) return "";
  const lines = memories.map((m, i) => `${i + 1}. ${m.fact}`).join("\n");
  return `\n\n--- Project Memory (durable facts across tools) ---\n${lines}\n--- End Project Memory ---`;
}

/** Deduplicate near-identical facts before insert (case-insensitive trim). */
export function normalizeFact(fact: string): string {
  return fact.replace(/\s+/g, " ").trim();
}

export async function upsertMemoryFacts(
  db: ServiceClient,
  tenantId: string,
  projectId: string,
  facts: string[],
  sourceDocumentId?: string | null,
  sourcePage?: number | null,
): Promise<number> {
  const cleaned = [...new Set(facts.map(normalizeFact).filter((f) => f.length >= 8 && f.length <= 500))];
  if (cleaned.length === 0) return 0;

  const existing = await listProjectMemories(db, tenantId, projectId, 200);
  const existingKeys = new Set(existing.map((m) => m.fact.toLowerCase()));

  const rows = cleaned
    .filter((f) => !existingKeys.has(f.toLowerCase()))
    .map((fact) => ({
      tenant_id: tenantId,
      project_id: projectId,
      fact,
      source_document_id: sourceDocumentId ?? null,
      source_page: sourcePage ?? null,
    }));

  if (rows.length === 0) return 0;

  const { error } = await db.from("memories").insert(rows as never);
  if (error) throw new Error(error.message);
  return rows.length;
}
