-- Bind confirmations to the observation named by the request path.
drop function if exists public.confirm_price_observation_review(uuid, uuid, text, text);

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
    where id = p_observation_id and tenant_id = p_tenant_id for update;
  if not found then raise exception 'Price observation not found for tenant'; end if;
  if observation_row.approval_status <> 'unreviewed' then raise exception 'Price observation was already reviewed'; end if;
  if to_jsonb(observation_row) <> preview_row.payload -> 'observation' then
    raise exception 'Price observation changed after review preview';
  end if;

  update public.price_observations set
    approval_status = preview_row.decision,
    approved_by = case when preview_row.decision = 'approved' then p_actor_user_id else null end,
    approved_at = case when preview_row.decision = 'approved' then now() else null end
  where id = observation_row.id returning * into updated_row;
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
