# Role Visibility Matrix

## Current model (`lib/project-controls/permissions.ts`)

7 roles: `Owner`, `Admin`, `Estimator`, `ProjectManager`, `FieldSuperintendent`, `Subcontractor`, `ClientView`.

3 gated resource categories: `financial`, `field`, `admin`. 2 actions: `read`, `write`.

```
canPerform(role, resource, action):
  if role in READ_ONLY_ROLES (ClientView) and action === "write": return false
  if resource === "financial": return WRITE_MATRIX.financial.has(role)   // read now mirrors write
  if action === "read": return true                                     // field/admin reads unchanged
  return WRITE_MATRIX[resource].has(role)
```

| Role | financial write | financial read | field write | field read | admin write | admin read |
|---|---|---|---|---|---|---|
| Owner | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Admin | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Estimator | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ |
| ProjectManager | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ |
| FieldSuperintendent | ❌ | ❌ | ✅ | ✅ | ❌ | ✅ |
| Subcontractor | ❌ | ❌ | ✅ | ✅ | ❌ | ✅ |
| ClientView | ❌ | ❌ | ❌ | ✅ | ❌ | ✅ |

## Gap closed (frontend-backend reconciliation, item 4)

**Fixed.** Financial *read* access now mirrors financial *write* access — only `Owner`/`Admin`/`Estimator`/`ProjectManager` can see cost, markup, profit, or invoice values at all. This is enforced server-side, in the API response body itself, not just hidden in the UI.

- `lib/project-controls/permissions.ts`: `canPerform` now gates `financial` reads the same as writes; added `canReadFinancial(role)` and `redactFinancialFields(rows, role, fields)` (nulls the named columns on every row when the caller's role can't read financial data).
- `lib/project-controls/financial-redaction.ts`: per-table field lists verified against the live schema — `ESTIMATE_FINANCIAL_FIELDS` (estimate_items: unit_cost, labor_cost, material_cost, equipment_cost, trucking_cost, subcontract_cost, disposal_cost, testing_cost, other_direct_cost, total_direct_cost, indirect_cost, contingency, overhead, profit, total_price, unit_price), `CHANGE_ORDER_FINANCIAL_FIELDS` (change_order_items: amount, labor_cost, material_cost, equipment_cost, subcontract_cost, markup), `INVOICE_FINANCIAL_FIELDS` (invoices: amount, retainage).
- Wired into `GET /api/estimate`, `GET /api/invoices`, `GET /api/change-orders` — each now resolves the caller's role and redacts before returning JSON.
- Proven live: `lib/project-controls/financial-redaction.integration.test.ts` (5/5 passing) inserts real rows in all three tables and asserts an `Owner` still receives the values while a `ClientView`/`Subcontractor` role receives `null` for every financial field and unredacted values for everything else.

### Remaining scope not covered in this pass (documented gap, not silently dropped)

Other financial-bearing endpoints were **not** touched in this pass and remain unredacted — flagged here for Phase 2/3 (Financials workspace) or a follow-up milestone before that workspace is presented as production-ready to restricted roles:

- `/api/estimate/versions/[id]/sov` (schedule of values — line-item pricing)
- `/api/cost-catalog*` (unit cost library)
- Procurement bid/PO amounts (`/api/procurement/*` — `vendor_bids.unit_price`, `purchase_orders.total_amount`)
- Any other route reading `estimate_items`/`invoices`/`change_order_items` besides the three GETs listed above (e.g. single-record `GET .../[id]` routes, if they exist)

Each of these should reuse `redactFinancialFields` + a new field-list constant in `financial-redaction.ts` rather than a bespoke check, once the workspace(s) exposing them are actually built.
