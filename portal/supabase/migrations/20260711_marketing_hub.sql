-- Marketing Command Center: ad campaign tracking + inbound lead capture.
-- `company_id` maps 1:1 to `tenants.id` — there's no separate companies
-- table in this schema, and "company" here is the same concept as "tenant"
-- (one workspace = one contracting company).
CREATE TABLE IF NOT EXISTS public.marketing_campaigns (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL,
  company_id    uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  project_id    uuid REFERENCES public.projects(id) ON DELETE SET NULL,
  platform      text NOT NULL CHECK (platform IN ('google_ads', 'meta')),
  campaign_name text NOT NULL,
  budget_daily  numeric NOT NULL DEFAULT 0,
  clicks        integer NOT NULL DEFAULT 0,
  spend_total   numeric NOT NULL DEFAULT 0,
  status        text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'launching', 'active', 'paused', 'failed', 'ended')),
  external_campaign_id text,     -- id returned by Google Ads / Meta once launched
  creative       jsonb,          -- { image_urls[], copy, radius_miles, lat, lng }
  last_synced_at timestamptz,
  created_by     text,
  created_at     timestamptz DEFAULT now(),
  updated_at     timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_marketing_campaigns_tenant  ON public.marketing_campaigns(tenant_id);
CREATE INDEX IF NOT EXISTS idx_marketing_campaigns_project ON public.marketing_campaigns(project_id);

CREATE TABLE IF NOT EXISTS public.marketing_leads (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL,
  project_id      uuid REFERENCES public.projects(id) ON DELETE SET NULL,
  campaign_id     uuid REFERENCES public.marketing_campaigns(id) ON DELETE SET NULL,
  source          text,               -- "google_ads" | "meta" | "organic" | "referral"
  contact_name    text,
  contact_phone   text,
  contact_email   text,
  request_details text,
  created_at      timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_marketing_leads_tenant  ON public.marketing_leads(tenant_id);
CREATE INDEX IF NOT EXISTS idx_marketing_leads_project ON public.marketing_leads(project_id);
CREATE INDEX IF NOT EXISTS idx_marketing_leads_campaign ON public.marketing_leads(campaign_id);

ALTER TABLE public.marketing_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketing_campaigns FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_select ON public.marketing_campaigns;
CREATE POLICY tenant_isolation_select ON public.marketing_campaigns FOR SELECT USING (tenant_id = public.current_tenant_id());

ALTER TABLE public.marketing_leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketing_leads FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_select ON public.marketing_leads;
CREATE POLICY tenant_isolation_select ON public.marketing_leads FOR SELECT USING (tenant_id = public.current_tenant_id());
