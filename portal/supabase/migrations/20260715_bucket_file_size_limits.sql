-- Security advisor / audit finding: daily-log-photos and "Onyx Intel" had no
-- file_size_limit at all, unlike plans-bucket (200MB) and project-documents
-- (50MB). An uncapped bucket lets any authenticated caller upload arbitrarily
-- large objects, which is both a storage-cost and availability risk.
-- daily-log-photos: mobile site photos, capped generously at 25MB/file.
-- "Onyx Intel": not referenced by any app code (likely a legacy/setup
-- artifact) — capped to match project-documents' 50MB convention rather
-- than deleted, since it isn't confirmed dead.
update storage.buckets set file_size_limit = 26214400 where id = 'daily-log-photos';
update storage.buckets set file_size_limit = 52428800 where id = 'Onyx Intel';
