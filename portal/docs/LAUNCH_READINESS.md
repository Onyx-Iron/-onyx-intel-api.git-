# Onyx Iron launch readiness

Updated: 2026-08-03

## Product work completed in this pass

- Reports is now a real persisted workspace:
  `/dashboard/reports`, `/api/reports`, `/api/reports/[id]`, and the
  `report_runs` table.
- Project Management is now a real cross-project workspace:
  `/dashboard/project-management` and `/api/project-management/overview`.
- Preconstruction is now a real bid-pipeline workspace:
  `/dashboard/preconstruction`, `/api/preconstruction/opportunities`,
  `/api/preconstruction/opportunities/[id]`, and the `bid_opportunities`
  table.
- Sidebar navigation no longer lists any unfinished workspace as "Coming Soon."
- The local test runner now ignores stale `node_modules-*` backup folders so CI
  does not accidentally execute third-party package tests.

## Verification completed

- `npm run typecheck`: passing.
- `npm run lint`: passing with 30 pre-existing warnings and 0 errors.
- `npm run build`: passing; production build includes the new Reports,
  Project Management, and Preconstruction routes.
- `npm run test:unit`: passing.
- `npm run test:integration`: passing.
- `npm audit --omit=dev`: 0 vulnerabilities.
- Supabase production project `vvnigrbdsipriufhrwbs` confirms RLS enabled on
  `report_runs` and `bid_opportunities`, each with service-role-only policies.
- `npm run launch:audit`: passing; verifies app-owned auth routes, Vercel
  linkage, and launch env presence from the repo.
- `npm run launch:smoke`: failing on the live Clerk auth surface until the
  external Clerk production config stops rendering `accounts.dev`.

## Required before paid launch

- Clerk must be switched from test keys to production keys in Vercel:
  `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, and the sign-in,
  sign-up, after-sign-in, and after-sign-up URLs.
- Paddle live billing must be configured in Vercel:
  `PADDLE_ENV=live`, `PADDLE_API_KEY`, `PADDLE_WEBHOOK_SECRET`,
  `PADDLE_PRICE_SOLO_MONTHLY`, `PADDLE_PRICE_SOLO_YEARLY`,
  `PADDLE_PRICE_CREW_MONTHLY`, `PADDLE_PRICE_CREW_YEARLY`,
  `PADDLE_PRICE_BUSINESS_MONTHLY`, and `PADDLE_PRICE_BUSINESS_YEARLY`.
- Paddle webhook replay must be verified against `/api/billing/webhook` for at
  least `subscription.created`, `subscription.updated`,
  `subscription.past_due`, and `subscription.canceled`.
- Marketing integrations need real production credentials if those channels
  are part of launch: Google Ads and Meta env vars are referenced by code but
  were not present in the local app env.
- A real browser QA pass is still required on production or preview for desktop,
  tablet, and mobile. Code/build tests are green, but they do not prove layout,
  auth redirects, checkout handoff, or interactive form behavior in Chrome.
- Legal/commercial docs must be finalized outside the codebase: Terms of
  Service, Privacy Policy, refund/cancellation policy, support contact, tax
  settings, and Paddle/Clerk production account ownership.
