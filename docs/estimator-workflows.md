# Estimator performance & workflow upgrades

## 1. UNLOGGED outbox staging
- Table: `estimate_sync_outbox_staging` (**UNLOGGED** — skips WAL on the hot path)
- Durable sink: `estimate_sync_outbox` (unchanged, crash-safe)
- RPCs: `enqueue_outbox_staging`, `promote_outbox_staging`
- Worker: `processOutboxBatch` promotes staging before claiming

## 2. Brotli / gzip + HTTP compression
- FastAPI: `BrotliGzipMiddleware` (Accept-Encoding negotiation)
- Next.js: `compress: true` + `Vary: Accept-Encoding` on `/api/*`
- HTTP/2 multiplexing is terminated at Railway / Vercel edge (not app-level)

## 3. Vision OCR token cap
- Canvas `vision-extract` + takeoff AI fallback: `maxOutputTokens` / `max_tokens: 300`, `temperature: 0`
- Prompt: “Output RAW JSON matching schema only”

## 4. Auto-assembly recipes
- Seed recipes: `utility_pipe_lf`, `concrete_wall_lf`
- API: `GET/POST /api/estimate/assemblies/expand`
- Formula evaluator: `lib/estimating/assembly-recipes.ts`

## 5. Live Excel formulas
- Client: EstimateMatrix XLSX export writes `cell.f` formulas
- Server: `POST /api/v1/estimate/export-xlsx` (openpyxl)

## 6. Bid omission & risk scanner
- `lib/agents/bid-omission-scanner.ts` + `POST /api/estimate/bid-omission-scan`
- CSI companion rules (+ optional `match_chunks` RAG)
- Drafts RFIs into `ai_agent_audit_trails` for human approval
