-- documents.id and document_pages.document_id are text. The previous
-- refresh function took uuid, so every page-processor rollup failed and
-- the parent kept a stale "failed OCR" count after the page itself was done.

DROP FUNCTION IF EXISTS public.refresh_document_processing_summary(uuid);

CREATE OR REPLACE FUNCTION public.refresh_document_processing_summary(p_document_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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
    WHEN v_takeoff_error > 0 AND v_takeoff_done = 0 THEN 'error'
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
    meta = jsonb_set(
      coalesce(meta, '{}'::jsonb),
      '{processing_summary}',
      coalesce(meta->'processing_summary', '{}'::jsonb) || v_summary,
      true
    ),
    takeoff_status = v_takeoff_status,
    ocr_status = v_ocr_status,
    page_count = CASE WHEN v_total > 0 THEN v_total ELSE page_count END,
    last_error = CASE
      WHEN v_ocr_error > 0 THEN format('%s of %s page(s) failed OCR', v_ocr_error, v_total)
        || CASE WHEN v_takeoff_error > 0 THEN format('; %s page(s) failed takeoff', v_takeoff_error) ELSE '' END
      WHEN v_takeoff_error > 0 THEN format('%s page(s) failed takeoff', v_takeoff_error)
      WHEN last_error_step IN ('takeoff', 'ocr') THEN NULL
      ELSE last_error
    END,
    last_error_step = CASE
      WHEN v_ocr_error > 0 THEN 'ocr'
      WHEN v_takeoff_error > 0 THEN 'takeoff'
      WHEN last_error_step IN ('takeoff', 'ocr') THEN NULL
      ELSE last_error_step
    END,
    status = CASE
      WHEN v_ocr_error = 0 AND v_takeoff_error = 0 AND status IN ('failed', 'complete_with_errors') AND last_error_step IN ('ocr', 'takeoff') THEN 'complete'
      WHEN v_ocr_error = 0 AND v_takeoff_error > 0 AND status = 'failed' THEN 'complete_with_errors'
      ELSE status
    END
  WHERE id = p_document_id;

  RETURN v_summary;
END;
$function$;

REVOKE ALL ON FUNCTION public.refresh_document_processing_summary(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.refresh_document_processing_summary(text) TO service_role;
