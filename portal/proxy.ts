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
  // Vercel Cron has no Clerk session. The route checks CRON_SECRET
  // (or x-worker-secret) itself and returns 401 otherwise.
  "/api/internal/outbox/process",
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
