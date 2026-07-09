import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import {
  getOrCreateTenant,
  authTenantKey,
  authTenantName,
} from "@/lib/project-controls/server";

export const runtime = "nodejs";

type SearchResult = {
  kind: "project" | "document" | "contact" | "generated_document";
  id: string;
  title: string;
  project_id?: string | null;
  snippet?: string | null;
  score: number;
};

const PER_CATEGORY = 10;
const TOTAL_CAP = 40;

function escapeIlikePattern(input: string): string {
  // Escape PostgREST ILIKE wildcards so the query is treated as a literal substring.
  return input.replace(/[\\%_,()]/g, (m) => `\\${m}`);
}

function score(haystack: string | null | undefined, needle: string): number {
  if (!haystack) return 0;
  const h = haystack.toLowerCase();
  const n = needle.toLowerCase();
  if (!n) return 0;
  if (h === n) return 1000;
  if (h.startsWith(n)) return 500;
  const idx = h.indexOf(n);
  if (idx === 0) return 500;
  if (idx > 0) return Math.max(100 - idx, 10);
  return 0;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const { userId, orgId, orgSlug } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const q = (req.nextUrl.searchParams.get("q") ?? "").trim();
    if (!q) {
      return NextResponse.json({ results: [] });
    }

    const tenantId = await getOrCreateTenant(
      authTenantKey(userId, orgId),
      authTenantName(userId, orgSlug),
    );

    const db = await createServiceClient();
    const pat = `%${escapeIlikePattern(q)}%`;

    const [projectsRes, documentsRes, contactsRes, generatedRes] =
      await Promise.all([
        db
          .from("projects")
          .select("id, name, address, city, state")
          .eq("tenant_id", tenantId)
          .ilike("name", pat)
          .limit(PER_CATEGORY),
        db
          .from("documents")
          .select("id, file_name, meta, project_id")
          .eq("tenant_id", tenantId)
          .or(`file_name.ilike.${pat},meta->>inferred_title.ilike.${pat}`)
          .limit(PER_CATEGORY),
        db
          .from("contacts")
          .select("id, name, company, role, project_id")
          .eq("tenant_id", tenantId)
          .or(`name.ilike.${pat},company.ilike.${pat}`)
          .limit(PER_CATEGORY),
        db
          .from("generated_documents")
          .select("id, title, doc_type, project_id")
          .eq("tenant_id", tenantId)
          .ilike("title", pat)
          .limit(PER_CATEGORY),
      ]);

    const results: SearchResult[] = [];

    if (!projectsRes.error && projectsRes.data) {
      for (const row of projectsRes.data) {
        const loc = [row.city, row.state].filter(Boolean).join(", ");
        results.push({
          kind: "project",
          id: row.id,
          title: row.name,
          project_id: row.id,
          snippet: row.address || loc || null,
          score: score(row.name, q),
        });
      }
    }

    if (!documentsRes.error && documentsRes.data) {
      for (const row of documentsRes.data) {
        const meta =
          typeof row.meta === "object" && row.meta !== null
            ? (row.meta as Record<string, unknown>)
            : {};
        const inferred =
          typeof meta.inferred_title === "string"
            ? (meta.inferred_title as string)
            : null;
        const title = inferred || row.file_name;
        const s = Math.max(score(row.file_name, q), score(inferred, q));
        results.push({
          kind: "document",
          id: row.id,
          title,
          project_id: row.project_id,
          snippet: inferred ? row.file_name : null,
          score: s,
        });
      }
    }

    if (!contactsRes.error && contactsRes.data) {
      for (const row of contactsRes.data) {
        const s = Math.max(score(row.name, q), score(row.company, q));
        const snippet = [row.role, row.company].filter(Boolean).join(" · ") || null;
        results.push({
          kind: "contact",
          id: row.id,
          title: row.name,
          project_id: row.project_id,
          snippet,
          score: s,
        });
      }
    }

    if (!generatedRes.error && generatedRes.data) {
      for (const row of generatedRes.data) {
        results.push({
          kind: "generated_document",
          id: row.id,
          title: row.title,
          project_id: row.project_id,
          snippet: row.doc_type ?? null,
          score: score(row.title, q),
        });
      }
    }

    results.sort((a, b) => b.score - a.score);
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const trimmed = results.slice(0, TOTAL_CAP).map(({ score: _s, ...r }) => r);

    return NextResponse.json({ results: trimmed });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: `[GET /api/search] ${msg}` },
      { status: 500 },
    );
  }
}
