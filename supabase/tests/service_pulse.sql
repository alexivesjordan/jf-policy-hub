-- Pulse Service access and conflict checks. Raises RESULTS and rolls back.
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
  v_visit uuid;
  v_second uuid;
  v_loose uuid;
  v_site uuid;
  v_asset uuid;
  v_ok integer := 0;
  v_fail integer := 0;
  v_notes text := '';
  v_board jsonb;
  v_day jsonb;
  v_count integer;
  v_free boolean;
  v_err text;
begin
  perform set_config('orbit.profile_sync', 'on', true);
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, email_change, email_change_token_new, recovery_token
  )
  select '00000000-0000-0000-0000-000000000000', id, 'authenticated', 'authenticated',
         'svc-test-' || id::text || '@example.com', '', now(),
         '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', ''
  from (values (v_office), (v_view), (v_eng), (v_other), (v_none)) as people(id);

  update public.profiles
  set role = 'staff', workspace_role = 'member', access_mode = 'custom', access_granted = true, is_active = true
  where id in (v_office, v_view, v_eng, v_other, v_none);
  update public.module_access set access_level = 'edit', enabled = true where profile_id = v_office and module_id = 'service';
  update public.module_access set access_level = 'view', enabled = true where profile_id = v_view and module_id = 'service';
  update public.module_access set access_level = 'none', enabled = false where profile_id in (v_eng, v_other, v_none) and module_id = 'service';

  insert into ops.resources (resource_type, name, profile_id, status)
  values ('installer', 'SVC Lewis', v_eng, 'active') returning id into v_lewis;
  insert into ops.resources (resource_type, name, profile_id, status)
  values ('installer', 'SVC Peter', v_other, 'active') returning id into v_peter;

  insert into ops.install_quotes (created_by, order_number, payload)
  values (v_office, 'SVC-INSTALL-1', '{}'::jsonb) returning id into v_quote;
  insert into ops.installs (
    quote_id, order_number, install_price, start_on, end_on, customer_name,
    booking_rep_id, crew, van_size, van_count
  ) values (
    v_quote, 'SVC-INSTALL-1', 100, '2026-12-03', '2026-12-03', 'Example Gym',
    v_office, 1, 'small', 1
  ) returning id into v_install;
  insert into ops.install_reservations (install_id, resource_id, day)
  values (v_install, v_lewis, '2026-12-03');
  insert into ops.unavailability (resource_id, starts_on, ends_on, reason)
  values (v_peter, '2026-12-04', '2026-12-04', 'leave');
  insert into public.calendar_entries (entry_type, profile_id, starts_on, ends_on, request_status, created_by)
  values ('annual_leave', v_eng, '2026-12-08', '2026-12-08', 'confirmed', v_office);

  perform set_config('request.jwt.claim.sub', v_office::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_office, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  begin
    v_visit := public.service_visit_save(null, jsonb_build_object(
      'customerName', 'Riverside Gym',
      'addressLine1', '1 High Street',
      'city', 'King''s Lynn',
      'postcode', 'PE304JJ',
      'contactName', 'Pat Example',
      'contactPhone', '01603 000000',
      'contactEmail', 'desk@example.com',
      'visitType', 'repair',
      'notes', 'Belt slip',
      'visitOn', '2026-12-02',
      'durationMinutes', 90,
      'windowStart', '09:00',
      'windowEnd', '11:00',
      'assigneeIds', jsonb_build_array(v_lewis),
      'lines', jsonb_build_array(jsonb_build_object('kind', 'work', 'sku', 'JF-1', 'serial', 'SN-1', 'fault', 'Belt', 'parts', 'Belt kit')),
      'assets', jsonb_build_array(jsonb_build_object('make', 'Jordan', 'model', 'Runner', 'serial', 'SN-1'))
    ));
    v_ok := v_ok + 1;
  exception when others then
    v_fail := v_fail + 1; v_notes := v_notes || ' office save ' || sqlerrm || ';';
  end;

  begin
    perform public.service_visit_save(null, jsonb_build_object(
      'customerName', 'Blocked Gym', 'addressLine1', '2 High Street', 'postcode', 'NR1 1AA',
      'visitType', 'repair', 'visitOn', '2026-12-03', 'durationMinutes', 60,
      'assigneeIds', jsonb_build_array(v_lewis)
    ));
    v_fail := v_fail + 1; v_notes := v_notes || ' install conflict allowed;';
  exception when others then
    if sqlerrm ilike '%install%' then v_ok := v_ok + 1; else v_fail := v_fail + 1; v_notes := v_notes || ' install block ' || sqlerrm || ';'; end if;
  end;

  begin
    perform public.service_visit_save(null, jsonb_build_object(
      'customerName', 'Away Gym', 'addressLine1', '3 High Street', 'postcode', 'NR2 2BB',
      'visitType', 'collection', 'visitOn', '2026-12-04', 'durationMinutes', 60,
      'assigneeIds', jsonb_build_array(v_peter)
    ));
    v_fail := v_fail + 1; v_notes := v_notes || ' leave conflict allowed;';
  exception when others then
    if sqlerrm ilike '%away%' then v_ok := v_ok + 1; else v_fail := v_fail + 1; v_notes := v_notes || ' leave block ' || sqlerrm || ';'; end if;
  end;

  begin
    v_second := public.service_visit_save(null, jsonb_build_object(
      'customerName', 'Harbour Fitness',
      'addressLine1', '4 Quay',
      'postcode', 'NR1 1AA',
      'visitType', 'swap',
      'visitOn', '2026-12-02',
      'durationMinutes', 60,
      'assigneeIds', jsonb_build_array(v_lewis),
      'lines', jsonb_build_array(
        jsonb_build_object('kind', 'swap_out', 'sku', 'OUT-1', 'description', 'New treadmill'),
        jsonb_build_object('kind', 'swap_back', 'sku', 'BACK-1', 'serial', 'OLD-1')
      )
    ));
    v_ok := v_ok + 1;
  exception when others then
    v_fail := v_fail + 1; v_notes := v_notes || ' stack ' || sqlerrm || ';';
  end;

  v_board := public.service_board('2026-12-02', '2026-12-02');
  if (v_board->'canEdit')::boolean and jsonb_array_length(v_board->'stops') = 2 then
    v_ok := v_ok + 1;
  else
    v_fail := v_fail + 1; v_notes := v_notes || ' board ' || coalesce(v_board::text, 'null') || ';';
  end if;

  perform public.service_visit_arrange(v_second, v_lewis, v_lewis, '2026-12-02', 1);
  v_loose := public.service_visit_save(null, jsonb_build_object(
    'customerName', 'Loose Gym', 'addressLine1', '9 Side Street', 'postcode', 'CB1 1AA',
    'visitType', 'repair', 'visitOn', '2026-12-05', 'durationMinutes', 30, 'assigneeIds', '[]'::jsonb
  ));

  reset role;
  select stop_order into v_count from svc.visit_assignees where visit_id = v_second and resource_id = v_lewis;
  if v_count = 1 then v_ok := v_ok + 1; else v_fail := v_fail + 1; v_notes := v_notes || ' reorder ' || coalesce(v_count::text, 'null') || ';'; end if;

  select site_id into v_site from svc.visits where id = v_visit;
  select count(*) into v_count from svc.assets where site_id = v_site and serial = 'SN-1';
  if v_count = 1 then v_ok := v_ok + 1; else v_fail := v_fail + 1; v_notes := v_notes || ' asset;'; end if;
  select ops.resource_free_for_days(v_lewis, array['2026-12-02'::date]) into v_free;
  if v_free is false then v_ok := v_ok + 1; else v_fail := v_fail + 1; v_notes := v_notes || ' service did not block install;'; end if;
  select ops.resource_free_for_days(v_lewis, array['2026-12-08'::date]) into v_free;
  if v_free is false then v_ok := v_ok + 1; else v_fail := v_fail + 1; v_notes := v_notes || ' calendar leave did not block install;'; end if;
  select ops.resource_free_for_days(v_peter, array['2026-12-09'::date]) into v_free;
  if v_free is true then v_ok := v_ok + 1; else v_fail := v_fail + 1; v_notes := v_notes || ' empty day blocked;'; end if;

  perform set_config('request.jwt.claim.sub', v_view::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_view, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_board := public.service_board('2026-12-02', '2026-12-02');
  if (v_board->'canEdit')::boolean is false and jsonb_array_length(v_board->'stops') = 2 then
    v_ok := v_ok + 1;
  else
    v_fail := v_fail + 1; v_notes := v_notes || ' viewer board;';
  end if;
  begin
    perform public.service_visit_save(v_visit, jsonb_build_object(
      'customerName', 'Riverside Gym', 'addressLine1', '1 High Street', 'postcode', 'PE30 4JJ',
      'visitType', 'repair', 'visitOn', '2026-12-02', 'durationMinutes', 90, 'assigneeIds', jsonb_build_array(v_lewis)
    ));
    v_fail := v_fail + 1; v_notes := v_notes || ' viewer saved;';
  exception when others then
    if sqlerrm ilike '%cannot change%' then v_ok := v_ok + 1; else v_fail := v_fail + 1; v_notes := v_notes || ' viewer ' || sqlerrm || ';'; end if;
  end;

  reset role;
  perform set_config('request.jwt.claim.sub', v_eng::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_eng, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_day := public.service_visit_day();
  if jsonb_array_length(v_day->'stops') = 0 then
    v_ok := v_ok + 1;
  else
    v_fail := v_fail + 1; v_notes := v_notes || ' engineer saw a future day;';
  end if;
  begin
    perform public.service_board('2026-12-02', '2026-12-02');
    v_fail := v_fail + 1; v_notes := v_notes || ' engineer saw the board;';
  exception when others then
    if sqlerrm ilike '%cannot see%' then v_ok := v_ok + 1; else v_fail := v_fail + 1; v_notes := v_notes || ' engineer board ' || sqlerrm || ';'; end if;
  end;
  begin
    perform public.service_visit_open(v_loose);
    v_fail := v_fail + 1; v_notes := v_notes || ' engineer opened a visit;';
  exception when others then
    if sqlerrm ilike '%not found%' then v_ok := v_ok + 1; else v_fail := v_fail + 1; v_notes := v_notes || ' engineer open ' || sqlerrm || ';'; end if;
  end;
  begin
    select count(*) into v_count from svc.visits;
    v_fail := v_fail + 1; v_notes := v_notes || ' engineer table read ' || v_count::text || ';';
  exception when insufficient_privilege then
    v_ok := v_ok + 1;
  end;

  reset role;
  update svc.visits set visit_on = (timezone('Europe/London', now()))::date where id = v_visit;
  perform set_config('request.jwt.claim.sub', v_eng::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_eng, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_day := public.service_visit_day();
  if jsonb_array_length(v_day->'stops') = 1
     and v_day->'stops'->0->>'customerName' = 'Riverside Gym'
     and v_day->'stops'->0->>'contactPhone' = '01603 000000'
  then
    v_ok := v_ok + 1;
  else
    v_fail := v_fail + 1; v_notes := v_notes || ' own day ' || coalesce(v_day::text, 'null') || ';';
  end if;
  perform public.service_visit_set_progress(v_visit, 'done', 'Belt replaced', null);
  reset role;
  select status into v_err from svc.visits where id = v_visit;
  if v_err = 'done' then v_ok := v_ok + 1; else v_fail := v_fail + 1; v_notes := v_notes || ' progress ' || coalesce(v_err, 'null') || ';'; end if;
  perform set_config('request.jwt.claim.sub', v_eng::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_eng, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    perform public.service_visit_set_progress(v_loose, 'done', 'nope', null);
    v_fail := v_fail + 1; v_notes := v_notes || ' engineer updated the other visit;';
  exception when others then
    if sqlerrm ilike '%cannot update%' then v_ok := v_ok + 1; else v_fail := v_fail + 1; v_notes := v_notes || ' other progress ' || sqlerrm || ';'; end if;
  end;

  reset role;
  perform set_config('request.jwt.claim.sub', v_other::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_other, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_day := public.service_visit_day();
  if jsonb_array_length(v_day->'stops') = 0 then v_ok := v_ok + 1; else v_fail := v_fail + 1; v_notes := v_notes || ' unassigned saw stops;'; end if;
  begin
    perform public.service_visit_open(v_visit);
    v_fail := v_fail + 1; v_notes := v_notes || ' unassigned opened;';
  exception when others then
    if sqlerrm ilike '%not found%' then v_ok := v_ok + 1; else v_fail := v_fail + 1; v_notes := v_notes || ' unassigned open ' || sqlerrm || ';'; end if;
  end;

  reset role;
  perform set_config('request.jwt.claim.sub', v_none::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_none, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    perform public.service_board('2026-12-02', '2026-12-02');
    v_fail := v_fail + 1; v_notes := v_notes || ' no-access board;';
  exception when others then
    if sqlerrm ilike '%cannot see%' then v_ok := v_ok + 1; else v_fail := v_fail + 1; v_notes := v_notes || ' none board ' || sqlerrm || ';'; end if;
  end;
  v_day := public.service_visit_day();
  if jsonb_array_length(v_day->'stops') = 0 then v_ok := v_ok + 1; else v_fail := v_fail + 1; v_notes := v_notes || ' no-access day;'; end if;
  begin
    perform public.service_visit_set_progress(v_visit, 'scheduled', null, null);
    v_fail := v_fail + 1; v_notes := v_notes || ' no-access progress;';
  exception when others then
    if sqlerrm ilike '%cannot update%' then v_ok := v_ok + 1; else v_fail := v_fail + 1; v_notes := v_notes || ' none progress ' || sqlerrm || ';'; end if;
  end;

  reset role;
  select id into v_asset from svc.assets where serial = 'SN-1';
  if v_asset is not null then v_ok := v_ok + 1; else v_fail := v_fail + 1; v_notes := v_notes || ' asset missing;'; end if;
  select count(*) into v_count from svc.visits where site_id = v_site;
  if v_count = 1 then v_ok := v_ok + 1; else v_fail := v_fail + 1; v_notes := v_notes || ' site reuse ' || v_count::text || ';'; end if;

  raise exception 'RESULTS ok=% fail=% %', v_ok, v_fail, v_notes;
end
$$;
