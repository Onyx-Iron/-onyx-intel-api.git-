-- Estimate sync reads takeoff_items.quantity. An unscaled page-space
-- length or area must not keep the client number there: that number is
-- either pixels or a title-block suggestion. The manual_takeoffs row still
-- stores it (quantity is NOT NULL) until the sheet is verified and the
-- geometry is recomputed. Counts and legacy pixel geometry are left alone.

create or replace function public.withhold_unscaled_mirror_quantity()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_formula text;
  v_type text;
  v_space text;
begin
  if new.source_manual_takeoff_id is null then
    return new;
  end if;

  select mt.calculation_formula_version, mt.takeoff_type, mt.geometry->>'coordinate_space'
    into v_formula, v_type, v_space
  from public.manual_takeoffs mt
  where mt.id = new.source_manual_takeoff_id;

  if v_formula is null and v_type is distinct from 'count' and v_space = 'page_space' then
    new.quantity := null;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_takeoff_items_withhold_unscaled on public.takeoff_items;
create trigger trg_takeoff_items_withhold_unscaled
  before insert or update of quantity
  on public.takeoff_items
  for each row
  execute function public.withhold_unscaled_mirror_quantity();
