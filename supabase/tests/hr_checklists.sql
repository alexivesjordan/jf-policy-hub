-- Joiner and leaver checklist access.
-- Directors and workspace admins see every checklist. Line managers see direct reports.
-- A manager on aal1, an unrelated manager, and a plain member see nothing.
-- The block raises RESULTS and rolls back. Run on TEST as a role that can insert auth.users.

do $$
declare
  v_director uuid := gen_random_uuid();
  v_admin uuid := gen_random_uuid();
  v_manager uuid := gen_random_uuid();
  v_other uuid := gen_random_uuid();
  v_member uuid := gen_random_uuid();
  v_emp_manager uuid;
  v_emp_other uuid;
  v_emp_member uuid;
  v_office uuid;
  v_field uuid;
  v_sam uuid;
  v_resource uuid;
  v_van uuid;
  v_item uuid;
  v_ok integer := 0;
  v_fail integer := 0;
  v_notes text := '';
  v_count integer;
  v_before integer;
  v_status text;
  v_end date;
  v_due date;
  v_linked uuid;
begin
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, email_change, email_change_token_new, recovery_token
  )
  select '00000000-0000-0000-0000-000000000000', id, 'authenticated', 'authenticated',
         'hr-checklist-' || id::text || '@example.com', '', now(),
         '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', ''
  from (values (v_director), (v_admin), (v_manager), (v_other), (v_member)) as people(id);

  update public.profiles
  set role = 'staff', workspace_role = 'member', access_granted = true, is_active = true
  where id in (v_director, v_manager, v_other, v_member);
  update public.profiles
  set role = 'staff', workspace_role = 'admin', access_granted = true, is_active = true
  where id = v_admin;
  update public.module_access
  set enabled = true
  where module_id = 'people'
    and profile_id in (v_director, v_admin, v_manager, v_other, v_member);

  insert into hr.employees (profile_id, full_name, status) values (v_manager, 'Blake Morgan', 'active') returning id into v_emp_manager;
  insert into hr.employees (profile_id, full_name, status) values (v_other, 'Noah Blake', 'active') returning id into v_emp_other;
  insert into hr.employees (profile_id, full_name, status) values (v_member, 'Casey Reed', 'active') returning id into v_emp_member;
  insert into hr.directors (profile_id) values (v_director);
  insert into hr.checklists (employee_id, kind, status, due_on)
  values (v_emp_member, 'onboarding', 'open', '2026-12-14');
  insert into ops.resources (resource_type, name, status)
  values ('installer', 'Riley Hart', 'active') returning id into v_resource;
  insert into ops.resources (resource_type, name, status)
  values ('van', 'Checklist van', 'active') returning id into v_van;

  perform set_config('request.jwt.claim.sub', v_director::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_director, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  execute 'set local role authenticated';
  v_office := public.hr_create_joiner(
    'Jamie Cole', null, 'jamie.cole@example.com', null, 'Warehouse', 'Warehouse',
    'warehouse', '2026-11-30', v_emp_manager, 'Permanent', 40, '1 month', null
  );
  v_field := public.hr_create_joiner(
    'Riley Hart', null, 'riley.hart@example.com', null, 'Install engineer', 'Operations',
    'field', '2026-11-30', v_emp_manager, 'Permanent', 40, '1 month', v_resource
  );
  v_sam := public.hr_create_joiner(
    'Sam Cole', null, 'sam.cole@example.com', null, 'Office', 'Office',
    'office', '2026-11-30', v_emp_other, 'Permanent', 37.5, '1 month', null
  );

  select count(*) into v_count
  from hr.checklist_items i
  join hr.checklists c on c.id = i.checklist_id
  where c.employee_id = v_office and c.kind = 'onboarding';
  if v_count = 7 then v_ok := v_ok + 1; else v_fail := v_fail + 1; v_notes := v_notes || ' office items ' || v_count || ';'; end if;
  select count(*) into v_count
  from hr.checklist_items i
  join hr.checklists c on c.id = i.checklist_id
  where c.employee_id = v_office and i.link_kind = 'engineer_record';
  if v_count = 0 then v_ok := v_ok + 1; else v_fail := v_fail + 1; v_notes := v_notes || ' office engineer item;'; end if;
  select due_on into v_due from hr.checklists where employee_id = v_office and kind = 'onboarding';
  if v_due = '2026-12-14' then v_ok := v_ok + 1; else v_fail := v_fail + 1; v_notes := v_notes || ' office due ' || coalesce(v_due::text, 'null') || ';'; end if;
  select i.due_on into v_due
  from hr.checklist_items i
  join hr.checklists c on c.id = i.checklist_id
  where c.employee_id = v_office and i.label = 'H&S induction';
  if v_due = '2026-12-07' then v_ok := v_ok + 1; else v_fail := v_fail + 1; v_notes := v_notes || ' hs due ' || coalesce(v_due::text, 'null') || ';'; end if;

  select count(*) into v_count
  from hr.checklist_items i
  join hr.checklists c on c.id = i.checklist_id
  where c.employee_id = v_field and c.kind = 'onboarding';
  if v_count = 8 then v_ok := v_ok + 1; else v_fail := v_fail + 1; v_notes := v_notes || ' field items ' || v_count || ';'; end if;
  reset role;
  select engineer_resource_id into v_linked from hr.employees where id = v_field;
  if v_linked = v_resource then v_ok := v_ok + 1; else v_fail := v_fail + 1; v_notes := v_notes || ' resource link;'; end if;

  perform set_config('request.jwt.claim.sub', v_director::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_director, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  execute 'set local role authenticated';
  begin
    perform public.hr_create_joiner(
      'Van Person', null, 'van.person@example.com', null, 'Driver', 'Operations',
      'field', '2026-11-30', null, 'Permanent', 40, '1 month', v_van
    );
    v_fail := v_fail + 1; v_notes := v_notes || ' van linked;';
  exception when others then
    if sqlerrm ilike '%cannot be linked%' then v_ok := v_ok + 1; else v_fail := v_fail + 1; v_notes := v_notes || ' van ' || sqlerrm || ';'; end if;
  end;
  begin
    perform public.hr_create_joiner(
      'Office Engineer', null, 'office.engineer@example.com', null, 'Desk', 'Office',
      'office', '2026-11-30', null, 'Permanent', 40, '1 month', v_resource
    );
    v_fail := v_fail + 1; v_notes := v_notes || ' office resource linked;';
  exception when others then
    if sqlerrm ilike '%field staff%' then v_ok := v_ok + 1; else v_fail := v_fail + 1; v_notes := v_notes || ' office resource ' || sqlerrm || ';'; end if;
  end;

  reset role;
  select count(*) into v_before from hr.employees;
  select i.id into v_item
  from hr.checklist_items i
  join hr.checklists c on c.id = i.checklist_id
  where c.employee_id = v_field and i.label = 'Contract issued';
  perform set_config('request.jwt.claim.sub', v_manager::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_manager, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  execute 'set local role authenticated';
  begin
    perform public.hr_create_joiner(
      'Extra Person', null, null, null, null, null, 'office', '2026-11-30', null, null, null, null, null
    );
    v_fail := v_fail + 1; v_notes := v_notes || ' manager created;';
  exception when others then
    if sqlerrm ilike '%cannot add a joiner%' then v_ok := v_ok + 1; else v_fail := v_fail + 1; v_notes := v_notes || ' manager create ' || sqlerrm || ';'; end if;
  end;
  select count(*) into v_count from hr.checklists where employee_id = v_office;
  if v_count = 1 then v_ok := v_ok + 1; else v_fail := v_fail + 1; v_notes := v_notes || ' manager missed report;'; end if;
  select count(*) into v_count from hr.checklists where employee_id = v_sam;
  if v_count = 0 then v_ok := v_ok + 1; else v_fail := v_fail + 1; v_notes := v_notes || ' manager saw other report;'; end if;
  select count(*) into v_count from hr.checklist_templates;
  if v_count = 0 then v_ok := v_ok + 1; else v_fail := v_fail + 1; v_notes := v_notes || ' manager read templates;'; end if;

  reset role;
  perform set_config('request.jwt.claim.sub', v_manager::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_manager, 'role', 'authenticated', 'aal', 'aal1')::text, true);
  execute 'set local role authenticated';
  select count(*) into v_count from hr.checklists where employee_id = v_office;
  if v_count = 0 then v_ok := v_ok + 1; else v_fail := v_fail + 1; v_notes := v_notes || ' aal1 manager read;'; end if;
  begin
    perform public.hr_set_checklist_item(v_item, true);
    v_fail := v_fail + 1; v_notes := v_notes || ' aal1 ticked;';
  exception when others then
    if sqlerrm ilike '%not here%' then v_ok := v_ok + 1; else v_fail := v_fail + 1; v_notes := v_notes || ' aal1 tick ' || sqlerrm || ';'; end if;
  end;

  reset role;
  perform set_config('request.jwt.claim.sub', v_other::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_other, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  execute 'set local role authenticated';
  select count(*) into v_count from hr.checklists where employee_id = v_field;
  if v_count = 0 then v_ok := v_ok + 1; else v_fail := v_fail + 1; v_notes := v_notes || ' unrelated manager read;'; end if;
  select count(*) into v_count from hr.checklists where employee_id = v_sam;
  if v_count = 1 then v_ok := v_ok + 1; else v_fail := v_fail + 1; v_notes := v_notes || ' other manager missed own report;'; end if;

  reset role;
  perform set_config('request.jwt.claim.sub', v_member::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_member, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  execute 'set local role authenticated';
  select count(*) into v_count from hr.checklists where employee_id in (v_office, v_field, v_sam, v_emp_member);
  if v_count = 0 then v_ok := v_ok + 1; else v_fail := v_fail + 1; v_notes := v_notes || ' member read ' || v_count || ';'; end if;
  begin
    perform public.hr_set_checklist_item(v_item, true);
    v_fail := v_fail + 1; v_notes := v_notes || ' member ticked;';
  exception when others then
    if sqlerrm ilike '%not here%' then v_ok := v_ok + 1; else v_fail := v_fail + 1; v_notes := v_notes || ' member tick ' || sqlerrm || ';'; end if;
  end;

  reset role;
  perform set_config('request.jwt.claim.sub', v_director::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_director, 'role', 'authenticated', 'aal', 'aal1')::text, true);
  execute 'set local role authenticated';
  select count(*) into v_count from hr.checklists where employee_id = v_office;
  if v_count = 0 then v_ok := v_ok + 1; else v_fail := v_fail + 1; v_notes := v_notes || ' aal1 director read;'; end if;
  begin
    perform public.hr_create_joiner(
      'Too Soon', null, null, null, null, null, 'office', '2026-11-30', null, null, null, null, null
    );
    v_fail := v_fail + 1; v_notes := v_notes || ' aal1 director created;';
  exception when others then
    if sqlerrm ilike '%two-step%' then v_ok := v_ok + 1; else v_fail := v_fail + 1; v_notes := v_notes || ' aal1 director ' || sqlerrm || ';'; end if;
  end;

  reset role;
  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  execute 'set local role authenticated';
  select count(*) into v_count from hr.checklists where employee_id in (v_office, v_field, v_sam);
  if v_count = 3 then v_ok := v_ok + 1; else v_fail := v_fail + 1; v_notes := v_notes || ' admin checklists ' || v_count || ';'; end if;
  select count(*) into v_count from hr.checklist_templates;
  if v_count = 2 then v_ok := v_ok + 1; else v_fail := v_fail + 1; v_notes := v_notes || ' admin templates ' || v_count || ';'; end if;

  reset role;
  perform set_config('request.jwt.claim.sub', v_director::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_director, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  execute 'set local role authenticated';
  select count(*) into v_count from hr.checklist_templates;
  if v_count = 2 then v_ok := v_ok + 1; else v_fail := v_fail + 1; v_notes := v_notes || ' director templates;'; end if;
  begin
    perform public.hr_start_leaving(v_field, '2026-12-18', 'Someone Else');
    v_fail := v_fail + 1; v_notes := v_notes || ' wrong name saved;';
  exception when others then
    if sqlerrm ilike '%Confirm the person%' then v_ok := v_ok + 1; else v_fail := v_fail + 1; v_notes := v_notes || ' wrong name ' || sqlerrm || ';'; end if;
  end;
  begin
    perform public.hr_start_leaving(v_field, '2026-11-01', 'Riley Hart');
    v_fail := v_fail + 1; v_notes := v_notes || ' early date saved;';
  exception when others then
    if sqlerrm ilike '%before the start date%' then v_ok := v_ok + 1; else v_fail := v_fail + 1; v_notes := v_notes || ' early ' || sqlerrm || ';'; end if;
  end;
  reset role;
  select status, end_date into v_status, v_end from hr.employees where id = v_field;
  if v_status = 'active' and v_end is null then v_ok := v_ok + 1; else v_fail := v_fail + 1; v_notes := v_notes || ' status changed early ' || coalesce(v_status, 'null') || ';'; end if;
  if (select done_at is null from hr.checklist_items where id = v_item) then v_ok := v_ok + 1; else v_fail := v_fail + 1; v_notes := v_notes || ' item ticked by mistake;'; end if;

  perform set_config('request.jwt.claim.sub', v_manager::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_manager, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  execute 'set local role authenticated';
  perform public.hr_set_checklist_item(v_item, true);
  select status into v_status
  from hr.checklists
  where employee_id = v_field and kind = 'onboarding';
  if v_status = 'open' then v_ok := v_ok + 1; else v_fail := v_fail + 1; v_notes := v_notes || ' one tick closed it;'; end if;

  reset role;
  perform set_config('request.jwt.claim.sub', v_director::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_director, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  execute 'set local role authenticated';
  perform public.hr_start_leaving(v_field, '2026-12-18', 'Riley Hart');
  reset role;
  select status, end_date into v_status, v_end from hr.employees where id = v_field;
  if v_status = 'leaver' and v_end = '2026-12-18' then v_ok := v_ok + 1; else v_fail := v_fail + 1; v_notes := v_notes || ' leave ' || coalesce(v_status, 'null') || ' ' || coalesce(v_end::text, 'null') || ';'; end if;
  select i.due_on into v_due
  from hr.checklist_items i
  join hr.checklists c on c.id = i.checklist_id
  where c.employee_id = v_field and c.kind = 'offboarding' and i.label = 'Holiday balance settled';
  if v_due = '2026-12-11' then v_ok := v_ok + 1; else v_fail := v_fail + 1; v_notes := v_notes || ' holiday due ' || coalesce(v_due::text, 'null') || ';'; end if;
  select count(*) into v_count
  from hr.checklist_items i
  join hr.checklists c on c.id = i.checklist_id
  where c.employee_id = v_field and c.kind = 'offboarding' and i.label = 'Engineer record inactive';
  if v_count = 1 then v_ok := v_ok + 1; else v_fail := v_fail + 1; v_notes := v_notes || ' leaver engineer item;'; end if;

  perform set_config('request.jwt.claim.sub', v_director::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_director, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  execute 'set local role authenticated';
  begin
    perform public.hr_start_leaving(v_field, '2026-12-20', 'Riley Hart');
    v_fail := v_fail + 1; v_notes := v_notes || ' second leave saved;';
  exception when others then
    if sqlerrm ilike '%already started%' then v_ok := v_ok + 1; else v_fail := v_fail + 1; v_notes := v_notes || ' second ' || sqlerrm || ';'; end if;
  end;
  for v_item in
    select i.id
    from hr.checklist_items i
    join hr.checklists c on c.id = i.checklist_id
    where c.employee_id = v_office and c.kind = 'onboarding'
  loop
    perform public.hr_set_checklist_item(v_item, true);
  end loop;
  select status into v_status from hr.checklists where employee_id = v_office and kind = 'onboarding';
  if v_status = 'done' then v_ok := v_ok + 1; else v_fail := v_fail + 1; v_notes := v_notes || ' not done ' || coalesce(v_status, 'null') || ';'; end if;

  reset role;
  select end_date into v_end from hr.employees where id = v_field;
  if v_end = '2026-12-18' then v_ok := v_ok + 1; else v_fail := v_fail + 1; v_notes := v_notes || ' end date moved;'; end if;
  select count(*) into v_count from hr.employees;
  if v_count = v_before then v_ok := v_ok + 1; else v_fail := v_fail + 1; v_notes := v_notes || ' employee count ' || v_count || ' vs ' || v_before || ';'; end if;

  begin
    execute 'set local role anon';
    perform 1 from public.hr_checklists;
    v_fail := v_fail + 1; v_notes := v_notes || ' anon read;';
  exception when insufficient_privilege then
    v_ok := v_ok + 1;
  end;

  raise exception 'RESULTS ok=% fail=% %', v_ok, v_fail, v_notes;
end
$$;
