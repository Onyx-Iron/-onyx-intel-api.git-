import { NextResponse } from "next/server";
import { isProductionRuntime, pythonApiBaseUrl } from "@/lib/python-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Liveness + config sanity. Never throws secrets — only reports whether
 * required production knobs are present so ops can see degraded deploys.
 */
export async function GET() {
  const checks: Record<string, "ok" | "missing" | "dev-fallback"> = {};

  const supabaseUrl = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL?.trim());
  const supabaseAnon = Boolean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim());
  const serviceKey = Boolean(
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || process.env.SUPABASE_SERVICE_KEY?.trim(),
  );
  checks.supabase_url = supabaseUrl ? "ok" : "missing";
  checks.supabase_anon = supabaseAnon ? "ok" : "missing";
  checks.supabase_service = serviceKey ? "ok" : "missing";

  const pythonConfigured = Boolean(process.env.PYTHON_API_URL?.trim());
  checks.python_api_url = pythonConfigured
    ? "ok"
    : isProductionRuntime()
      ? "missing"
      : "dev-fallback";

  const secretConfigured = Boolean(process.env.ONYX_API_SECRET?.trim());
  checks.onyx_api_secret = secretConfigured
    ? "ok"
    : isProductionRuntime()
      ? "missing"
      : "dev-fallback";

  let pythonBase: string | null = null;
  try {
    pythonBase = pythonApiBaseUrl();
  } catch {
    pythonBase = null;
    checks.python_api_url = "missing";
  }

  const hardMissing = Object.values(checks).includes("missing");
  const status = hardMissing ? 503 : 200;

  return NextResponse.json(
    {
      ok: !hardMissing,
      status: hardMissing ? "degraded" : "ok",
      checks,
      python_base: pythonBase,
      runtime: {
        node_env: process.env.NODE_ENV ?? null,
        vercel_env: process.env.VERCEL_ENV ?? null,
      },
    },
    { status },
  );
}
