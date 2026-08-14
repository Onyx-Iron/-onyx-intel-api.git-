-- Exact, actor-bound review previews and append-only decisions for price evidence.

create table if not exists public.price_observation_review_previews (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  price_observation_id uuid not null references public.price_observations(id) on delete cascade,
  actor_user_id text not null,
  decision text not null check (decision in ('approved', 'rejected')),
  reason text,
  payload jsonb not null,
  payload_hash text not null check (payload_hash ~ '^[a-f0-9]{64}$'),
  status text not null default 'pending' check (status in ('pending', 'confirmed', 'expired', 'cancelled')),
  expires_at timestamptz not null,
  confirmed_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.price_observation_reviews (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  price_observation_id uuid not null references public.price_observations(id) on delete cascade,
  reviewer_user_id text not null,
  decision text not null check (decision in ('approved', 'rejected')),
  reason text,
  before_status text not null,
  after_status text not null,
  source_snapshot jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists price_review_previews_lookup_idx
  on public.price_observation_review_previews (tenant_id, actor_user_id, created_at desc);
create index if not exists price_review_previews_observation_idx
  on public.price_observation_review_previews (price_observation_id);
create index if not exists price_observation_reviews_lookup_idx
  on public.price_observation_reviews (tenant_id, price_observation_id, created_at desc);
create index if not exists price_observation_reviews_observation_idx
  on public.price_observation_reviews (price_observation_id);

alter table public.price_observation_review_previews enable row level security;
alter table public.price_observation_review_previews force row level security;
alter table public.price_observation_reviews enable row level security;
alter table public.price_observation_reviews force row level security;

create policy price_review_previews_service_role_only on public.price_observation_review_previews
  for all to service_role using (true) with check (true);
create policy price_observation_reviews_service_role_only on public.price_observation_reviews
  for all to service_role using (true) with check (true);
revoke all on table public.price_observation_review_previews, public.price_observation_reviews from anon, authenticated;
grant select, insert, update, delete on table public.price_observation_review_previews to service_role;
grant select, insert on table public.price_observation_reviews to service_role;

create or replace function public.confirm_price_observation_review(
  p_preview_id uuid,
  p_observation_id uuid,
  p_tenant_id uuid,
  p_actor_user_id text,
  p_payload_hash text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  preview_row public.price_observation_review_previews%rowtype;
  observation_row public.price_observations%rowtype;
  updated_row public.price_observations%rowtype;
begin
  select * into preview_row from public.price_observation_review_previews
    where id = p_preview_id and tenant_id = p_tenant_id for update;
  if not found then raise exception 'Price review preview not found for tenant'; end if;
  if preview_row.price_observation_id <> p_observation_id then raise exception 'Price review target mismatch'; end if;
  if preview_row.actor_user_id <> p_actor_user_id then raise exception 'Price review preview belongs to another actor'; end if;
  if preview_row.status <> 'pending' then raise exception 'Price review preview is not pending'; end if;
  if preview_row.expires_at <= now() then
    update public.price_observation_review_previews set status = 'expired' where id = p_preview_id;
    raise exception 'Price review preview expired';
  end if;
  if preview_row.payload_hash <> p_payload_hash then raise exception 'Price review payload changed'; end if;

  select * into observation_row from public.price_observations
    where id = preview_row.price_observation_id and tenant_id = p_tenant_id for update;
  if not found then raise exception 'Price observation not found for tenant'; end if;
  if observation_row.approval_status <> 'unreviewed' then raise exception 'Price observation was already reviewed'; end if;
  if to_jsonb(observation_row) <> preview_row.payload -> 'observation' then
    raise exception 'Price observation changed after review preview';
  end if;

  update public.price_observations set
    approval_status = preview_row.decision,
    approved_by = case when preview_row.decision = 'approved' then p_actor_user_id else null end,
    approved_at = case when preview_row.decision = 'approved' then now() else null end
  where id = observation_row.id
  returning * into updated_row;

  insert into public.price_observation_reviews (
    tenant_id, price_observation_id, reviewer_user_id, decision, reason,
    before_status, after_status, source_snapshot
  ) values (
    p_tenant_id, observation_row.id, p_actor_user_id, preview_row.decision, preview_row.reason,
    observation_row.approval_status, updated_row.approval_status, to_jsonb(observation_row)
  );
  update public.price_observation_review_previews
    set status = 'confirmed', confirmed_at = now() where id = p_preview_id;
  return to_jsonb(updated_row);
end;
$$;

revoke all on function public.confirm_price_observation_review(uuid, uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.confirm_price_observation_review(uuid, uuid, uuid, text, text) to service_role;
