alter table public.estimate_items
  add column if not exists row_version integer not null default 0 check (row_version >= 0);
