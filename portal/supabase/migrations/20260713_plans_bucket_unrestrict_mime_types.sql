-- Match every other bucket's pattern (all have allowed_mime_types = null).
-- plans-bucket was created with a PDF/image-only restriction, but the
-- takeoff pipeline also accepts .dwg/.dxf/.ifc/.xlsx/.xls, which browsers
-- send with inconsistent or generic MIME types (often
-- application/octet-stream) — the restriction would have silently
-- rejected those uploads at the storage PUT step.
update storage.buckets set allowed_mime_types = null where id = 'plans-bucket';
