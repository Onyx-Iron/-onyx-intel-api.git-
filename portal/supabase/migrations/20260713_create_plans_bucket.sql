-- The "plans-bucket" storage bucket was referenced everywhere across the
-- takeoff/canvas pipeline this session (upload-url, from-document,
-- page-split-worker, page-processor, page-takeoff-worker) but was never
-- actually created — every upload attempt failed with Supabase Storage's
-- "The related resource does not exist" error since the bucket didn't exist.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'plans-bucket',
  'plans-bucket',
  false,
  209715200, -- 200 MB, matches upload-url/route.ts's own size validation cap
  array['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do nothing;
