# Service Dependency Map

## Services and responsibilities

| Service | Responsibility | Evidence |
|---|---|---|
| **Vercel** | Hosts `portal/` (Next.js 16). Runs all API routes, SSR/RSC pages, middleware (`portal/proxy.ts`). Fluid Compute and the estimate-sync cron live in `portal/vercel.json`. | `.vercel/project.json` (root + `portal/`), `portal/vercel.json` |
| **Railway** | Hosts the Python FastAPI takeoff/estimating engine (`takeoff_api.py`). Deterministic CSI classification, PDF/DXF/IFC/XLSX quantity extraction, AI-vision fallback. | `Procfile:1`, `nixpacks.toml:1-8` |
| **Supabase Postgres** | Sole system of record: tenants, projects, documents, takeoff_items, estimate_items, cost catalog, contacts/companies, RFIs/submittals/change-orders, audit_logs — 76 tables total. | `portal/supabase/migrations/` |
| **Supabase Storage** | `plans-bucket` (plan PDFs), `project-documents`, others — created via migration (`20260713_create_plans_bucket.sql`) | Edge Function references, e.g. `page-processor/index.ts:30` |
| **Supabase Edge Functions** | 4 functions, see below | `portal/supabase/functions/` |
| **Clerk** | Authentication only. No middleware.ts — gating done per-route via `portal/proxy.ts` (`clerkMiddleware` + `auth.protect()`). | `portal/proxy.ts` |
| **AI providers** | Gemini (primary), OpenAI, Anthropic — provider-selection logic in `lib/ai/providers.ts` | — |

## Edge Functions

| Function | Purpose |
|---|---|
| `page-processor` | Downloads one split PDF page, OCRs via Gemini, chunks + embeds text (`text-embedding-004`), writes `document_chunks` for document Q&A/search. Real retry (`fetchWithRetry`, exponential backoff, 3 attempts) on Gemini + embed calls. |
| `page-split-worker` | Splits an uploaded multi-page PDF into per-page PDFs, inserts `document_pages`, fans out each page to `page-processor` and `page-takeoff-worker` (fire-and-forget via `Promise.allSettled`, individual failures swallowed). |
| `page-takeoff-worker` | Sends each split page to Railway's `/api/takeoff/extract`, inserts `takeoff_items`, then syncs into `estimate_items` — logic duplicated from `lib/estimating/auto-sync.ts` (Deno can't import the Next.js module; file's own comment at lines 78-82 flags this as a maintenance-drift risk). |
| `sync-commodity-indexes` | Monthly `pg_cron` job. Pulls BLS Producer Price Index data, updates `commodity_trend_series`, and is *intended* to auto-escalate `cost_overrides` — see DATABASE_AUDIT.md and DEFECT_REGISTER.md for why this has no effect on what estimators see. |

## Cross-service call graph

```
Browser
  │
  ▼
Vercel (Next.js API routes) ──auth──▶ Clerk
  │
  ├──service-role──▶ Supabase Postgres (91/121 routes; RLS bypassed — see AUTHORIZATION_AUDIT.md)
  │
  ├──X-Onyx-Secret──▶ Railway (Python takeoff engine)
  │                     via lib/python-api.ts's pythonApiHeaders()
  │
  └──API key──▶ Gemini / OpenAI / Anthropic

Supabase Edge Functions
  page-split-worker ──fire-and-forget──▶ page-processor
                     ──fire-and-forget──▶ page-takeoff-worker
  page-takeoff-worker ──X-Onyx-Secret──▶ Railway (/api/takeoff/extract)
  page-takeoff-worker ──direct write──▶ estimate_items (duplicated sync logic)
  sync-commodity-indexes ──pg_cron──▶ BLS API, commodity_trend_series

No Edge Function calls back into the Vercel/Next.js app.
```

## Hard dependency / failure-mode analysis

| Dependency down/missing | Effect |
|---|---|
| Railway unreachable | `page-takeoff-worker` catches and marks the page `takeoff_status: "error"` — degrades per-page, doesn't crash the async pipeline. But the **synchronous** `/api/takeoff/extract` and `/api/takeoff/from-document` routes have no explicit fallback for a connection failure — user-facing manual takeoff extraction breaks entirely unless the user explicitly uses `ai_fallback=true` (which bypasses Railway via direct Gemini/Anthropic vision calls). |
| `ONYX_API_SECRET` missing | `pythonApiHeaders()` silently sends an empty `X-Onyx-Secret` header (`lib/python-api.ts:33`, `\|\| ""` fallback) — Railway then rejects with 401 (per `takeoff_api.py:53`'s own secret check). Not a Next.js-side crash, but a silent-until-401 failure mode with no upstream validation that the secret is actually configured. |
| `PYTHON_API_URL` missing (Next.js side) | Falls back to `"http://localhost:5050"` (`route.ts:8`) — **silently tries to hit localhost in production**, connection refused, request fails with a generic network error, not a clear "misconfigured" message. |
| `PYTHON_API_URL` missing (Edge Function side) | **Hard, visible failure** — `page-takeoff-worker/index.ts:214` explicitly throws `"PYTHON_API_URL is not configured for this function"`. Inconsistent with the Next.js-side silent-localhost-fallback behavior for the same variable. |
| `GEMINI_API_KEY` / `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` all missing | Clean, typed failure: `resolveProvider()` returns `null`, `generateText()` throws `NoProviderError` — no silent no-op. |
| `SUPABASE_SERVICE_ROLE_KEY` missing (Edge Functions) | Non-null assertion (`Deno.env.get(...)!`) — `createClient(undefined, ...)` throws or produces a broken client at cold start, no graceful fallback. |
| `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` missing | Non-null assertion in `lib/supabase/server.ts:8-9` — throws "supabaseUrl is required" at first client creation. |

See `ENVIRONMENT_VARIABLE_MAP.md` for the full variable-by-variable table.
