CREATE TABLE IF NOT EXISTS public.billing_webhook_events (
  event_id text PRIMARY KEY,
  event_type text NOT NULL,
  status text NOT NULL DEFAULT 'processing' CHECK (status IN ('processing', 'processed', 'failed')),
  attempts integer NOT NULL DEFAULT 1 CHECK (attempts > 0),
  last_error text,
  occurred_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_billing_webhook_events_status_updated
  ON public.billing_webhook_events(status, updated_at);

ALTER TABLE public.billing_webhook_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_webhook_events FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.billing_webhook_events FROM anon;
REVOKE ALL ON TABLE public.billing_webhook_events FROM authenticated;
GRANT ALL ON TABLE public.billing_webhook_events TO service_role;
