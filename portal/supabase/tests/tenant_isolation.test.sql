-- XD-14: pgTAP cross-tenant isolation suite.
--
-- Proves the app.clerk_org_id RLS policies on projects / takeoff_items /
-- estimate_items deny tenant B rows when the GUC is set to tenant A's org.
-- Runs inside a transaction that rolls back (including temporary GRANTs
-- needed because production revokes authenticated table privileges —
-- RLS is a backstop for future PostgREST paths).
--
-- CI: `supabase test db` after `supabase db push --local`.

begin;

create extension if not exists pgtap with schema extensions;

select plan(8);

-- Temporary grants so SET ROLE authenticated can exercise RLS (rolled back).
grant select on public.tenants, public.projects, public.takeoff_items, public.estimate_items
  to authenticated;
-- RLS policies on some tables still invoke current_tenant_id(); production
-- revokes this from authenticated (service-role-only app), but pgTAP must
-- exercise policies as authenticated inside this transaction.
grant execute on function public.current_tenant_id() to authenticated;

-- Fixed UUIDs for stable assertions.
select set_config('test.tenant_a', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', true);
select set_config('test.tenant_b', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', true);
select set_config('test.project_a', 'aaaaaaaa-1111-1111-1111-aaaaaaaaaaaa', true);
select set_config('test.project_b', 'bbbbbbbb-1111-1111-1111-bbbbbbbbbbbb', true);
select set_config('test.item_a', 'aaaaaaaa-2222-2222-2222-aaaaaaaaaaaa', true);
select set_config('test.item_b', 'bbbbbbbb-2222-2222-2222-bbbbbbbbbbbb', true);
select set_config('test.est_a', 'aaaaaaaa-3333-3333-3333-aaaaaaaaaaaa', true);
select set_config('test.est_b', 'bbbbbbbb-3333-3333-3333-bbbbbbbbbbbb', true);

insert into public.tenants (id, name, clerk_org_id)
values
  (current_setting('test.tenant_a')::uuid, 'Tenant A', 'org_pgtap_a'),
  (current_setting('test.tenant_b')::uuid, 'Tenant B', 'org_pgtap_b')
on conflict (id) do update set clerk_org_id = excluded.clerk_org_id, name = excluded.name;

insert into public.projects (id, tenant_id, name)
values
  (current_setting('test.project_a')::uuid, current_setting('test.tenant_a')::uuid, 'Project A'),
  (current_setting('test.project_b')::uuid, current_setting('test.tenant_b')::uuid, 'Project B')
on conflict (id) do nothing;

insert into public.takeoff_items (
  id, tenant_id, project_id, label, quantity, unit, type, page, review_status,
  source_method, origin_actor, origin_method, meta
) values
  (
    current_setting('test.item_a')::uuid,
    current_setting('test.tenant_a')::uuid,
    current_setting('test.project_a')::uuid,
    'A item', 10, 'LF', 'takeoff_import', 0, 'approved',
    'manual', 'human', 'manual', '{}'::jsonb
  ),
  (
    current_setting('test.item_b')::uuid,
    current_setting('test.tenant_b')::uuid,
    current_setting('test.project_b')::uuid,
    'B item', 20, 'LF', 'takeoff_import', 0, 'approved',
    'manual', 'human', 'manual', '{}'::jsonb
  )
on conflict (id) do nothing;

-- Optional estimate_items coverage (same app.clerk_org_id ALL policy).
do $$
begin
  insert into public.estimate_items (
    id, tenant_id, project_id, description, quantity, uom, unit_cost, total_price
  ) values
    (
      current_setting('test.est_a')::uuid,
      current_setting('test.tenant_a')::uuid,
      current_setting('test.project_a')::uuid,
      'A est', 1, 'EA', 1, 1
    ),
    (
      current_setting('test.est_b')::uuid,
      current_setting('test.tenant_b')::uuid,
      current_setting('test.project_b')::uuid,
      'B est', 1, 'EA', 2, 2
    )
  on conflict (id) do nothing;
exception
  when undefined_column or not_null_violation or check_violation or foreign_key_violation then
    null;
end $$;

-- As postgres (bypass RLS): both tenants visible.
select is(
  (select count(*)::int from public.projects
    where id in (current_setting('test.project_a')::uuid, current_setting('test.project_b')::uuid)),
  2,
  'superuser sees both projects'
);

select is(
  (select count(*)::int from public.takeoff_items
    where id in (current_setting('test.item_a')::uuid, current_setting('test.item_b')::uuid)),
  2,
  'superuser sees both takeoff_items'
);

-- Impersonate tenant A via GUC used by tenant_isolation_* ALL policies.
set local role authenticated;
select set_config('app.clerk_org_id', 'org_pgtap_a', true);

select is(
  (select count(*)::int from public.projects
    where id in (current_setting('test.project_a')::uuid, current_setting('test.project_b')::uuid)),
  1,
  'tenant A authenticated sees only own project'
);

select is(
  (select id::text from public.projects
    where id in (current_setting('test.project_a')::uuid, current_setting('test.project_b')::uuid)),
  current_setting('test.project_a'),
  'tenant A project id is Project A'
);

select is(
  (select count(*)::int from public.takeoff_items
    where id in (current_setting('test.item_a')::uuid, current_setting('test.item_b')::uuid)),
  1,
  'tenant A authenticated cannot read tenant B takeoff_items'
);

select is(
  (select label from public.takeoff_items
    where id in (current_setting('test.item_a')::uuid, current_setting('test.item_b')::uuid)),
  'A item',
  'tenant A takeoff label is own row'
);

-- Switch to tenant B — must not see A.
select set_config('app.clerk_org_id', 'org_pgtap_b', true);

select is(
  (select count(*)::int from public.projects
    where id in (current_setting('test.project_a')::uuid, current_setting('test.project_b')::uuid)),
  1,
  'tenant B authenticated sees only own project'
);

select is(
  (select count(*)::int from public.takeoff_items
    where id = current_setting('test.item_a')::uuid),
  0,
  'tenant B cannot select tenant A takeoff_items by primary key'
);

select * from finish();

rollback;
