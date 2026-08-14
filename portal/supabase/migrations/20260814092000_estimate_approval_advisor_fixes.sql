revoke all on function public.bump_estimate_version_revision() from public, anon, authenticated;

create index if not exists estimate_approval_previews_project_fk_idx
  on public.estimate_approval_previews (project_id);
create index if not exists estimate_approval_previews_estimate_fk_idx
  on public.estimate_approval_previews (estimate_id);
create index if not exists estimate_approval_previews_version_fk_idx
  on public.estimate_approval_previews (estimate_version_id);
