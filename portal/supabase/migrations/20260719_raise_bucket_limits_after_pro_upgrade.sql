-- Supabase org upgraded to Pro; project-wide Storage max-file-size raised to
-- 5GB (dashboard setting, confirmed by user). Bucket-level limits were
-- previously conservative to fit under the Free tier's 50MB global ceiling
-- (which forced large plan uploads through Google Drive instead — see
-- commit 94e3916). Raise them to sensible ceilings for real construction
-- plan sets now that the underlying constraint is gone.
update storage.buckets set file_size_limit = 1073741824 where id = 'plans-bucket'; -- 1GB (was 200MB)
update storage.buckets set file_size_limit = 209715200 where id = 'project-documents'; -- 200MB (was 50MB)
