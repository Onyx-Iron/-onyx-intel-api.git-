import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

const isPublicRoute = createRouteMatcher([
  "/",
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/api/google/callback(.*)",
  // Public vendor bid portal (no Clerk login by design — the request's own
  // uuid is the capability token, see /api/public/procurement-request/[id]
  // and /api/procurement/bids for the trust model) — without these,
  // auth.protect() blocks external suppliers before they ever reach the page.
  "/public/bids(.*)",
  "/api/public/(.*)",
  "/api/procurement/bids",
  // Server-to-server outbox trigger (Vercel Cron + pg_net). Authenticates via
  // Authorization: Bearer $CRON_SECRET or x-worker-secret — Clerk sessions
  // are never present. Without this, auth.protect() 307s/401s before the
  // route's own secret check runs.
  "/api/internal/outbox/process",
  // Paddle billing webhooks verify their own signature; no Clerk session.
  "/api/billing/webhook",
]);

export default clerkMiddleware(async (auth, request) => {
  if (!isPublicRoute(request)) {
    // Without an explicit redirect target, auth.protect() falls back to
    // Clerk's own default flow, which doesn't know this app has a custom
    // /sign-in page — the resulting rewrite 404s instead of redirecting
    // signed-out users anywhere useful.
    await auth.protect({ unauthenticatedUrl: new URL("/sign-in", request.url).toString() });
  }
});

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
