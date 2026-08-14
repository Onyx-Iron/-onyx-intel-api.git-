-- Explicit deny policy keeps the private delivery ledger invisible through the
-- Data API and satisfies the database advisor's policy-presence check.
DROP POLICY IF EXISTS billing_webhook_events_deny_clients ON public.billing_webhook_events;
CREATE POLICY billing_webhook_events_deny_clients ON public.billing_webhook_events
  FOR ALL TO anon, authenticated
  USING (false)
  WITH CHECK (false);
