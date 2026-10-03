-- Organic social / GBP publish history (Company Hub M5).

create table if not exists public.social_posts (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  project_id      uuid references public.projects(id) on delete set null,
  channels        text[] not null default '{}',
  copy            text not null,
  image_urls      text[] not null default '{}',
  status          text not null default 'draft'
                  check (status in ('draft', 'published', 'failed')),
  external_ids    jsonb not null default '{}'::jsonb,
  error_detail    text,
  created_by      text,
  published_at    timestamptz,
  created_at      timestamptz not null default now()
);

create index if not exists idx_social_posts_tenant
  on public.social_posts(tenant_id, created_at desc);

alter table public.social_posts enable row level security;
drop policy if exists social_posts_service_role_all on public.social_posts;
create policy social_posts_service_role_all
  on public.social_posts for all to service_role
  using (true) with check (true);
revoke all on table public.social_posts from anon, authenticated;
grant select, insert, update, delete on table public.social_posts to service_role;
