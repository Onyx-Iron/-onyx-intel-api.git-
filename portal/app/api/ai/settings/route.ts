import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import {
  MODEL_OPTIONS,
  PROVIDER_COOKIE,
  MODEL_COOKIE,
  isValidProvider,
  isValidModel,
  getUserAIPreference,
} from "@/lib/ai/preference";
import { availableProviders } from "@/lib/ai/providers";

export const runtime = "nodejs";

/**
 * GET /api/ai/settings
 *   Returns which providers are configured + the caller's saved preference
 *   + the model catalog so the picker can render without a second call.
 *
 * PUT /api/ai/settings   Body: { provider, model }
 *   Persists the choice as HttpOnly cookies (`onyx_ai_provider`, `onyx_ai_model`).
 *
 * DELETE /api/ai/settings
 *   Clears the preference — routes revert to env AI_DEFAULT_PROVIDER.
 */

export async function GET(): Promise<NextResponse> {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const configured = availableProviders();
  const { provider, model } = await getUserAIPreference();
  return NextResponse.json({
    configured,
    models: MODEL_OPTIONS,
    preference: { provider: provider ?? null, model: model ?? null },
  });
}

export async function PUT(req: NextRequest): Promise<NextResponse> {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({})) as { provider?: string; model?: string };
  const provider = body.provider ?? "";
  const model    = body.model ?? "";

  if (!isValidProvider(provider)) {
    return NextResponse.json({ error: `Unknown provider "${provider}"` }, { status: 400 });
  }
  if (!isValidModel(provider, model)) {
    return NextResponse.json({ error: `Unknown model "${model}" for provider "${provider}"` }, { status: 400 });
  }
  if (!availableProviders().includes(provider)) {
    return NextResponse.json(
      { error: `Provider "${provider}" has no API key configured on the server` },
      { status: 409 },
    );
  }

  const res = NextResponse.json({ ok: true, preference: { provider, model } });
  const oneYear = 60 * 60 * 24 * 365;
  const isProd = process.env.NODE_ENV === "production";
  res.cookies.set(PROVIDER_COOKIE, provider, { httpOnly: true, sameSite: "lax", secure: isProd, path: "/", maxAge: oneYear });
  res.cookies.set(MODEL_COOKIE,    model,    { httpOnly: true, sameSite: "lax", secure: isProd, path: "/", maxAge: oneYear });
  return res;
}

export async function DELETE(): Promise<NextResponse> {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const res = NextResponse.json({ ok: true, preference: { provider: null, model: null } });
  res.cookies.delete(PROVIDER_COOKIE);
  res.cookies.delete(MODEL_COOKIE);
  return res;
}
