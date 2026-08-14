import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
const DEPRECATED_WRITE_MESSAGE =
  "Legacy estimate item writes are disabled. Use /api/estimate/versions/[id] so edits stay inside the authoritative estimate version.";

interface RouteContext { params: Promise<{ id: string }> }

export async function PUT(req: NextRequest, ctx: RouteContext): Promise<NextResponse> {
  void req;
  void ctx;
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({ error: DEPRECATED_WRITE_MESSAGE }, { status: 410 });
}

export async function DELETE(req: NextRequest, ctx: RouteContext): Promise<NextResponse> {
  void req;
  void ctx;
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({ error: DEPRECATED_WRITE_MESSAGE }, { status: 410 });
}
