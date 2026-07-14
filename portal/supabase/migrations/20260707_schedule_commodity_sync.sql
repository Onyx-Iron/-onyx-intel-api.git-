-- Monthly cron trigger for the sync-commodity-indexes edge function.
--
-- One-time manual step required before this fires successfully: store the
-- project's service-role key in Supabase Vault so the cron job can
-- authenticate to the function gateway without the key ever appearing in a
-- migration file or git history:
--
--   select vault.create_secret('<paste service_role key>', 'service_role_key');
--
-- Run that once from the Supabase SQL editor (not committed anywhere).
CREATE EXTENSION IF NOT EXISTS pg_cron;
-- pg_net is installed into `extensions`, matching every other non-platform-
-- managed extension in this schema (confirmed via production's
-- pg_extension.extnamespace) -- pg_net doesn't support ALTER EXTENSION ...
-- SET SCHEMA, so getting the schema right at creation time matters here.
CREATE EXTENSION IF NOT EXISTS pg_net SCHEMA extensions;

SELECT cron.schedule(
  'sync-commodity-indexes-monthly',
  '0 6 1 * *', -- 06:00 UTC on the 1st of every month
  $$
  SELECT net.http_post(
    url := 'https://vvnigrbdsipriufhrwbs.supabase.co/functions/v1/sync-commodity-indexes',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (
        SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key'
      )
    ),
    body := '{}'::jsonb
  ) AS request_id;
  $$
);
