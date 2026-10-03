-- Sheet queue RPCs must not be callable with the browser anon key or a
-- signed-in user JWT. The cron path uses service_role.

begin;

create extension if not exists pgtap with schema extensions;

select plan(12);

select ok(
  not has_function_privilege('anon', 'public.claim_unparsed_sheets(integer, text, integer)', 'execute'),
  'anon cannot execute claim_unparsed_sheets'
);
select ok(
  not has_function_privilege('authenticated', 'public.claim_unparsed_sheets(integer, text, integer)', 'execute'),
  'authenticated cannot execute claim_unparsed_sheets'
);
select ok(
  has_function_privilege('service_role', 'public.claim_unparsed_sheets(integer, text, integer)', 'execute'),
  'service_role can execute claim_unparsed_sheets'
);

select ok(
  not has_function_privilege('anon', 'public.complete_sheet_processing(uuid)', 'execute'),
  'anon cannot execute complete_sheet_processing'
);
select ok(
  not has_function_privilege('authenticated', 'public.complete_sheet_processing(uuid)', 'execute'),
  'authenticated cannot execute complete_sheet_processing'
);
select ok(
  has_function_privilege('service_role', 'public.complete_sheet_processing(uuid)', 'execute'),
  'service_role can execute complete_sheet_processing'
);

select ok(
  not has_function_privilege('anon', 'public.fail_sheet_processing(uuid, text)', 'execute'),
  'anon cannot execute fail_sheet_processing'
);
select ok(
  not has_function_privilege('authenticated', 'public.fail_sheet_processing(uuid, text)', 'execute'),
  'authenticated cannot execute fail_sheet_processing'
);
select ok(
  has_function_privilege('service_role', 'public.fail_sheet_processing(uuid, text)', 'execute'),
  'service_role can execute fail_sheet_processing'
);

select ok(
  not has_function_privilege('anon', 'public.refresh_sheet_index_status(text)', 'execute'),
  'anon cannot execute refresh_sheet_index_status'
);
select ok(
  not has_function_privilege('authenticated', 'public.refresh_sheet_index_status(text)', 'execute'),
  'authenticated cannot execute refresh_sheet_index_status'
);
select ok(
  has_function_privilege('service_role', 'public.refresh_sheet_index_status(text)', 'execute'),
  'service_role can execute refresh_sheet_index_status'
);

select * from finish();

rollback;
