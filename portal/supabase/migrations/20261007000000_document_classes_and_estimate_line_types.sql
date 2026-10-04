-- Drawing classification and estimate line types used by the takeoff gate.

do $$
declare r record;
begin
  for r in
    select con.conname
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
    where nsp.nspname = 'public'
      and rel.relname = 'documents'
      and con.contype = 'c'
      and pg_get_constraintdef(con.oid) ilike '%doc_type%'
  loop
    execute format('alter table public.documents drop constraint %I', r.conname);
  end loop;
end $$;

alter table public.documents
  add constraint documents_doc_type_check
  check (
    doc_type is null
    or doc_type = any (array[
      'drawing', 'spec', 'rfi', 'submittal', 'report', 'contract', 'correspondence', 'other'
    ])
  );

do $$
declare r record;
begin
  for r in
    select con.conname
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
    where nsp.nspname = 'public'
      and rel.relname = 'estimate_items'
      and con.contype = 'c'
      and pg_get_constraintdef(con.oid) ilike '%item_type%'
  loop
    execute format('alter table public.estimate_items drop constraint %I', r.conname);
  end loop;
end $$;

alter table public.estimate_items
  add constraint estimate_items_item_type_check
  check (
    item_type = any (array[
      'material', 'labour', 'subcontract', 'equipment', 'fee', 'allowance'
    ])
  );
