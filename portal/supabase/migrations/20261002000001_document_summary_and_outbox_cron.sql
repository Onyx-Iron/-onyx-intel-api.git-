-- Roll page-level OCR/takeoff failures up onto the parent document, and
-- sweep the estimate sync outbox once a minute.
--
-- One-time Vault step before the cron call succeeds (do not commit the secret):
--
--   select vault.create_secret('<INTERNAL_WORKER_SECRET value>', 'internal_worker_secret');
--
-- The job posts to https://app.onyx-iron.com/api/internal/outbox/process
-- with header x-worker-secret, matching app/api/internal/outbox/process.

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net SCHEMA extensions;

CREATE OR REPLACE FUNCTION public.refresh_document_processing_summary(p_document_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total int := 0;
  v_ocr_done int := 0;
  v_ocr_error int := 0;
  v_takeoff_done int := 0;
  v_takeoff_error int := 0;
  v_summary jsonb;
  v_takeoff_status text;
  v_ocr_status text;
BEGIN
  SELECT
    count(*),
    count(*) FILTER (WHERE status = 'done'),
    count(*) FILTER (WHERE status = 'error'),
    count(*) FILTER (WHERE takeoff_status = 'done'),
    count(*) FILTER (WHERE takeoff_status = 'error')
  INTO v_total, v_ocr_done, v_ocr_error, v_takeoff_done, v_takeoff_error
  FROM document_pages
  WHERE document_id = p_document_id;

  v_summary := jsonb_build_object(
    'pages_total', v_total,
    'pages_ocr_ok', v_ocr_done,
    'pages_ocr_failed', v_ocr_error,
    'pages_takeoff_ok', v_takeoff_done,
    'pages_takeoff_failed', v_takeoff_error,
    'updated_at', now()
  );

  v_takeoff_status := CASE
    WHEN v_total = 0 THEN 'pending'
    WHEN v_takeoff_error > 0 THEN 'partially_completed'
    WHEN v_takeoff_done = v_total THEN 'done'
    ELSE 'processing'
  END;

  v_ocr_status := CASE
    WHEN v_total = 0 THEN 'pending'
    WHEN v_ocr_error > 0 AND v_ocr_done > 0 THEN 'partially_completed'
    WHEN v_ocr_error > 0 THEN 'error'
    WHEN v_ocr_done = v_total THEN 'done'
    ELSE 'processing'
  END;

  UPDATE documents
  SET
    meta = jsonb_set(coalesce(meta, '{}'::jsonb), '{processing_summary}', v_summary, true),
    takeoff_status = v_takeoff_status,
    ocr_status = v_ocr_status,
    page_count = CASE WHEN v_total > 0 THEN v_total ELSE page_count END,
    last_error = CASE
      WHEN v_takeoff_error > 0 OR v_ocr_error > 0 THEN
        format('%s page(s) failed takeoff, %s page(s) failed OCR', v_takeoff_error, v_ocr_error)
      WHEN last_error_step IN ('takeoff', 'ocr') THEN NULL
      ELSE last_error
    END,
    last_error_step = CASE
      WHEN v_takeoff_error > 0 THEN 'takeoff'
      WHEN v_ocr_error > 0 THEN 'ocr'
      WHEN last_error_step IN ('takeoff', 'ocr') THEN NULL
      ELSE last_error_step
    END
  WHERE id = p_document_id;

  RETURN v_summary;
END;
$$;

REVOKE ALL ON FUNCTION public.refresh_document_processing_summary(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.refresh_document_processing_summary(uuid) TO service_role;

DO $$
BEGIN
  PERFORM cron.unschedule('estimate-sync-outbox-minutely');
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

SELECT cron.schedule(
  'estimate-sync-outbox-minutely',
  '* * * * *',
  $$
  SELECT net.http_post(
    url := 'https://app.onyx-iron.com/api/internal/outbox/process',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-worker-secret', (
        SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'internal_worker_secret'
      )
    ),
    body := '{"batch_size":20}'::jsonb
  ) AS request_id;
  $$
);
