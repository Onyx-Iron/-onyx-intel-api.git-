import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function currentVersion(): string {
  return process.env.VERCEL_DEPLOYMENT_ID
    ?? process.env.VERCEL_GIT_COMMIT_SHA
    ?? process.env.NEXT_PUBLIC_APP_URL
    ?? "dev";
}

export async function GET(): Promise<NextResponse> {
  return NextResponse.json({
    version: currentVersion(),
    checked_at: new Date().toISOString(),
  }, {
    headers: {
      "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
    },
  });
}
