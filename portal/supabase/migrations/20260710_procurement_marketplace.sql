-- Procurement Marketplace: package estimate line items into RFQs, collect
-- vendor bids (including from unauthenticated public vendor links), and
-- issue locked purchase orders on approval.
--
-- `batch_id` groups multiple marketplace_requests created together from one
-- "Quote Packaging" wizard run (one row per bundled estimate item) so the
-- dashboard can render them as a single RFQ with multiple line items.
CREATE TABLE IF NOT EXISTS public.marketplace_requests (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL,
  project_id       uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  batch_id         uuid NOT NULL DEFAULT gen_random_uuid(),
  batch_label      text,
  source_estimate_id uuid,
  item_description text NOT NULL,
  quantity         numeric NOT NULL,
  unit             text,
  required_date    date,
  status           text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'awarded', 'cancelled')),
  created_by       text,
  created_at       timestamptz DEFAULT now(),
  updated_at       timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_marketplace_requests_project ON public.marketplace_requests(project_id, batch_id);
CREATE INDEX IF NOT EXISTS idx_marketplace_requests_tenant  ON public.marketplace_requests(tenant_id);

-- Vendor bids are written by unauthenticated public submissions (via the
-- request's own uuid as a capability link — same trust model as e.g. a
-- Calendly/Stripe link) as well as by tenant staff. `tenant_id` is
-- denormalized from the parent request so RLS can scope it without a join.
CREATE TABLE IF NOT EXISTS public.vendor_bids (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL,
  request_id       uuid NOT NULL REFERENCES public.marketplace_requests(id) ON DELETE CASCADE,
  vendor_name      text NOT NULL,
  contact_email    text NOT NULL,
  unit_price       numeric NOT NULL,
  lead_time_days   integer,
  notes            text,
  status           text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'awarded', 'declined')),
  submitted_at     timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_vendor_bids_request ON public.vendor_bids(request_id);
CREATE INDEX IF NOT EXISTS idx_vendor_bids_tenant  ON public.vendor_bids(tenant_id);

CREATE TABLE IF NOT EXISTS public.purchase_orders (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL,
  project_id       uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  vendor_bid_id    uuid NOT NULL REFERENCES public.vendor_bids(id),
  po_number        serial,
  total_amount     numeric NOT NULL,
  terms            text,
  status           text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'issued', 'closed')),
  email_sent_at    timestamptz,
  created_by       text,
  created_at       timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_project ON public.purchase_orders(project_id);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_tenant  ON public.purchase_orders(tenant_id);

ALTER TABLE public.marketplace_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketplace_requests FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_select ON public.marketplace_requests;
CREATE POLICY tenant_isolation_select ON public.marketplace_requests FOR SELECT USING (tenant_id = public.current_tenant_id());

ALTER TABLE public.vendor_bids ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vendor_bids FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_select ON public.vendor_bids;
CREATE POLICY tenant_isolation_select ON public.vendor_bids FOR SELECT USING (tenant_id = public.current_tenant_id());

ALTER TABLE public.purchase_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_orders FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_select ON public.purchase_orders;
CREATE POLICY tenant_isolation_select ON public.purchase_orders FOR SELECT USING (tenant_id = public.current_tenant_id());

-- No INSERT/UPDATE/DELETE policies on any of the three: the app's public
-- (unauthenticated vendor) writes and its tenant-scoped writes both go
-- through the service-role backend, which validates everything in code
-- (request must be `status='open'`, ids must exist, etc) before writing.
-- RLS here exists to block direct anon/authenticated-role reads and writes
-- outside the app, consistent with the rest of the schema's RLS posture.
