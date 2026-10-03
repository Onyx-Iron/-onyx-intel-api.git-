import { auth, currentUser } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { headerSafe } from "@/lib/http";
import { pythonApiHeaders } from "@/lib/python-api";

const PYTHON_API_URL = headerSafe(process.env.PYTHON_API_URL) || "http://localhost:5050";

export const runtime = "nodejs";
// Pro Fluid cap. This waits on the Python template matcher.
export const maxDuration = 800;

/** Crop from the sheet canvas, counted by the Python template matcher. */
export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const { userId, orgId } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const inbound = await req.formData();
    const page = inbound.get("page");
    const template = inbound.get("template");
    if (!(page instanceof File) || !(template instanceof File)) {
      return NextResponse.json({ error: "page and template image files are required" }, { status: 400 });
    }
    const threshold = headerSafe(String(inbound.get("threshold") ?? "0.8")) || "0.8";
    const className = headerSafe(String(inbound.get("class_name") ?? "symbol")) || "symbol";
    const outbound = new FormData();
    outbound.set("page", page, page.name || "page.png");
    outbound.set("template", template, template.name || "template.png");

    const user = await currentUser();
    const upstream = await fetch(`${PYTHON_API_URL}/api/vision/count-template?threshold=${encodeURIComponent(threshold)}`, {
      method: "POST",
      headers: pythonApiHeaders({
        email: user?.primaryEmailAddress?.emailAddress,
        tenantId: orgId ?? `user_${userId}`,
      }),
      body: outbound,
    });
    const payload = await upstream.json().catch(() => ({}));
    if (!upstream.ok) {
      const detail = typeof payload.detail === "string" ? payload.detail : payload.error ?? upstream.statusText;
      return NextResponse.json({ error: String(detail) }, { status: upstream.status });
    }
    return NextResponse.json({ ...payload, class_name: className });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
