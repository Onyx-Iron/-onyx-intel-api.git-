# Onyx Intel — Data ingestion scripts

These scripts feed the construction cost catalog backing
`enhanced_takeoff_system.CostDatabase` (Supabase mode). Each one fetches a
public dataset, transforms it into the portal's ingest payload shape, and
POSTs it to a `/api/cost-catalog/ingest/*` endpoint.

The catalog is then resolved at takeoff time via
`cost_supabase.resolve_unit_cost(csi_code, tenant_id, zip, state)`.

## Scripts

### `seed_from_oce.py`
**Run first, once, manually.** Seeds the catalog with 50 hand-curated items
spanning CSI Divisions 03, 04, 05, 06, 09, 22, 23, and 26. Inspired by
OpenConstructionERP's regional cost catalogues. Pure embedded data — no
external fetch — so it's safe to run anytime to re-establish a baseline.

```bash
python scripts/seed_from_oce.py
python scripts/seed_from_oce.py --dry-run   # preview without POST
```

### `fetch_bls_ppi.py`
**Run weekly (cron).** Pulls the U.S. Bureau of Labor Statistics Producer
Price Index for 20 construction-relevant commodity series (lumber, concrete,
steel, copper, asphalt, drywall, ...). These are *trend signals*, not absolute
unit prices — the portal uses them to age the catalog forward between
manual refreshes.

```bash
python scripts/fetch_bls_ppi.py
python scripts/fetch_bls_ppi.py --series WPU0811 WPU101 --start-year 2024
python scripts/fetch_bls_ppi.py --dry-run
```

BLS endpoint: `https://api.bls.gov/publicAPI/v2/timeseries/data/`
Free tier: 25 series/day. Registered (free) key: 500 series/day.

### `fetch_dot_tx.py`
**Run monthly (cron) — currently a stub.** TxDOT publishes bid tabulations
for every state highway letting (project bid summary, item-level, with all
bidders' unit prices). Public domain, geographically tagged. This is the
single best source for sitework / civil cost calibration in Texas.

```bash
python scripts/fetch_dot_tx.py --sample      # POST embedded sample
python scripts/fetch_dot_tx.py --dry-run
```

The `--file` flag is reserved for the eventual PDF/CSV parser
(`parse_tx_bid_tab` is currently `NotImplementedError`).

Source: <https://www.txdot.gov/business/let-bids/bid-tab-archive.html>

### `fetch_dot_ca.py`
**Run monthly (cron) — currently a stub.** Caltrans equivalent of the TxDOT
script. Anchors our US_WEST cost-region multiplier.

```bash
python scripts/fetch_dot_ca.py --sample
```

Source: <https://dot.ca.gov/programs/design/contract-standards/contract-cost-data>

## Environment variables

| Var | Used by | Notes |
|---|---|---|
| `ONYX_PORTAL_URL` | all | Base URL of the Onyx Intel portal (default `http://localhost:3000`) |
| `ONYX_INGEST_TOKEN` | all | Bearer token for the ingest endpoints (provisioned in portal admin) |
| `SUPABASE_URL` | `cost_supabase` | Set in Railway env |
| `SUPABASE_SERVICE_KEY` | `cost_supabase` | Service-role key, **never** ship to client |
| `BLS_API_KEY` | `fetch_bls_ppi` | Optional, free — register at <https://data.bls.gov/registrationEngine/> |

## Cron suggestions (Railway / GitHub Actions)

```yaml
# .github/workflows/cost-catalog-refresh.yml (sketch)
on:
  schedule:
    - cron: "0 6 * * 1"           # Mon 06:00 UTC — BLS weekly
    - cron: "0 6 1 * *"           # 1st of month — DOT bid tabs
jobs:
  bls:
    if: github.event.schedule == '0 6 * * 1'
    steps:
      - run: python scripts/fetch_bls_ppi.py
  dot:
    if: github.event.schedule == '0 6 1 * *'
    steps:
      - run: python scripts/fetch_dot_tx.py --sample
      - run: python scripts/fetch_dot_ca.py --sample
```

## Data-engineering TODO

1. **TxDOT / Caltrans parsers** — `parse_tx_bid_tab()` and
   `parse_ca_bid_summary()` are stubs. The real work is pulling the bid-tab
   PDFs/CSVs (pdfplumber/camelot) and mapping DOT item codes → CSI
   MasterFormat. Maintain a `dot_item_to_csi.csv` lookup checked into the
   repo.
2. **OpenConstructionERP full import** — `seed_from_oce.py` ships embedded
   sample data. Long-term: clone the OCE repo in CI, walk
   `seed/cost_catalogues/*.json`, dedupe against BLS/DOT.
3. **Regional multipliers** — current US_EAST/WEST/SOUTH/MIDWEST split is
   crude. Replace with ENR Construction Cost Index (CCI) by metro.
4. **Confidence scoring** — the resolver returns `confidence` but the upstream
   data sources don't yet contribute weighted scores. Wire that in once we
   have ≥3 sources per CSI code.
5. **Time-decay** — items older than 18 months should be tagged stale; the
   portal already has the column, the scripts don't yet flag it.
6. **RSMeans** — not free, but if we license it, this folder is where the
   importer lives.
