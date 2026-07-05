import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { buildAuthUrl } from "@/lib/google/oauth";

export const runtime = "nodejs";

// Kicks off the Google connect flow — redirects the user to Google's consent.
export async function GET(): Promise<Response> {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const state = `${userId}.${Math.random().toString(36).slice(2)}`;
  return NextResponse.redirect(buildAuthUrl(state));
}
