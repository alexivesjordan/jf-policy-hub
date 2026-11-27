-- Pulse Service access and conflict checks. Raises RESULTS and rolls back.
-- Run on TEST as a role that can insert auth.users. Not for production.

do $$
declare
  v_office uuid := gen_random_uuid();
  v_view uuid := gen_random_uuid();
  v_eng uuid := gen_random_uuid();
  v_other uuid := gen_random_uuid();
  v_none uuid := gen_random_uuid();
  v_after uuid := gen_random_uuid();
  v_ops uuid := gen_random_uuid();
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
  v_level text;
  v_clash uuid;
  v_back_a uuid;
  v_back_b uuid;
  v_sheet jsonb;
  v_eng_file uuid;
  v_cust_file uuid;
  v_pdf_file uuid;
  v_photo_file uuid;
  v_old_file uuid;
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
  from (values (v_office), (v_view), (v_eng), (v_other), (v_none), (v_after), (v_ops)) as people(id);

  update public.profiles
  set role = 'staff', workspace_role = 'member', access_mode = 'custom', access_granted = true, is_active = true
  where id in (v_office, v_view, v_eng, v_other, v_none);
  update public.profiles
  set role = 'staff', workspace_role = 'member', access_mode = 'follow', access_granted = true, is_active = true
  where id in (v_after, v_ops);
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

  if v_visit is distinct from v_second and v_second is not null then
    v_ok := v_ok + 1;
  else
    v_fail := v_fail + 1; v_notes := v_notes || ' back to back same id;';
  end if;

  begin
    v_back_a := public.service_visit_save(null, jsonb_build_object(
      'customerName', 'First Gym',
      'addressLine1', '10 First Street',
      'postcode', 'PE30 4AA',
      'visitType', 'repair',
      'visitOn', '2026-12-11',
      'durationMinutes', 45,
      'assigneeIds', jsonb_build_array(v_lewis)
    ));
    v_back_b := public.service_visit_save(null, jsonb_build_object(
      'customerName', 'Second Gym',
      'addressLine1', '11 Second Street',
      'postcode', 'PE30 4AB',
      'visitType', 'service',
      'visitOn', '2026-12-11',
      'durationMinutes', 45,
      'assigneeIds', jsonb_build_array(v_lewis)
    ));
    if v_back_a is distinct from v_back_b then
      v_ok := v_ok + 1;
    else
      v_fail := v_fail + 1; v_notes := v_notes || ' pair same id;';
    end if;
  exception when others then
    v_fail := v_fail + 1; v_notes := v_notes || ' pair ' || sqlerrm || ';';
  end;

  reset role;
  select count(*) into v_count
  from svc.visits v
  join svc.visit_assignees a on a.visit_id = v.id
  where v.visit_on = '2026-12-11' and a.resource_id = v_lewis;
  if v_count = 2 then v_ok := v_ok + 1; else v_fail := v_fail + 1; v_notes := v_notes || ' pair count ' || coalesce(v_count::text, 'null') || ';'; end if;
  perform set_config('request.jwt.claim.sub', v_office::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_office, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

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
  begin
    perform public.service_visit_set_progress(v_visit, 'done', 'Belt replaced', null);
    v_fail := v_fail + 1; v_notes := v_notes || ' done without sheet;';
  exception when others then
    if sqlerrm ilike '%job sheet%' then v_ok := v_ok + 1; else v_fail := v_fail + 1; v_notes := v_notes || ' done gate ' || sqlerrm || ';'; end if;
  end;
  reset role;
  select status into v_err from svc.visits where id = v_visit;
  if v_err = 'scheduled' then v_ok := v_ok + 1; else v_fail := v_fail + 1; v_notes := v_notes || ' progress ' || coalesce(v_err, 'null') || ';'; end if;
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

  select a.access_level into v_level
  from public.workspace_team_access a
  join public.workspace_teams t on t.id = a.team_id
  where t.name = 'Aftersales' and a.module_id = 'service';
  if v_level = 'edit' then v_ok := v_ok + 1; else v_fail := v_fail + 1; v_notes := v_notes || ' aftersales ' || coalesce(v_level, 'null') || ';'; end if;
  select a.access_level into v_level
  from public.workspace_team_access a
  join public.workspace_teams t on t.id = a.team_id
  where t.name = 'Operations' and a.module_id = 'service';
  if v_level = 'edit' then v_ok := v_ok + 1; else v_fail := v_fail + 1; v_notes := v_notes || ' operations ' || coalesce(v_level, 'null') || ';'; end if;

  insert into public.workspace_team_members (team_id, profile_id)
  select t.id, member.profile_id
  from public.workspace_teams t
  join (values ('Aftersales', v_after), ('Operations', v_ops)) as member(team_name, profile_id)
    on member.team_name = t.name
  where t.archived_at is null;

  perform set_config('request.jwt.claim.sub', v_after::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_after, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    v_clash := public.service_visit_save(null, jsonb_build_object(
      'customerName', 'Aftersales Gym', 'addressLine1', '8 Yard', 'postcode', 'PE30 1AA',
      'visitType', 'service', 'visitOn', '2026-12-10', 'durationMinutes', 60,
      'windowStart', '09:00', 'windowEnd', '11:00',
      'assigneeIds', jsonb_build_array(v_lewis)
    ));
    v_ok := v_ok + 1;
  exception when others then
    v_fail := v_fail + 1; v_notes := v_notes || ' aftersales save ' || sqlerrm || ';';
  end;
  begin
    perform public.service_visit_save(null, jsonb_build_object(
      'customerName', 'Clash Gym', 'addressLine1', '8 Yard', 'postcode', 'PE30 1AA',
      'visitType', 'repair', 'visitOn', '2026-12-10', 'durationMinutes', 60,
      'windowStart', '10:00', 'windowEnd', '12:00',
      'assigneeIds', jsonb_build_array(v_lewis)
    ));
    v_fail := v_fail + 1; v_notes := v_notes || ' overlap saved;';
  exception when others then
    if sqlerrm ilike '%These times overlap%' then v_ok := v_ok + 1; else v_fail := v_fail + 1; v_notes := v_notes || ' overlap ' || sqlerrm || ';'; end if;
  end;
  begin
    perform public.service_visit_save(null, jsonb_build_object(
      'customerName', 'Clash Gym', 'addressLine1', '8 Yard', 'postcode', 'PE30 1AA',
      'visitType', 'repair', 'visitOn', '2026-12-10', 'durationMinutes', 60,
      'windowStart', '10:00', 'windowEnd', '12:00',
      'confirmOverlap', true,
      'assigneeIds', jsonb_build_array(v_lewis)
    ));
    v_ok := v_ok + 1;
  exception when others then
    v_fail := v_fail + 1; v_notes := v_notes || ' confirm overlap ' || sqlerrm || ';';
  end;
  begin
    perform public.service_visit_save(null, jsonb_build_object(
      'customerName', 'Beside Gym', 'addressLine1', '9 Yard', 'postcode', 'PE30 1AB',
      'visitType', 'repair', 'visitOn', '2026-12-10', 'durationMinutes', 30,
      'windowStart', '08:00', 'windowEnd', '09:00',
      'assigneeIds', jsonb_build_array(v_lewis)
    ));
    v_ok := v_ok + 1;
  exception when others then
    v_fail := v_fail + 1; v_notes := v_notes || ' adjacent ' || sqlerrm || ';';
  end;
  begin
    perform public.service_visit_save(null, jsonb_build_object(
      'customerName', 'Still blocked', 'addressLine1', '1 High Street', 'postcode', 'NR3 3CC',
      'visitType', 'repair', 'visitOn', '2026-12-03', 'durationMinutes', 60,
      'confirmOverlap', true,
      'assigneeIds', jsonb_build_array(v_lewis)
    ));
    v_fail := v_fail + 1; v_notes := v_notes || ' confirm bypassed install;';
  exception when others then
    if sqlerrm ilike '%install%' then v_ok := v_ok + 1; else v_fail := v_fail + 1; v_notes := v_notes || ' confirm install ' || sqlerrm || ';'; end if;
  end;

  reset role;
  perform set_config('request.jwt.claim.sub', v_ops::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_ops, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_board := public.service_board('2026-12-10', '2026-12-10');
  if (v_board->'canEdit')::boolean then v_ok := v_ok + 1; else v_fail := v_fail + 1; v_notes := v_notes || ' operations board;'; end if;

  reset role;
  perform set_config('request.jwt.claim.sub', v_eng::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_eng, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    perform public.service_board('2026-12-10', '2026-12-10');
    v_fail := v_fail + 1; v_notes := v_notes || ' engineer board after grant;';
  exception when others then
    if sqlerrm ilike '%cannot see%' then v_ok := v_ok + 1; else v_fail := v_fail + 1; v_notes := v_notes || ' engineer still ' || sqlerrm || ';'; end if;
  end;

  reset role;
  update svc.visits set completion_note = 'Belt replaced' where id = v_visit;
  insert into core.files (bucket, storage_path, mime_type, byte_size, entity_schema, entity_table, entity_id, kind)
  values ('job-sheets', 'svc/' || v_visit::text || '/engineer.png', 'image/png', 80, 'ops', 'service_visits', v_visit, 'engineer_signature')
  returning id into v_eng_file;
  insert into core.files (bucket, storage_path, mime_type, byte_size, entity_schema, entity_table, entity_id, kind)
  values ('job-sheets', 'svc/' || v_visit::text || '/customer.png', 'image/png', 80, 'ops', 'service_visits', v_visit, 'customer_signature')
  returning id into v_cust_file;
  insert into core.files (bucket, storage_path, mime_type, byte_size, entity_schema, entity_table, entity_id, kind)
  values ('job-sheets', 'svc/' || v_visit::text || '/sheet.pdf', 'application/pdf', 120, 'ops', 'service_visits', v_visit, 'visit_pack')
  returning id into v_pdf_file;
  insert into core.files (bucket, storage_path, mime_type, byte_size, entity_schema, entity_table, entity_id, kind)
  values ('job-sheets', 'svc/' || v_visit::text || '/equipment.jpg', 'image/jpeg', 90, 'ops', 'service_visits', v_visit, 'equipment')
  returning id into v_photo_file;
  insert into core.files (bucket, storage_path, mime_type, byte_size, entity_schema, entity_table, entity_id, kind)
  values ('job-sheets', 'svc/' || v_visit::text || '/old.jpg', 'image/jpeg', 90, 'ops', 'service_visits', v_visit, 'service_photo')
  returning id into v_old_file;
  insert into svc.visit_photos (visit_id, file_id, created_by)
  values (v_visit, v_old_file, v_eng);

  perform set_config('request.jwt.claim.sub', v_eng::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_eng, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    perform public.service_visit_upload_gate(v_visit, 'equipment');
    v_sheet := public.service_save_visit_sheet(v_visit, jsonb_build_object(
      'customerName', 'Riverside Gym',
      'engineerName', 'Lewis',
      'workCarriedOut', 'Replaced the belt.',
      'engineerSignatureFileId', v_eng_file,
      'customerSignatureFileId', v_cust_file,
      'pdfFileId', v_pdf_file,
      'floorSheeting', true,
      'builtCheckedTag', true,
      'dustCover', true,
      'service', true,
      'installation', false,
      'kitLines', jsonb_build_array(
        jsonb_build_object('code', 'JF-1', 'description', 'Treadmill', 'qty', '1', 'fulfilment', 'installed'),
        jsonb_build_object('code', 'JF-2', 'description', 'Mat', 'qty', '1', 'fulfilment', 'to_follow')
      )
    ), array[v_photo_file]);
    if v_sheet->>'id' is not null then v_ok := v_ok + 1; else v_fail := v_fail + 1; v_notes := v_notes || ' sheet save ' || coalesce(v_sheet::text, 'null') || ';'; end if;
  exception when others then
    v_fail := v_fail + 1; v_notes := v_notes || ' sheet ' || sqlerrm || ';';
  end;
  begin
    perform public.service_save_visit_sheet(v_visit, '{}'::jsonb, array[v_photo_file]);
    v_fail := v_fail + 1; v_notes := v_notes || ' second sheet allowed;';
  exception when others then
    if sqlerrm ilike '%already in%' then v_ok := v_ok + 1; else v_fail := v_fail + 1; v_notes := v_notes || ' second sheet ' || sqlerrm || ';'; end if;
  end;

  reset role;
  select status into v_err from svc.visits where id = v_visit;
  select completion_note into v_level from svc.visits where id = v_visit;
  if v_err = 'done' and v_level = 'Belt replaced' then v_ok := v_ok + 1; else v_fail := v_fail + 1; v_notes := v_notes || ' sheet status ' || coalesce(v_err, 'null') || ' ' || coalesce(v_level, 'null') || ';'; end if;
  if exists (
    select 1 from ops.visit_sheets
    where service_visit_id = v_visit and visit_type = 'service' and install_id is null and submitted_at is not null
  ) then v_ok := v_ok + 1; else v_fail := v_fail + 1; v_notes := v_notes || ' sheet row;'; end if;
  select count(*) into v_count from core.tasks where entity_table = 'service_visits' and entity_id = v_visit and title = 'Kit still to follow';
  if v_count = 1 then v_ok := v_ok + 1; else v_fail := v_fail + 1; v_notes := v_notes || ' follow up ' || v_count::text || ';'; end if;
  if position('assert_visit_started' in pg_get_functiondef('public.install_save_visit_sheet(uuid,jsonb,text)'::regprocedure)) > 0 then
    v_ok := v_ok + 1;
  else
    v_fail := v_fail + 1; v_notes := v_notes || ' install RAMS missing;';
  end if;
  if position('assert_visit_started' in pg_get_functiondef('public.service_save_visit_sheet(uuid,jsonb,uuid[])'::regprocedure)) = 0 then
    v_ok := v_ok + 1;
  else
    v_fail := v_fail + 1; v_notes := v_notes || ' service sheet requires RAMS;';
  end if;

  perform set_config('request.jwt.claim.sub', v_other::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_other, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    perform public.service_save_visit_sheet(v_visit, '{}'::jsonb, array[v_photo_file]);
    v_fail := v_fail + 1; v_notes := v_notes || ' unassigned sheet;';
  exception when others then
    if sqlerrm ilike '%cannot save%' or sqlerrm ilike '%already in%' then v_ok := v_ok + 1; else v_fail := v_fail + 1; v_notes := v_notes || ' unassigned sheet ' || sqlerrm || ';'; end if;
  end;

  reset role;
  perform set_config('request.jwt.claim.sub', v_office::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_office, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_board := public.service_visit_open(v_visit);
  v_sheet := public.service_visit_sheet(v_visit);
  if v_board->>'completionNote' = 'Belt replaced'
     and jsonb_array_length(v_board->'photos') >= 1
     and (v_sheet->>'submitted')::boolean
  then
    v_ok := v_ok + 1;
  else
    v_fail := v_fail + 1; v_notes := v_notes || ' readable ' || coalesce(v_board::text, 'null') || ' ' || coalesce(v_sheet::text, 'null') || ';';
  end if;

  raise exception 'RESULTS ok=% fail=% %', v_ok, v_fail, v_notes;
end
$$;
