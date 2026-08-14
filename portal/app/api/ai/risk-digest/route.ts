import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getOrCreateTenant, authTenantKey, authTenantName } from "@/lib/project-controls/server";
import { headerSafe } from "@/lib/http";
import { logEvent } from "@/lib/activity";
import { loadProjectKnowledgeSnapshot } from "@/lib/projects/knowledge";
import { checkAiRateLimit } from "@/lib/ai/rate-limit";
import { assertPermission, PermissionError } from "@/lib/project-controls/permissions";

export const runtime = "nodejs";
export const maxDuration = 60;

const GEMINI_API_KEY = headerSafe(process.env.GEMINI_API_KEY);
const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta";
// Use flash for batch generation — faster and cheaper
const DIGEST_MODEL = process.env.GEMINI_DIGEST_MODEL ?? "gemini-3.5-flash-lite";

interface DigestResult {
  risk_level: "low" | "medium" | "high" | "critical";
  bullets: string[];
}

async function generateDigest(snapshot: unknown): Promise<DigestResult | null> {
  if (!GEMINI_API_KEY) throw new Error("NO_PROVIDER");

  const prompt = `You are a construction project risk analyst. Analyze this project data and identify the top 3 risks or concerns.

Project Data:
${JSON.stringify(snapshot, null, 2)}

Return a JSON object with:
- "risk_level": one of "low", "medium", "high", or "critical"
- "bullets": array of exactly 3 concise risk statements (1 sentence each), specific to the data

Risk level guidance:
- low: project on track, minor issues only
- medium: 1-2 notable concerns worth monitoring
- high: significant issues requiring attention this week
- critical: blockers or major budget/schedule overruns

Be specific — reference actual numbers, counts, and dates from the data. Do not use filler bullets if data is sparse; note what's missing instead.`;

  const res = await fetch(
    `${GEMINI_BASE}/models/${DIGEST_MODEL}:generateContent?key=${GEMINI_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 512,
          responseMimeType: "application/json",
          responseSchema: {
            type: "OBJECT",
            properties: {
              risk_level: { type: "STRING" },
              bullets: { type: "ARRAY", items: { type: "STRING" } },
            },
            required: ["risk_level", "bullets"],
          },
        },
      }),
    },
  );

  if (!res.ok) return null;

  const data = await res.json() as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };

  const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  try {
    const parsed = JSON.parse(text) as { risk_level?: string; bullets?: string[] };
    const risk_level = (["low", "medium", "high", "critical"].includes(parsed.risk_level ?? "")
      ? parsed.risk_level
      : "medium") as DigestResult["risk_level"];
    const bullets = (parsed.bullets ?? []).slice(0, 3);
    while (bullets.length < 3) bullets.push("Insufficient data to assess this risk area.");
    return { risk_level, bullets };
  } catch {
    return null;
  }
}

// GET /api/ai/risk-digest?project_id=... — fetch latest digest
export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const { userId, orgId, orgSlug } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const project_id = req.nextUrl.searchParams.get("project_id");
    if (!project_id) return NextResponse.json({ error: "project_id required" }, { status: 400 });

    const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
    await assertPermission(tenantId, userId, "financial", "read");
    const db = await createServiceClient();

    const { data } = await db
      .from("project_risk_digests")
      .select("id, risk_level, bullets, generated_at, data_snapshot")
      .eq("project_id", project_id)
      .eq("tenant_id", tenantId)
      .order("generated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    return NextResponse.json({ digest: data ?? null });
  } catch (err: unknown) {
    return NextResponse.json({ error: String(err) }, { status: err instanceof PermissionError ? 403 : 500 });
  }
}

// POST /api/ai/risk-digest — on-demand generation for one project
export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const { userId, orgId, orgSlug } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { project_id } = await req.json() as { project_id?: string };
    if (!project_id) return NextResponse.json({ error: "project_id required" }, { status: 400 });

    const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
    await assertPermission(tenantId, userId, "financial", "read");
    const db = await createServiceClient();

    // Verify project ownership
    const { data: project } = await db
      .from("projects").select("id").eq("id", project_id).eq("tenant_id", tenantId).single();
    if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

    const rl = await checkAiRateLimit(tenantId, "ai/risk-digest", { windowMs: 60_000, max: 5 });
    if (!rl.ok) {
      return NextResponse.json(
        { error: "Too many risk analysis requests — please slow down." },
        { status: 429, headers: { "Retry-After": String(rl.retryAfterSeconds) } },
      );
    }

    const snapshot = await loadProjectKnowledgeSnapshot(tenantId, project_id);
    if (!snapshot) return NextResponse.json({ error: "Could not build the project snapshot. Try again in a moment." }, { status: 500 });

    let digest: DigestResult | null;
    try {
      digest = await generateDigest(snapshot);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg === "NO_PROVIDER") {
        return NextResponse.json({ error: "No AI provider is connected yet. Open billing settings, connect a provider, and try again.", code: "NO_PROVIDER" }, { status: 503 });
      }
      throw e;
    }
    if (!digest) return NextResponse.json({ error: "AI generation failed" }, { status: 502 });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: saved, error: saveErr } = await (db as any)
      .from("project_risk_digests")
      .insert({
        project_id,
        tenant_id: tenantId,
        risk_level: digest.risk_level,
        bullets: digest.bullets,
        data_snapshot: snapshot,
      })
      .select("id, risk_level, bullets, generated_at, data_snapshot")
      .single();

    if (saveErr) return NextResponse.json({ error: saveErr.message }, { status: 500 });

    void logEvent({
      projectId: project_id,
      tenantId,
      userId,
      entityType: "ai_digest",
      entityId: (saved as { id: string }).id,
      action: "generated",
      title: `Risk digest generated: ${digest.risk_level} risk`,
      meta: { risk_level: digest.risk_level },
    });

    return NextResponse.json({ digest: saved });
  } catch (err: unknown) {
    return NextResponse.json({ error: String(err) }, { status: err instanceof PermissionError ? 403 : 500 });
  }
}
