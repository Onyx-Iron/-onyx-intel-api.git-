-- Project ↔ contact relationships (Company Hub M7 / recovery D-09).

create table if not exists public.project_contacts (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  project_id      uuid not null references public.projects(id) on delete cascade,
  contact_id      uuid not null,
  role_on_project text,
  is_primary      boolean not null default false,
  meta            jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now(),
  unique (tenant_id, project_id, contact_id)
);

create index if not exists idx_project_contacts_project
  on public.project_contacts(tenant_id, project_id);

alter table public.project_contacts enable row level security;
drop policy if exists project_contacts_service_role_all on public.project_contacts;
create policy project_contacts_service_role_all
  on public.project_contacts for all to service_role
  using (true) with check (true);
revoke all on table public.project_contacts from anon, authenticated;
grant select, insert, update, delete on table public.project_contacts to service_role;
