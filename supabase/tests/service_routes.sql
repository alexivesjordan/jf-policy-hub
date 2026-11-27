-- Route order and maintenance plan access. Raises RESULTS and rolls back.
-- Run on TEST as a role that can insert auth.users. Not for production.

do $$
declare
  v_office uuid := gen_random_uuid();
  v_view uuid := gen_random_uuid();
  v_eng uuid := gen_random_uuid();
  v_other uuid := gen_random_uuid();
  v_none uuid := gen_random_uuid();
  v_lewis uuid;
  v_peter uuid;
  v_quote uuid;
  v_install uuid;
  v_extension uuid;
  v_plan uuid;
  v_visit uuid;
  v_today date := (timezone('Europe/London', now()))::date;
  v_ids uuid[] := '{}';
  v_reverse uuid[] := '{}';
  v_one uuid;
  v_line1 text;
  v_city text;
  v_postcode text;
  v_due date;
  v_source text;
  v_linked uuid;
  v_order integer;
  v_other_order integer;
  v_day jsonb;
  v_list jsonb;
  v_ok integer := 0;
  v_fail integer := 0;
  v_notes text := '';
  v_i integer;
begin
  if svc.add_months(date '2026-01-31', 1) <> date '2026-02-28'
     or svc.add_months(date '2024-01-31', 1) <> date '2024-02-29'
     or svc.add_months(date '2024-02-29', 12) <> date '2025-02-28'
     or svc.add_months(date '2026-08-31', 6) <> date '2027-02-28'
     or svc.add_months(date '2023-08-31', 6) <> date '2024-02-29'
  then
    v_fail := v_fail + 1; v_notes := v_notes || ' add_months;';
  else
    v_ok := v_ok + 1;
  end if;

  select line1, city, postcode into v_line1, v_city, v_postcode
  from svc.split_site_address('4 Quay Street, Norwich, NR1 1AA');
  if v_line1 = '4 Quay Street' and v_city = 'Norwich' and v_postcode = 'NR1 1AA' then
    v_ok := v_ok + 1;
  else
    v_fail := v_fail + 1; v_notes := v_notes || ' address ' || coalesce(v_line1, '') || '/' || coalesce(v_city, '') || '/' || coalesce(v_postcode, '') || ';';
  end if;

  perform set_config('orbit.profile_sync', 'on', true);
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, email_change, email_change_token_new, recovery_token
  )
  select '00000000-0000-0000-0000-000000000000', id, 'authenticated', 'authenticated',
         'route-test-' || id::text || '@example.com', '', now(),
         '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', ''
  from (values (v_office), (v_view), (v_eng), (v_other), (v_none)) as people(id);

  update public.profiles
  set role = 'staff', workspace_role = 'member', access_mode = 'custom', access_granted = true, is_active = true
  where id in (v_office, v_view, v_eng, v_other, v_none);
  update public.module_access set access_level = 'edit', enabled = true where profile_id = v_office and module_id = 'service';
  update public.module_access set access_level = 'view', enabled = true where profile_id = v_view and module_id = 'service';
  update public.module_access set access_level = 'none', enabled = false where profile_id in (v_eng, v_other, v_none) and module_id = 'service';

  insert into ops.resources (resource_type, name, profile_id, status)
  values ('installer', 'Route Lewis', v_eng, 'active') returning id into v_lewis;
  insert into ops.resources (resource_type, name, profile_id, status)
  values ('installer', 'Route Peter', v_other, 'active') returning id into v_peter;

  perform set_config('request.jwt.claim.sub', v_none::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_none, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  begin
    perform public.svc_list_plans();
    v_fail := v_fail + 1; v_notes := v_notes || ' none listed plans;';
  exception when others then
    if sqlerrm ilike '%cannot see%' then v_ok := v_ok + 1; else v_fail := v_fail + 1; v_notes := v_notes || ' none list ' || sqlerrm || ';'; end if;
  end;
  begin
    perform public.svc_set_route(v_lewis, v_today, array[gen_random_uuid()]);
    v_fail := v_fail + 1; v_notes := v_notes || ' none set route;';
  exception when others then
    if sqlerrm ilike '%cannot change%' then v_ok := v_ok + 1; else v_fail := v_fail + 1; v_notes := v_notes || ' none route ' || sqlerrm || ';'; end if;
  end;
  begin
    perform count(*) from svc.maintenance_plans;
    v_fail := v_fail + 1; v_notes := v_notes || ' none read table;';
  exception when others then
    if sqlerrm ilike '%permission denied%' then v_ok := v_ok + 1; else v_fail := v_fail + 1; v_notes := v_notes || ' none table ' || sqlerrm || ';'; end if;
  end;

  reset role;
  perform set_config('request.jwt.claim.sub', v_view::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_view, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    v_list := public.svc_list_plans();
    if jsonb_typeof(v_list) = 'array' then v_ok := v_ok + 1; else v_fail := v_fail + 1; v_notes := v_notes || ' view list;'; end if;
  exception when others then
    v_fail := v_fail + 1; v_notes := v_notes || ' view list ' || sqlerrm || ';';
  end;
  begin
    perform public.svc_create_plan(gen_random_uuid(), v_today, v_today);
    v_fail := v_fail + 1; v_notes := v_notes || ' view created;';
  exception when others then
    if sqlerrm ilike '%cannot change%' then v_ok := v_ok + 1; else v_fail := v_fail + 1; v_notes := v_notes || ' view create ' || sqlerrm || ';'; end if;
  end;

  reset role;
  insert into ops.install_quotes (created_by, order_number, payload)
  values (v_office, 'SVC-PLAN-1', '{}'::jsonb) returning id into v_quote;
  insert into ops.installs (
    quote_id, order_number, install_price, warranty_option, start_on, end_on, customer_name,
    contact_name, contact_email, site_address, booking_rep_id, crew, van_size, van_count
  ) values (
    v_quote, 'SVC-PLAN-1', 100, 'twice_yearly', '2026-01-30', '2026-01-31', 'Harbour Fitness',
    'Pat Example', 'desk@example.com', '4 Quay Street, Norwich, NR1 1AA',
    v_office, 1, 'small', 1
  ) returning id into v_install;
  insert into ops.install_quotes (created_by, order_number, payload)
  values (v_office, 'SVC-PLAN-EXT', '{}'::jsonb);
  insert into ops.installs (
    quote_id, order_number, install_price, warranty_option, start_on, end_on, customer_name,
    site_address, booking_rep_id, crew, van_size, van_count
  )
  select id, 'SVC-PLAN-EXT', 100, 'extension', '2026-02-02', '2026-02-02', 'Extension Gym',
    '1 Side Street, Ipswich, IP1 1AA', v_office, 1, 'small', 1
  from ops.install_quotes where order_number = 'SVC-PLAN-EXT'
  returning id into v_extension;

  perform set_config('request.jwt.claim.sub', v_office::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_office, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  begin
    perform public.svc_create_plan(v_extension, null, null);
    v_fail := v_fail + 1; v_notes := v_notes || ' extension allowed;';
  exception when others then
    if sqlerrm ilike '%no maintenance plan%' then v_ok := v_ok + 1; else v_fail := v_fail + 1; v_notes := v_notes || ' extension ' || sqlerrm || ';'; end if;
  end;

  begin
    v_plan := public.svc_create_plan(v_install, date '2026-01-31', date '2026-01-31');
    v_ok := v_ok + 1;
  exception when others then
    v_fail := v_fail + 1; v_notes := v_notes || ' create plan ' || sqlerrm || ';';
  end;

  reset role;
  if exists (
    select 1
    from svc.maintenance_plans p
    join svc.sites s on s.id = p.site_id
    where p.id = v_plan
      and p.cadence_months = 6
      and p.next_due_on = date '2026-01-31'
      and p.status = 'active'
      and p.order_number = 'SVC-PLAN-1'
      and s.customer_name = 'Harbour Fitness'
      and s.postcode = 'NR1 1AA'
      and s.address_line1 = '4 Quay Street'
  ) then
    v_ok := v_ok + 1;
  else
    v_fail := v_fail + 1; v_notes := v_notes || ' plan row;';
  end if;

  perform set_config('request.jwt.claim.sub', v_office::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_office, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  begin
    v_visit := public.service_visit_save(null, jsonb_build_object(
      'customerName', 'Harbour Fitness',
      'addressLine1', '4 Quay Street',
      'city', 'Norwich',
      'postcode', 'NR1 1AA',
      'visitType', 'service',
      'visitOn', '2026-07-31',
      'durationMinutes', 60,
      'assigneeIds', jsonb_build_array(v_lewis),
      'maintenancePlanId', v_plan
    ));
    v_ok := v_ok + 1;
  exception when others then
    v_fail := v_fail + 1; v_notes := v_notes || ' plan visit ' || sqlerrm || ';';
  end;

  reset role;
  select source, maintenance_plan_id into v_source, v_linked from svc.visits where id = v_visit;
  if v_source = 'proactive' and v_linked = v_plan then
    v_ok := v_ok + 1;
  else
    v_fail := v_fail + 1; v_notes := v_notes || ' visit link ' || coalesce(v_source, '') || ';';
  end if;
  update svc.visits
  set status = 'done', completed_at = now()
  where id = v_visit;

  perform set_config('request.jwt.claim.sub', v_none::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_none, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    perform public.svc_advance_plan(v_visit);
    v_fail := v_fail + 1; v_notes := v_notes || ' none advanced;';
  exception when others then
    if sqlerrm ilike '%cannot update%' then v_ok := v_ok + 1; else v_fail := v_fail + 1; v_notes := v_notes || ' none advance ' || sqlerrm || ';'; end if;
  end;

  reset role;
  perform set_config('request.jwt.claim.sub', v_office::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_office, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_due := public.svc_advance_plan(v_visit);
  if v_due = date '2026-07-31' then v_ok := v_ok + 1; else v_fail := v_fail + 1; v_notes := v_notes || ' roll6 ' || coalesce(v_due::text, 'null') || ';'; end if;
  v_due := public.svc_advance_plan(v_visit);
  if v_due = date '2026-07-31' then v_ok := v_ok + 1; else v_fail := v_fail + 1; v_notes := v_notes || ' roll twice ' || coalesce(v_due::text, 'null') || ';'; end if;

  reset role;
  insert into svc.sites (customer_name, address_line1, postcode)
  values ('Leap Gym', '1 Leap Road', 'CB1 1AA')
  returning id into v_linked;
  insert into svc.maintenance_plans (site_id, cadence_months, starts_on, next_due_on, status, created_by)
  values (v_linked, 12, date '2024-02-29', date '2024-02-29', 'active', v_office)
  returning id into v_plan;
  insert into svc.visits (site_id, visit_type, source, visit_on, duration_minutes, status, completed_at, maintenance_plan_id, created_by)
  values (v_linked, 'service', 'proactive', date '2024-02-29', 60, 'done', now(), v_plan, v_office)
  returning id into v_visit;
  perform set_config('request.jwt.claim.sub', v_office::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_office, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_due := public.svc_advance_plan(v_visit);
  if v_due = date '2025-02-28' then v_ok := v_ok + 1; else v_fail := v_fail + 1; v_notes := v_notes || ' leap ' || coalesce(v_due::text, 'null') || ';'; end if;

  reset role;
  insert into svc.sites (customer_name, address_line1, postcode)
  values ('August Gym', '2 August Road', 'PE30 2AA')
  returning id into v_linked;
  insert into svc.maintenance_plans (site_id, cadence_months, starts_on, next_due_on, status, created_by)
  values (v_linked, 6, date '2023-08-31', date '2023-08-31', 'active', v_office)
  returning id into v_plan;
  insert into svc.visits (site_id, visit_type, source, visit_on, duration_minutes, status, completed_at, maintenance_plan_id, created_by)
  values (v_linked, 'service', 'proactive', date '2023-08-31', 60, 'done', now(), v_plan, v_office)
  returning id into v_visit;
  perform set_config('request.jwt.claim.sub', v_office::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_office, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_due := public.svc_advance_plan(v_visit);
  if v_due = date '2024-02-29' then v_ok := v_ok + 1; else v_fail := v_fail + 1; v_notes := v_notes || ' month end ' || coalesce(v_due::text, 'null') || ';'; end if;

  reset role;
  perform set_config('request.jwt.claim.sub', v_office::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_office, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  for v_i in 1..8 loop
    v_one := public.service_visit_save(null, jsonb_build_object(
      'customerName', 'Example Anglia ' || v_i,
      'addressLine1', v_i || ' Example Road',
      'postcode', 'PE30 4J' || v_i,
      'visitType', 'repair',
      'visitOn', v_today,
      'durationMinutes', 30,
      'assigneeIds', jsonb_build_array(v_lewis)
    ));
    v_ids := v_ids || v_one;
  end loop;
  v_one := public.service_visit_save(null, jsonb_build_object(
    'customerName', 'Example Peter',
    'addressLine1', '9 Other Road',
    'postcode', 'NR2 2BB',
    'visitType', 'repair',
    'visitOn', v_today,
    'durationMinutes', 30,
    'assigneeIds', jsonb_build_array(v_peter)
  ));
  select coalesce(array_agg(listed.id order by listed.ord desc), '{}') into v_reverse
  from unnest(v_ids) with ordinality as listed(id, ord);
  begin
    perform public.svc_set_route(v_lewis, v_today, v_reverse);
    v_ok := v_ok + 1;
  exception when others then
    v_fail := v_fail + 1; v_notes := v_notes || ' set route ' || sqlerrm || ';';
  end;

  begin
    perform public.svc_set_route(v_lewis, v_today, v_reverse || v_one);
    v_fail := v_fail + 1; v_notes := v_notes || ' foreign stop allowed;';
  exception when others then
    if sqlerrm ilike '%does not match%' then v_ok := v_ok + 1; else v_fail := v_fail + 1; v_notes := v_notes || ' foreign ' || sqlerrm || ';'; end if;
  end;

  reset role;
  select a.stop_order into v_order
  from svc.visit_assignees a
  where a.visit_id = v_ids[8] and a.resource_id = v_lewis;
  select a.stop_order into v_other_order
  from svc.visit_assignees a
  where a.visit_id = v_one and a.resource_id = v_peter;
  if v_order = 1 and v_other_order = 1 then
    v_ok := v_ok + 1;
  else
    v_fail := v_fail + 1; v_notes := v_notes || ' stop order ' || coalesce(v_order::text, 'null') || '/' || coalesce(v_other_order::text, 'null') || ';';
  end if;

  perform set_config('request.jwt.claim.sub', v_eng::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_eng, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_day := public.service_visit_day();
  if v_day->'stops'->0->>'customerName' = 'Example Anglia 8'
     and jsonb_array_length(v_day->'stops') = 8
  then
    v_ok := v_ok + 1;
  else
    v_fail := v_fail + 1; v_notes := v_notes || ' my day ' || coalesce(v_day->'stops'->0->>'customerName', 'null') || ' len ' || coalesce(jsonb_array_length(v_day->'stops')::text, 'null') || ';';
  end if;

  reset role;
  perform set_config('request.jwt.claim.sub', v_view::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_view, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    perform public.svc_set_route(v_lewis, v_today, v_reverse);
    v_fail := v_fail + 1; v_notes := v_notes || ' view reordered;';
  exception when others then
    if sqlerrm ilike '%cannot change%' then v_ok := v_ok + 1; else v_fail := v_fail + 1; v_notes := v_notes || ' view route ' || sqlerrm || ';'; end if;
  end;

  raise exception 'RESULTS ok=% fail=% %', v_ok, v_fail, v_notes;
end
$$;
