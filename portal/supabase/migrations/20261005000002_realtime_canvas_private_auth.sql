-- Private Realtime authorization for canvas:{projectId}:{pageId} topics.
-- Policies evaluate the JWT minted by /api/takeoff/canvas/realtime-auth
-- (role=authenticated, org_id claim → public.current_tenant_id()).

CREATE OR REPLACE FUNCTION public.can_access_canvas_realtime_topic()
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  topic text := realtime.topic();
  parts text[];
  project_uuid uuid;
  page_uuid uuid;
  tenant uuid := public.current_tenant_id();
BEGIN
  IF tenant IS NULL OR topic IS NULL THEN
    RETURN false;
  END IF;

  parts := string_to_array(topic, ':');
  IF array_length(parts, 1) <> 3 OR parts[1] <> 'canvas' THEN
    RETURN false;
  END IF;

  BEGIN
    project_uuid := parts[2]::uuid;
    page_uuid := parts[3]::uuid;
  EXCEPTION WHEN others THEN
    RETURN false;
  END;

  RETURN EXISTS (
    SELECT 1
    FROM public.document_pages dp
    INNER JOIN public.documents d
      ON d.id = dp.document_id
     AND d.tenant_id = dp.tenant_id
    WHERE dp.id = page_uuid
      AND dp.tenant_id = tenant
      AND d.project_id = project_uuid
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.can_access_canvas_realtime_topic() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_access_canvas_realtime_topic() TO authenticated, service_role;

DROP POLICY IF EXISTS canvas_realtime_select ON realtime.messages;
CREATE POLICY canvas_realtime_select
  ON realtime.messages
  FOR SELECT
  TO authenticated
  USING (
    realtime.messages.extension IN ('broadcast', 'presence')
    AND public.can_access_canvas_realtime_topic()
  );

DROP POLICY IF EXISTS canvas_realtime_insert ON realtime.messages;
CREATE POLICY canvas_realtime_insert
  ON realtime.messages
  FOR INSERT
  TO authenticated
  WITH CHECK (
    realtime.messages.extension IN ('broadcast', 'presence')
    AND public.can_access_canvas_realtime_topic()
  );
