<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Local development

Two processes make up a working environment:

- `portal/` is the Next.js 16 app. From that directory: `npm ci`, then `npm run dev -- --hostname 0.0.0.0 --port 3000`. Checks: `npm run lint`, `npm run typecheck`, and `npm run test:unit`.
- The Python takeoff API lives at the repo root (`takeoff_api.py`, Python 3.12). Install with `python3 -m pip install --user -r requirements.txt`, then run `python3 -m uvicorn takeoff_api:app --host 0.0.0.0 --port 5050`. Tests: `python3 -m unittest test_takeoff_extract.py`.

Cloud Agents start both on boot. The portal calls the takeoff API at `http://127.0.0.1:5050`. Set `NEXT_PUBLIC_APP_URL=http://localhost:3000` so Clerk sign-in and sign-up stay on the local origin; the code otherwise falls back to `https://app.onyx-iron.com`.

Without Clerk keys, `next dev` uses Clerk keyless mode and writes secrets under `portal/.clerk/` (gitignored). Signed-in project data needs Supabase: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` or `SUPABASE_SERVICE_KEY`. Use an isolated project, not production.
