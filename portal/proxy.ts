import { clerkMiddleware } from "@clerk/nextjs/server";
import { NextResponse, type NextFetchEvent, type NextRequest } from "next/server";

// Clerk initializes authentication context here. Authorization is enforced at
// each page, API route, or service boundary so public capabilities and future
// routes cannot be accidentally coupled to a brittle path allowlist.
const clerkProxy = clerkMiddleware();

export default function proxy(request: NextRequest, event: NextFetchEvent) {
  if (process.env.PLAYWRIGHT_TEST_MODE === "1" && request.nextUrl.pathname.startsWith("/e2e/")) {
    return NextResponse.next();
  }
  return clerkProxy(request, event);
}

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
