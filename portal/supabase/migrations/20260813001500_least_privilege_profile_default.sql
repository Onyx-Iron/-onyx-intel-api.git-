-- Missing operational-role assignments must never silently grant estimating
-- or financial authority. Application bootstrap maps personal owners and
-- Clerk organization admins explicitly; every other new profile starts read-only.

alter table public.project_profiles
  alter column role set default 'ClientView';
