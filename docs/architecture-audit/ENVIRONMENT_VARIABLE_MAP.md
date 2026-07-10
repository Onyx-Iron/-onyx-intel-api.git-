# Environment Variable Map

No secret values are reproduced below — variable names and code behavior only.

## Critical finding: `.env.example` is drastically out of date

The repo-root `.env.example` (18 lines) documents only 5 variables: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` (both commented-out/optional), `VISION_MIN_CHARS`, `RENDER_SCALE`, `PORT`. None of these last three appear anywhere in a grep sweep of the current `portal/` or `takeoff_api.py` code — they look like leftovers from an earlier, simpler prototype. **Every operationally-critical variable actually used today is undocumented**, including Clerk, Supabase, Railway/Onyx secrets, all AI provider keys, Google OAuth, Paddle billing, and marketing ad-platform credentials.

## Next.js / Node (`process.env.*`)

| Variable | Client/Server | Required? | Fallback | Missing-value behavior |
|---|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Client | Yes | none (`!` assertion) | Throws "supabaseUrl is required" at client creation |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Client | Yes | none (`!` assertion) | Same — throws at client creation |
| `SUPABASE_SERVICE_ROLE_KEY` / `SUPABASE_SERVICE_KEY` | Server | Yes | fallback pair (`\|\|` chained) | If both unset, non-null-asserted `undefined` passed to Supabase client — breaks at first DB call |
| `SUPABASE_URL` (non-public variant) | Server | Yes (Python/Edge Fn side) | fallback pair with `NEXT_PUBLIC_SUPABASE_URL` in 2 Next.js routes; **no fallback** in Edge Functions | Edge Functions: throws/breaks at cold start |
| `ONYX_INTERNAL_KEY` | Server | No | excluded from valid-token list if unset | That auth path just never matches (service-to-service callback auth) |
| `PYTHON_API_URL` | Server | Yes (functionally) | `"http://localhost:5050"` (Next.js side, silent); **hard throw** (Edge Function side) | **Inconsistent behavior for the same variable across the two call sites** — silently wrong in prod on the Next.js side, loudly broken on the Edge Function side |
| `ONYX_API_SECRET` | Server | Yes (functionally) | `""` | Silently sends empty secret header; Railway 401s downstream |
| `RATE_LIMIT_ADMIN_SECRET` | Server | No | falls back to `ONYX_API_SECRET` if unset | Admin bypass silently unavailable, admin treated as regular rate-limited user |
| `GEMINI_API_KEY` | Server | No (multi-provider) | none | Excluded from `availableProviders()`; if it's the only key configured, all AI features fail via typed `NoProviderError` |
| `GEMINI_MODEL` | Server | No | `"gemini-2.5-pro"` | Uses default |
| `GEMINI_EXTRACT_MODEL`, `GEMINI_VISION_MODEL`, `GEMINI_DIGEST_MODEL` | Server | No | fallback chains (often `?? GEMINI_MODEL`) | Uses default/fallback model |
| `OPENAI_API_KEY` / `OPENAI_MODEL` | Server | No | none / `"gpt-4o"` | Excluded from providers / default model |
| `ANTHROPIC_API_KEY` / `ANTHROPIC_MODEL` | Server | No | none / `"claude-sonnet-4-6"` | Excluded from providers / default model |
| `TAKEOFF_AI_MODEL` | Server | No | `"claude-sonnet-4-6"` | Uses default |
| `AI_DEFAULT_PROVIDER` | Server | No | first available in `[gemini, openai, anthropic]` order | Falls through preference order |
| `NEXT_PUBLIC_GOOGLE_CLIENT_ID`, `NEXT_PUBLIC_GOOGLE_API_KEY` | Client | No | none | Google Drive/OAuth features silently fail to initialize |
| `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` | Server | Yes (for Google features) | none | OAuth token exchange / redirect fails |
| `PADDLE_API_KEY`, `PADDLE_WEBHOOK_SECRET`, `PADDLE_ENV` | Server | Yes (for billing) | not fully traced | Billing calls fail downstream if absent |
| `PADDLE_PRICE_{SOLO,CREW,BUSINESS}_{MONTHLY,YEARLY}` (6 vars) | Server | No | fallback pattern in `lib/billing/plans.ts` | Plan lookup returns undefined price ID; checkout errors downstream |
| `GOOGLE_ADS_*` (5 vars), `META_ACCESS_TOKEN`, `META_AD_ACCOUNT_ID` | Server | No | none | Ad-platform sync degrades/disabled if unset |
| `NODE_ENV` | Server | Standard | Node built-in | Standard behavior |

## Deno Edge Functions (`Deno.env.get(...)`)

| Variable | Fallback | Missing-value behavior |
|---|---|---|
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | none (`!`) | Client creation throws/breaks at cold start — every function |
| `GEMINI_API_KEY` | none (`!`) | Gemini calls 401/fail |
| `PLANS_BUCKET` | `"plans-bucket"` | Uses default bucket name |
| `GEMINI_TEXT_MODEL` / `GEMINI_EMBED_MODEL` | `"gemini-2.5-pro"` / `"text-embedding-004"` | Uses defaults |
| `PYTHON_API_URL` | `""` then explicit check | **Hard throw**: `"PYTHON_API_URL is not configured for this function"` |
| `ONYX_API_SECRET` | `""` | Silently sends empty secret; Railway rejects |
| `BLS_API_KEY` | optional, conditionally added to request | Works at a lower BLS rate limit (documented as sufficient for the 4 tracked series) |

## Python service (`os.getenv`)

| Variable | Fallback | Behavior if missing |
|---|---|---|
| `ALLOWED_ORIGINS` | `"https://app.onyx-iron.com,http://localhost:3000"` | CORS restricted to default list |
| `API_SECRET` | `None` | Downstream secret-check behavior not fully traced this pass |
| `TAKEOFF_BASE_DIR` | OS tempdir + `/onyx_takeoffs` | Uses system temp dir |
| `RATE_LIMIT_ADMIN_SECRET` | `""` | Admin bypass unavailable |
| `PORT` | `"5050"` | Railway always sets `$PORT`, so only matters locally |
| `RATE_LIMIT_ENABLED` / `RATE_LIMIT_REQUESTS_PER_MIN` / `RATE_LIMIT_UPLOAD_MB_PER_HOUR` | `"true"` / `"10"` / `"500"` | Uses defaults |
| `ONYX_PORTAL_URL` | falls through to `NEXT_PUBLIC_SITE_URL` | Uses secondary fallback |
| `NEXT_PUBLIC_SITE_URL` | `"http://localhost:3000"` | **Silently points to localhost if both unset — production misconfiguration risk** |
| `GOOGLE_CREDENTIALS_JSON` | `""` | Google integration disabled if unset |

## Security note

No variable name inspected here exposes a secret value. `RATE_LIMIT_ADMIN_SECRET`/`ONYX_API_SECRET` are used only server-side (Next.js API routes and Edge Functions) and are never sent to the browser — confirmed via `lib/python-api.ts`'s doc comments and call sites.
