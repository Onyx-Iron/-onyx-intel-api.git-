-- Critical bug fix: takeoff_items.type had a CHECK constraint left over from
-- the manual Sheet Canvas drawing tools (length/area/perim/count/volume),
-- but every document-extraction save path (Takeoff tab, async page-split
-- pipeline, AI vision fallback) inserts type: 'takeoff_import' or 'general'.
-- Every extraction save has been silently rejected by Postgres since this
-- feature was built — confirmed live: takeoff_items had zero rows across
-- all tenants. The extracted-rows table in the UI comes from local browser
-- state, so it kept rendering correctly even though nothing ever saved.
ALTER TABLE public.takeoff_items DROP CONSTRAINT takeoff_items_type_check;
ALTER TABLE public.takeoff_items ADD CONSTRAINT takeoff_items_type_check
  CHECK (type = ANY (ARRAY['length','area','perim','count','volume','takeoff_import','general']));
