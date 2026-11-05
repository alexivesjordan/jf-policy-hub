-- Behaviour checks for Orbit M0. Runs after the migrations on the throwaway database.

insert into public.access_grants (email, full_name, role, people_enabled)
values
  ('sam.sales@jordanfitness.com', 'Sam Sales', 'staff', true),
  ('lee.lead@jordanfitness.com', 'Lee Lead', 'staff', true),
  ('ian.installer@jordanfitness.com', 'Ian Installer', 'staff', true),
  ('haz.hq@jordanfitness.com', 'Haz HQ', 'staff', true),
  ('pat.admin@jordanfitness.com', 'Pat Admin', 'admin', true),
  ('una.other@jordanfitness.com', 'Una Other', 'staff', true);

insert into auth.users (id, email, raw_user_meta_data)
values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'alex.ives@jordanfitness.com', '{}'::jsonb),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'sam.sales@jordanfitness.com', '{}'::jsonb),
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'lee.lead@jordanfitness.com', '{}'::jsonb),
  ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'ian.installer@jordanfitness.com', '{}'::jsonb),
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'haz.hq@jordanfitness.com', '{}'::jsonb),
  ('ffffffff-ffff-ffff-ffff-ffffffffffff', 'pat.admin@jordanfitness.com', '{}'::jsonb),
  ('99999999-9999-4999-8999-999999999999', 'una.other@jordanfitness.com', '{}'::jsonb);

update public.module_access
set enabled = true
where module_id = 'operations'
  and profile_id in (
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    'cccccccc-cccc-cccc-cccc-cccccccccccc',
    'dddddddd-dddd-dddd-dddd-dddddddddddd',
    'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
    'ffffffff-ffff-ffff-ffff-ffffffffffff'
  );

insert into core.ops_roles (profile_id, ops_role, is_owner)
values
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'sales', false),
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'install_lead', false),
  ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'installer', false),
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'hq', false),
  ('ffffffff-ffff-ffff-ffff-ffffffffffff', 'admin_owner', false);

insert into ops.customers (id, cin7_id, name, owner_rep_id)
values (
  '11111111-1111-4111-8111-111111111111',
  'test-customer',
  'Test Gym',
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
);

insert into ops.sites (id, customer_id, postcode)
values (
  '55555555-5555-4555-8555-555555555555',
  '11111111-1111-4111-8111-111111111111',
  'SW1A 1AA'
);

insert into ops.site_contacts (id, site_id, name, phone, email)
values (
  '66666666-6666-4666-8666-666666666666',
  '55555555-5555-4555-8555-555555555555',
  'Site contact',
  '07000000000',
  'site@example.com'
);

insert into ops.install_jobs (id, job_type, customer_id, site_id, owner_rep_id, status)
values
  (
    '22222222-2222-4222-8222-222222222222',
    'revisit',
    '11111111-1111-4111-8111-111111111111',
    '55555555-5555-4555-8555-555555555555',
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    'priced'
  ),
  (
    '33333333-3333-4333-8333-333333333333',
    'service',
    '11111111-1111-4111-8111-111111111111',
    '55555555-5555-4555-8555-555555555555',
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    'priced'
  );

insert into ops.quote_versions (
  id, job_id, mode, inputs, pricer_version, internal_cost, customer_price, markup_applied, finality
) values (
  '44444444-4444-4444-8444-444444444444',
  '22222222-2222-4222-8222-222222222222',
  'A',
  '{"note":"fixture"}'::jsonb,
  'm0',
  10,
  100,
  0.40,
  'provisional'
);

insert into ops.quote_costs (quote_version_id, cost_breakdown, margin_floor_price)
values (
  '44444444-4444-4444-8444-444444444444',
  '{"labour":10}'::jsonb,
  12
);

insert into ops.resources (id, resource_type, name, profile_id)
values (
  '77777777-7777-4777-8777-777777777777',
  'installer',
  'Ian',
  'dddddddd-dddd-dddd-dddd-dddddddddddd'
);

insert into ops.reservations (resource_id, job_id, day, kind)
values
  ('77777777-7777-4777-8777-777777777777', '22222222-2222-4222-8222-222222222222', current_date, 'firm'),
  ('77777777-7777-4777-8777-777777777777', '33333333-3333-4333-8333-333333333333', current_date + 14, 'pencil');

-- People still stands on its own tables.
do $$
begin
  if (select count(*) from public.policies) < 1 then
    raise exception 'FAIL: People policies missing';
  end if;
  if to_regclass('public.audit_log') is null or to_regclass('core.audit_log') is null then
    raise exception 'FAIL: audit logs were not kept separate';
  end if;
  if to_regclass('public.notifications') is null or to_regclass('core.notifications') is null then
    raise exception 'FAIL: notification tables were not kept separate';
  end if;
  if not exists (select 1 from pg_proc where proname = 'save_policy' and pronamespace = 'public'::regnamespace) then
    raise exception 'FAIL: People save_policy missing';
  end if;
  if not exists (
    select 1 from core.ops_roles
    where profile_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
      and ops_role = 'admin_owner'
      and is_owner
  ) then
    raise exception 'FAIL: Alex was not seeded as owner';
  end if;
  if not exists (
    select 1 from public.module_access
    where profile_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
      and module_id = 'operations'
      and enabled
  ) then
    raise exception 'FAIL: Alex operations module is off';
  end if;
  if exists (
    select 1 from core.ops_roles
    where profile_id = '99999999-9999-4999-8999-999999999999'
  ) then
    raise exception 'FAIL: an ordinary People user received an ops role';
  end if;
  if (select count(*) from core.workflow_states) <> 14
     or (select count(*) from core.workflow_transitions) <> 17
     or (select count(*) from core.workflow_transitions where is_manual) <> 2
  then
    raise exception 'FAIL: install_job workflow seed is wrong';
  end if;
  if (select count(*) from pg_policies where schemaname = 'core' and tablename = 'token_links') <> 0 then
    raise exception 'FAIL: token_links has an authenticated policy';
  end if;
  if exists (select 1 from ops.effort_rows) then
    raise exception 'FAIL: effort rows were invented';
  end if;
  if exists (select 1 from ops.terms_versions where is_live) then
    raise exception 'FAIL: terms were marked live';
  end if;
  if (select min_job_charge from ops.pricing_settings where version = 1) is not null
     or (select margin_floor_pct from ops.pricing_settings where version = 1) is not null
  then
    raise exception 'FAIL: open pricing values were filled in';
  end if;
  if (select count(*) from storage.buckets where id in ('access-media', 'job-sheets', 'qc', 'insurance', 'terms') and public = false) <> 5 then
    raise exception 'FAIL: private storage buckets missing';
  end if;
end
$$;

do $$
begin
  update core.audit_log set action = 'tamper';
  raise exception 'FAIL: audit update should have been rejected';
exception
  when others then
    if sqlerrm not like '%immutable%' then
      raise exception 'FAIL: unexpected audit error: %', sqlerrm;
    end if;
end
$$;

do $$
begin
  update core.settings set value = '{"no":true}'::jsonb;
  raise exception 'FAIL: settings update should have been rejected';
exception
  when others then
    if sqlerrm not like '%immutable%' then
      raise exception 'FAIL: unexpected settings error: %', sqlerrm;
    end if;
end
$$;

do $$
begin
  update ops.pricing_settings set markup_trade = 0.10;
  raise exception 'FAIL: pricing update should have been rejected';
exception
  when others then
    if sqlerrm not like '%immutable%' then
      raise exception 'FAIL: unexpected pricing error: %', sqlerrm;
    end if;
end
$$;

do $$
begin
  update core.ops_roles
  set is_owner = true
  where profile_id = 'ffffffff-ffff-ffff-ffff-ffffffffffff';
  raise exception 'FAIL: a second owner should have been rejected';
exception
  when others then
    if sqlerrm not like '%named owner%' then
      raise exception 'FAIL: unexpected owner error: %', sqlerrm;
    end if;
end
$$;

insert into public.notifications (user_id, title, body, kind)
values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'People', 'Still here', 'decision');

do $$
begin
  update public.notifications set title = 'Changed';
  raise exception 'FAIL: People notification title should stay fixed';
exception
  when others then
    if sqlerrm not like '%only read_at%' then
      raise exception 'FAIL: People notification trigger changed: %', sqlerrm;
    end if;
end
$$;

-- Authenticated client cannot write job status.
update auth.sessions_test
set uid = 'cccccccc-cccc-cccc-cccc-cccccccccccc', role = 'authenticated';

do $$
begin
  execute 'set local role authenticated';
  update ops.install_jobs
  set status = 'booked'
  where id = '22222222-2222-4222-8222-222222222222';
  raise exception 'FAIL: status update should have been rejected';
exception
  when others then
    if sqlerrm not like '%permission denied%' and sqlerrm not like '%not client-writable%' then
      raise exception 'FAIL: unexpected status error: %', sqlerrm;
    end if;
end
$$;

-- Sales cannot move a job. Cin7 events do not move it. Manual hold does.
update auth.sessions_test
set uid = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', role = 'authenticated';

do $$
begin
  perform ops.try_advance('22222222-2222-4222-8222-222222222222', 'place_on_hold');
  raise exception 'FAIL: sales should not advance a job';
exception
  when others then
    if sqlerrm not like '%install lead or owner%' then
      raise exception 'FAIL: unexpected sales advance error: %', sqlerrm;
    end if;
end
$$;

update auth.sessions_test
set uid = 'cccccccc-cccc-cccc-cccc-cccccccccccc', role = 'authenticated';

do $$
declare
  v_status ops.job_status;
begin
  v_status := ops.try_advance('22222222-2222-4222-8222-222222222222', 'cin7_sales_order');
  if v_status <> 'priced' then
    raise exception 'FAIL: Cin7 event changed status to %', v_status;
  end if;

  begin
    perform ops.try_advance('22222222-2222-4222-8222-222222222222', 'place_on_hold');
    raise exception 'FAIL: hold without a reason should fail';
  exception
    when others then
      if sqlerrm not like '%reason and a review date%' then
        raise exception 'FAIL: unexpected hold error: %', sqlerrm;
      end if;
  end;

  if (select status from ops.install_jobs where id = '22222222-2222-4222-8222-222222222222') <> 'priced' then
    raise exception 'FAIL: rejected hold changed the status';
  end if;
end
$$;

begin;
update auth.sessions_test
set uid = 'cccccccc-cccc-cccc-cccc-cccccccccccc', role = 'authenticated';
set local role authenticated;
update ops.install_jobs
set hold_reason = 'Waiting on the customer',
    hold_review_date = current_date + 7
where id = '22222222-2222-4222-8222-222222222222';
commit;

do $$
declare
  v_status ops.job_status;
begin
  v_status := ops.try_advance('22222222-2222-4222-8222-222222222222', 'place_on_hold');
  if v_status <> 'on_hold' then
    raise exception 'FAIL: place_on_hold returned %', v_status;
  end if;
end
$$;

update ops.install_jobs
set lost_reason = 'Customer cancelled'
where id = '22222222-2222-4222-8222-222222222222';

do $$
declare
  v_status ops.job_status;
begin
  v_status := ops.try_advance('22222222-2222-4222-8222-222222222222', 'mark_lost_cancelled');
  if v_status <> 'lost_cancelled' then
    raise exception 'FAIL: mark_lost_cancelled returned %', v_status;
  end if;

  begin
    perform ops.try_advance('22222222-2222-4222-8222-222222222222', 'place_on_hold');
    raise exception 'FAIL: terminal job should not move';
  exception
    when others then
      if sqlerrm not like '%already closed%' then
        raise exception 'FAIL: unexpected terminal error: %', sqlerrm;
      end if;
  end;
end
$$;

-- Gate overrides: owner yes, other admin and sales no.
update auth.sessions_test
set uid = 'ffffffff-ffff-ffff-ffff-ffffffffffff', role = 'authenticated';

do $$
begin
  perform public.orbit_insert_gate_override(
    'ops', 'install_jobs', '22222222-2222-4222-8222-222222222222', 'payment', 'Not the owner'
  );
  raise exception 'FAIL: non-owner gate override should fail';
exception
  when others then
    if sqlerrm not like '%Only the owner%' then
      raise exception 'FAIL: unexpected override error: %', sqlerrm;
    end if;
end
$$;

update auth.sessions_test
set uid = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', role = 'authenticated';

do $$
declare
  v_id uuid;
begin
  v_id := public.orbit_insert_gate_override(
    'ops',
    'install_jobs',
    '22222222-2222-4222-8222-222222222222',
    'payment',
    'Paid by bank transfer and confirmed with accounts.'
  );
  if v_id is null then
    raise exception 'FAIL: owner override returned null';
  end if;

  begin
    update core.gate_overrides set reason = 'changed' where id = v_id;
    raise exception 'FAIL: gate override should be immutable';
  exception
    when others then
      if sqlerrm not like '%immutable%' then
        raise exception 'FAIL: unexpected override mutation error: %', sqlerrm;
      end if;
  end;
end
$$;

do $$
begin
  execute 'set local role authenticated';
  insert into core.gate_overrides (entity_table, entity_id, gate, reason, overridden_by)
  values (
    'install_jobs',
    '33333333-3333-4333-8333-333333333333',
    'access_form',
    'Direct insert by the named owner.',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
  );
end
$$;

update auth.sessions_test
set uid = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', role = 'authenticated';

do $$
begin
  execute 'set local role authenticated';
  insert into core.gate_overrides (entity_table, entity_id, gate, reason, overridden_by)
  values (
    'install_jobs',
    '33333333-3333-4333-8333-333333333333',
    'payment',
    'Sales should not override.',
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
  );
  raise exception 'FAIL: sales inserted a gate override';
exception
  when others then
    if sqlerrm not like '%row-level security%' and sqlerrm not like '%permission denied%' then
      raise exception 'FAIL: unexpected sales override error: %', sqlerrm;
    end if;
end
$$;

-- Row visibility.
update auth.sessions_test
set uid = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', role = 'authenticated';

do $$
declare
  v_count integer;
begin
  execute 'set local role authenticated';

  select count(*) into v_count from ops.quote_costs;
  if v_count <> 0 then
    raise exception 'FAIL: sales can read quote costs (%)', v_count;
  end if;

  select count(*) into v_count from ops.quote_versions;
  if v_count <> 0 then
    raise exception 'FAIL: sales can read quote versions (%)', v_count;
  end if;

  select count(*) into v_count from ops.quote_customer_prices;
  if v_count <> 1 then
    raise exception 'FAIL: sales price view returned %', v_count;
  end if;

  select count(*) into v_count from ops.site_contacts;
  if v_count <> 1 then
    raise exception 'FAIL: sales should see their site contact, got %', v_count;
  end if;

  begin
    execute 'select internal_cost from ops.quote_customer_prices';
    raise exception 'FAIL: internal_cost leaked to sales';
  exception
    when undefined_column then
      null;
  end;
end
$$;

update auth.sessions_test
set uid = 'cccccccc-cccc-cccc-cccc-cccccccccccc', role = 'authenticated';

do $$
declare
  v_count integer;
begin
  execute 'set local role authenticated';
  select count(*) into v_count from ops.quote_costs;
  if v_count <> 1 then
    raise exception 'FAIL: lead should read quote costs, got %', v_count;
  end if;
end
$$;

update auth.sessions_test
set uid = 'dddddddd-dddd-dddd-dddd-dddddddddddd', role = 'authenticated';

do $$
declare
  v_today integer;
  v_later integer;
  v_costs integer;
begin
  execute 'set local role authenticated';
  select count(*) into v_today
  from ops.install_jobs
  where id = '22222222-2222-4222-8222-222222222222';
  select count(*) into v_later
  from ops.install_jobs
  where id = '33333333-3333-4333-8333-333333333333';
  select count(*) into v_costs from ops.quote_costs;
  if v_today <> 1 or v_later <> 0 or v_costs <> 0 then
    raise exception 'FAIL: installer visibility today=% later=% costs=%', v_today, v_later, v_costs;
  end if;
end
$$;

update auth.sessions_test
set uid = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', role = 'authenticated';

do $$
declare
  v_jobs integer;
  v_contacts integer;
  v_costs integer;
begin
  execute 'set local role authenticated';
  select count(*) into v_jobs
  from ops.install_jobs
  where coalesce(cin7_number, '') not like 'FIXTURE-%';
  select count(*) into v_contacts from ops.site_contacts;
  select count(*) into v_costs from ops.quote_costs;
  if v_jobs <> 2 or v_contacts <> 0 or v_costs <> 0 then
    raise exception 'FAIL: HQ visibility jobs=% contacts=% costs=%', v_jobs, v_contacts, v_costs;
  end if;
end
$$;

-- Token round-trip stores only the hash.
update auth.sessions_test set uid = null, role = 'service_role';

do $$
declare
  v_id uuid;
  v_resolved jsonb;
  v_hash text := repeat('ab', 32);
begin
  v_id := public.orbit_store_token_link(
    'portal',
    v_hash,
    'ops',
    'install_jobs',
    '22222222-2222-4222-8222-222222222222',
    now() + interval '15 minutes'
  );

  if (select token_hash = decode(v_hash, 'hex') and encode(token_hash, 'hex') = v_hash from core.token_links where id = v_id) is not true then
    raise exception 'FAIL: token hash was not stored as sha-256 bytes';
  end if;

  v_resolved := public.orbit_resolve_token(v_hash);
  if v_resolved->>'entity_id' <> '22222222-2222-4222-8222-222222222222'
     or v_resolved->>'purpose' <> 'portal'
  then
    raise exception 'FAIL: token did not resolve';
  end if;

  if (select last_viewed_at is not null from core.token_links where id = v_id) is not true then
    raise exception 'FAIL: resolve did not stamp last_viewed_at';
  end if;

  perform public.orbit_revoke_token_link(v_id);
  if public.orbit_resolve_token(v_hash) is not null then
    raise exception 'FAIL: revoked token still resolved';
  end if;
end
$$;

update auth.sessions_test
set uid = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', role = 'authenticated';

do $$
begin
  execute 'set local role authenticated';
  perform * from core.token_links;
  raise exception 'FAIL: authenticated read token_links';
exception
  when insufficient_privilege then
    null;
  when others then
    if sqlerrm not like '%permission denied%' then
      raise exception 'FAIL: unexpected token read error: %', sqlerrm;
    end if;
end
$$;

-- Notifications and tasks.
update auth.sessions_test set uid = null, role = 'service_role';

select public.orbit_insert_notification(
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  'Gate cleared',
  'Payment evidence is in.',
  'gate',
  'in_app',
  null,
  'ops',
  'install_jobs',
  '33333333-3333-4333-8333-333333333333'
);

update auth.sessions_test
set uid = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', role = 'authenticated';

do $$
declare
  v_list jsonb;
  v_count integer;
  v_task jsonb;
begin
  v_list := public.orbit_list_notifications(true);
  if jsonb_array_length(v_list) <> 1 then
    raise exception 'FAIL: expected one unread notification, got %', v_list;
  end if;

  v_count := public.orbit_mark_notifications_read(null);
  if v_count <> 1 then
    raise exception 'FAIL: mark read updated %', v_count;
  end if;

  if jsonb_array_length(public.orbit_list_notifications(true)) <> 0 then
    raise exception 'FAIL: notification still unread';
  end if;

  v_task := public.orbit_create_task('exception', 'Single driver', 'No backup on Tuesday');
  if v_task->>'title' <> 'Single driver' or v_task->>'status' <> 'open' then
    raise exception 'FAIL: task create returned %', v_task;
  end if;

  v_task := public.orbit_update_task((v_task->>'id')::uuid, 'done');
  if v_task->>'status' <> 'done' or v_task->>'completed_at' is null then
    raise exception 'FAIL: task update returned %', v_task;
  end if;
end
$$;

update auth.sessions_test
set uid = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', role = 'authenticated';

do $$
begin
  perform public.orbit_create_task('general', 'Sales should not');
  raise exception 'FAIL: sales created a task';
exception
  when others then
    if sqlerrm not like '%cannot create tasks%' then
      raise exception 'FAIL: unexpected task error: %', sqlerrm;
    end if;
end
$$;

do $$
begin
  perform public.orbit_read_settings();
  raise exception 'FAIL: sales read owner settings';
exception
  when others then
    if sqlerrm not like '%Only the owner%' then
      raise exception 'FAIL: unexpected settings read error: %', sqlerrm;
    end if;
end
$$;

update auth.sessions_test
set uid = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', role = 'authenticated';

do $$
declare
  v_settings jsonb;
begin
  v_settings := public.orbit_read_settings();
  if jsonb_array_length(v_settings->'settings') < 4 then
    raise exception 'FAIL: owner settings missing keys';
  end if;
  if (v_settings->'pricing_settings'->>'min_job_charge') is not null then
    raise exception 'FAIL: min job charge should be unset';
  end if;
  if (v_settings->'pricing_settings'->>'markup_big_corporate')::numeric <> 0.80 then
    raise exception 'FAIL: corporate markup was not seeded';
  end if;
end
$$;

select 'M0 checks passed' as result;
