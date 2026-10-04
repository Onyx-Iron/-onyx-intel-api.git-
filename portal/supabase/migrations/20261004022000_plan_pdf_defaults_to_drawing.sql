-- Plan PDFs were inserted with a null class. Takeoff then refused
-- quantities because only an explicit "drawing" was allowed.

CREATE OR REPLACE FUNCTION public.documents_default_plan_doc_type()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.doc_type IS NULL AND NEW.file_name ~* '\.(pdf|dwg|dxf)$' THEN
    NEW.doc_type := 'drawing';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS documents_default_plan_doc_type ON public.documents;
CREATE TRIGGER documents_default_plan_doc_type
  BEFORE INSERT ON public.documents
  FOR EACH ROW
  EXECUTE FUNCTION public.documents_default_plan_doc_type();

UPDATE public.documents
SET doc_type = 'drawing'
WHERE doc_type IS NULL
  AND file_name ~* '\.(pdf|dwg|dxf)$';
