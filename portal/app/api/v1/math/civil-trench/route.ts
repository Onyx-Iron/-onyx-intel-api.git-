import { auth, currentUser } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { pythonApiBaseUrl, pythonApiHeaders } from "@/lib/python-api";
import { civilTrenchRequestSchema } from "@/lib/validation";
import type { CivilTrenchResult } from "@/lib/types/takeoff";

export const runtime = "nodejs";

const PYTHON_API_URL = pythonApiBaseUrl();

/**
 * POST /api/v1/math/civil-trench
 * Delegates OSHA trench excavation math to the Python engine.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const raw = await req.json().catch(() => null);
  const parsed = civilTrenchRequestSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const user = await currentUser();
  const email = user?.emailAddresses?.[0]?.emailAddress ?? null;

  const res = await fetch(`${PYTHON_API_URL}/api/v1/math/civil-trench`, {
    method: "POST",
    headers: {
      ...pythonApiHeaders({ email }),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(parsed.data),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    return NextResponse.json({ error: err.detail ?? err }, { status: res.status });
  }

  const result = (await res.json()) as CivilTrenchResult;
  return NextResponse.json(result);
}
