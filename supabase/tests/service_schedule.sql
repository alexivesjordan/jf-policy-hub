-- Schedule role checks for service visits. Raises RESULTS and rolls back.
-- Run on TEST as a role that can insert auth.users. Not for production.
-- Names are fixtures.

do $$
declare
  v_office uuid := gen_random_uuid();
  v_view uuid := gen_random_uuid();
  v_eng uuid := gen_random_uuid();
  v_service uuid := gen_random_uuid();
  v_casey uuid;
  v_visit uuid;
  v_weekend uuid;
  v_ok integer := 0;
  v_fail integer := 0;
  v_notes text := '';
  v_sched jsonb;
  v_event jsonb;
  v_free boolean;
  v_warn text;
  v_kind text;
begin
  perform set_config('orbit.profile_sync', 'on', true);
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, email_change, email_change_token_new, recovery_token
  )
  select '00000000-0000-0000-0000-000000000000', id, 'authenticated', 'authenticated',
         'sched-test-' || id::text || '@example.com', '', now(),
         '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', ''
  from (values (v_office), (v_view), (v_eng), (v_service)) as people(id);

  update public.profiles
  set role = 'staff', workspace_role = 'member', access_mode = 'custom', access_granted = true, is_active = true
  where id in (v_office, v_view, v_eng, v_service);
  update public.module_access set access_level = 'edit', enabled = true where profile_id = v_office and module_id = 'operations';
  update public.module_access set access_level = 'none', enabled = false where profile_id = v_office and module_id = 'service';
  update public.module_access set access_level = 'view', enabled = true where profile_id = v_view and module_id = 'operations';
  update public.module_access set access_level = 'none', enabled = false where profile_id in (v_eng, v_service) and module_id = 'operations';
  update public.module_access set access_level = 'edit', enabled = true where profile_id = v_service and module_id = 'service';
  update public.module_access set access_level = 'none', enabled = false where profile_id = v_eng and module_id = 'service';

  insert into ops.resources (resource_type, name, profile_id, status)
  values ('installer', 'Casey North', v_eng, 'active') returning id into v_casey;

  perform set_config('request.jwt.claim.sub', v_service::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_service, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_visit := public.service_visit_save(null, jsonb_build_object(
    'customerName', 'Harbour Gym',
    'addressLine1', '4 Quay Lane',
    'city', 'King''s Lynn',
    'postcode', 'PE30 1AA',
    'contactName', 'Pat Example',
    'contactPhone', '01603 000111',
    'visitType', 'repair',
    'visitOn', '2026-12-07',
    'windowStart', '09:30',
    'windowEnd', '11:00',
    'durationMinutes', 90,
    'assigneeIds', jsonb_build_array(v_casey),
    'lines', jsonb_build_array(jsonb_build_object('kind', 'work', 'sku', 'JF-TREAD', 'description', 'Treadmill', 'fault', 'Belt slip'))
  ));
  v_weekend := public.service_visit_save(null, jsonb_build_object(
    'customerName', 'Quay Leisure',
    'addressLine1', '8 Side Street',
    'postcode', 'PE30 2BB',
    'visitType', 'service',
    'visitOn', '2026-12-12',
    'windowStart', '10:00',
    'windowEnd', '11:00',
    'durationMinutes', 60,
    'assigneeIds', jsonb_build_array(v_casey)
  ));
  begin
    perform public.service_visit_save(null, jsonb_build_object(
      'customerName', 'Harbour Gym',
      'addressLine1', '4 Quay Lane',
      'postcode', 'PE30 1AA',
      'visitType', 'repair',
      'visitOn', '2026-12-07',
      'windowStart', '10:00',
      'windowEnd', '11:30',
      'durationMinutes', 60,
      'assigneeIds', jsonb_build_array(v_casey)
    ));
    v_fail := v_fail + 1; v_notes := v_notes || ' overlap saved;';
  exception when others then
    if sqlerrm ilike '%overlap%' then v_ok := v_ok + 1; else v_fail := v_fail + 1; v_notes := v_notes || ' overlap ' || sqlerrm || ';'; end if;
  end;

  reset role;
  v_warn := svc.overlap_warning(v_visit);
  if v_warn is null then v_ok := v_ok + 1; else v_fail := v_fail + 1; v_notes := v_notes || ' clean visit warned;'; end if;
  select kind into v_kind from ops.person_day_conflicts(v_casey, '2026-12-07', null) where kind = 'service' limit 1;
  if v_kind = 'service' then v_ok := v_ok + 1; else v_fail := v_fail + 1; v_notes := v_notes || ' conflict list ' || coalesce(v_kind, 'null') || ';'; end if;
  select ops.resource_free_for_days(v_casey, array['2026-12-07'::date]) into v_free;
  if v_free is false then v_ok := v_ok + 1; else v_fail := v_fail + 1; v_notes := v_notes || ' service did not block install;'; end if;
  insert into ops.unavailability (resource_id, starts_on, ends_on, reason)
  values (v_casey, '2026-12-09', '2026-12-09', 'leave');
  select ops.resource_free_for_days(v_casey, array['2026-12-09'::date]) into v_free;
  if v_free is false then v_ok := v_ok + 1; else v_fail := v_fail + 1; v_notes := v_notes || ' leave did not block install;'; end if;
  select ops.resource_free_for_days(v_casey, array['2026-12-10'::date]) into v_free;
  if v_free is true then v_ok := v_ok + 1; else v_fail := v_fail + 1; v_notes := v_notes || ' free day blocked;'; end if;

  perform set_config('request.jwt.claim.sub', v_office::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_office, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_sched := public.ops_schedule('2026-12-07', '2026-12-13');
  select item into v_event
  from jsonb_array_elements(v_sched->'events') as item
  where item->>'kind' = 'service' and item->>'rowId' = v_casey::text
  limit 1;
  if v_event->>'day' = '2026-12-07'
     and v_event->>'label' = 'Service 09:30 · Harbour Gym'
     and v_event->>'href' = '/service/visits/' || v_visit::text
     and v_event->>'rowKind' = 'engineer'
  then
    v_ok := v_ok + 1;
  else
    v_fail := v_fail + 1; v_notes := v_notes || ' office event ' || coalesce(v_event::text, 'null') || ';';
  end if;
  if not exists (
    select 1 from jsonb_array_elements(v_sched->'events') as item
    where item->>'href' = '/service/visits/' || v_weekend::text
  ) then
    v_ok := v_ok + 1;
  else
    v_fail := v_fail + 1; v_notes := v_notes || ' weekend shown;';
  end if;

  reset role;
  perform set_config('request.jwt.claim.sub', v_view::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_view, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_sched := public.ops_schedule('2026-12-07', '2026-12-11');
  if exists (
    select 1 from jsonb_array_elements(v_sched->'events') as item
    where item->>'kind' = 'service' and item->>'label' = 'Service 09:30 · Harbour Gym'
  ) then
    v_ok := v_ok + 1;
  else
    v_fail := v_fail + 1; v_notes := v_notes || ' viewer missed service;';
  end if;

  reset role;
  perform set_config('request.jwt.claim.sub', v_eng::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_eng, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    perform public.ops_schedule('2026-12-07', '2026-12-11');
    v_fail := v_fail + 1; v_notes := v_notes || ' engineer saw the schedule;';
  exception when others then
    if sqlerrm ilike '%cannot see%' then v_ok := v_ok + 1; else v_fail := v_fail + 1; v_notes := v_notes || ' engineer ' || sqlerrm || ';'; end if;
  end;
  v_sched := public.service_visit_open(v_visit);
  if v_sched->>'customerName' = 'Harbour Gym' then v_ok := v_ok + 1; else v_fail := v_fail + 1; v_notes := v_notes || ' own visit;'; end if;

  reset role;
  perform set_config('request.jwt.claim.sub', v_service::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_service, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    perform public.ops_schedule('2026-12-07', '2026-12-11');
    v_fail := v_fail + 1; v_notes := v_notes || ' service-only saw the schedule;';
  exception when others then
    if sqlerrm ilike '%cannot see%' then v_ok := v_ok + 1; else v_fail := v_fail + 1; v_notes := v_notes || ' service-only ' || sqlerrm || ';'; end if;
  end;

  reset role;
  execute 'set local role anon';
  begin
    perform public.ops_schedule('2026-12-07', '2026-12-11');
    v_fail := v_fail + 1; v_notes := v_notes || ' anon ran the schedule;';
  exception when insufficient_privilege then
    v_ok := v_ok + 1;
  when others then
    v_fail := v_fail + 1; v_notes := v_notes || ' anon ' || sqlerrm || ';';
  end;

  raise exception 'RESULTS ok=% fail=% %', v_ok, v_fail, v_notes;
end
$$;
