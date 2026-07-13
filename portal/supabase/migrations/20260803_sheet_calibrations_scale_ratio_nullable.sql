-- New calibrations are page-space-relative (page_space_scale_factor) and no
-- longer populate the legacy render-pixel scale_ratio at all — the server
-- has no reliable way to know what render scale was active client-side, and
-- fabricating one would reintroduce exactly the bug this milestone fixes.
-- Existing legacy rows keep their scale_ratio value untouched.
alter table sheet_calibrations alter column scale_ratio drop not null;
