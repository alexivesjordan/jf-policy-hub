-- Security hardening. Raises RESULTS and rolls back. Last TEST run: ok=20 fail=0.
-- Access stays: self, a day-to-day lead, a line manager with a second step, and a director with a second step.
-- A member cannot read someone else's pulse access. Trigger functions still fire and cannot be called directly.

do $$
declare
  v_owner uuid := gen_random_uuid();
  v_admin uuid := gen_random_uuid();
  v_director uuid := gen_random_uuid();
  v_manager uuid := gen_random_uuid();
  v_lead uuid := gen_random_uuid();
  v_employee uuid := gen_random_uuid();
  v_guest uuid := gen_random_uuid();
  v_mgr uuid;
  v_lead_emp uuid;
  v_emp uuid;
  v_mgr_pos uuid;
  v_emp_pos uuid;
  v_leave uuid;
  v_count int;
  v_ok int := 0;
  v_fail int := 0;
  v_notes text := '';
  v_options text;
begin
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, email_change, email_change_token_new, recovery_token
  )
  select '00000000-0000-0000-0000-000000000000', id, 'authenticated', 'authenticated',
         'sec-' || id::text || '@jordanfitness.com', '', now(),
         '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', ''
  from (values (v_owner), (v_admin), (v_director), (v_manager), (v_lead), (v_employee), (v_guest)) as people(id);

  update public.profiles set role = 'staff', workspace_role = 'owner', access_granted = true, is_active = true where id = v_owner;
  update public.profiles set role = 'staff', workspace_role = 'admin', access_granted = true, is_active = true where id = v_admin;
  update public.profiles set role = 'staff', workspace_role = 'member', access_granted = true, is_active = true where id in (v_director, v_manager, v_lead, v_employee);
  update public.profiles set role = 'staff', workspace_role = 'guest', access_granted = true, is_active = true where id = v_guest;
  update public.module_access set enabled = true
  where module_id = 'people' and profile_id in (v_owner, v_admin, v_director, v_manager, v_lead, v_employee);

  insert into hr.directors (profile_id) values (v_director);
  insert into hr.employees (profile_id, full_name, status) values (v_manager, 'Line Manager', 'active') returning id into v_mgr;
  insert into hr.employees (profile_id, full_name, status) values (v_lead, 'Day Lead', 'active') returning id into v_lead_emp;
  insert into hr.employees (profile_id, full_name, status, manager_id, lead_id)
  values (v_employee, 'Employee', 'active', v_mgr, v_lead_emp)
  returning id into v_emp;
  insert into hr.positions (title) values ('Manager seat') returning id into v_mgr_pos;
  insert into hr.positions (title, reports_to_position_id) values ('Employee seat', v_mgr_pos) returning id into v_emp_pos;
  insert into hr.position_holders (position_id, employee_id) values (v_mgr_pos, v_mgr), (v_emp_pos, v_emp);
  update hr.employees set position_id = v_mgr_pos where id = v_mgr;
  update hr.employees set position_id = v_emp_pos where id = v_emp;
  insert into hr.leave_requests (employee_id, starts_on, ends_on, days, kind, status)
  values (v_emp, current_date, current_date, 1, 'annual', 'approved')
  returning id into v_leave;

  select coalesce(array_to_string(c.reloptions, ','), '') into v_options
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname = 'hr_leave_dates';
  if v_options like '%security_invoker=true%' then v_ok := v_ok + 1; else v_fail := v_fail + 1; v_notes := v_notes || ' invoker;'; end if;
  select coalesce(array_to_string(c.reloptions, ','), '') into v_options
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname = 'calendar_entries_visible';
  if v_options like '%security_invoker=false%' then v_ok := v_ok + 1; else v_fail := v_fail + 1; v_notes := v_notes || ' calendar;'; end if;

  perform set_config('request.jwt.claim.sub', v_employee::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_employee, 'role', 'authenticated', 'aal', 'aal1')::text, true);
  execute 'set local role authenticated';
  select count(*) into v_count from public.hr_leave_dates where id = v_leave;
  if v_count = 1 then v_ok := v_ok + 1; else v_fail := v_fail + 1; v_notes := v_notes || ' self;'; end if;
  begin
    perform public.workspace_access_row(v_owner, 'people');
    v_fail := v_fail + 1; v_notes := v_notes || ' member read owner;';
  exception when others then
    if sqlerrm ilike '%owner or admin%' then v_ok := v_ok + 1; else v_fail := v_fail + 1; v_notes := v_notes || ' access err;'; end if;
  end;
  if public.workspace_access_row(v_employee, 'people') ? 'level' then v_ok := v_ok + 1; else v_fail := v_fail + 1; v_notes := v_notes || ' own row;'; end if;
  begin
    perform public.guard_last_owner();
    v_fail := v_fail + 1; v_notes := v_notes || ' call trigger;';
  exception when insufficient_privilege then
    v_ok := v_ok + 1;
  end;
  begin
    perform hr.touch_org_managers();
    v_fail := v_fail + 1; v_notes := v_notes || ' call org trigger;';
  exception when insufficient_privilege then
    v_ok := v_ok + 1;
  end;
  begin
    perform 1 from core.email_challenges;
    v_fail := v_fail + 1; v_notes := v_notes || ' read codes;';
  exception when insufficient_privilege then
    v_ok := v_ok + 1;
  end;

  reset role;
  perform set_config('request.jwt.claim.sub', v_lead::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_lead, 'role', 'authenticated', 'aal', 'aal1')::text, true);
  execute 'set local role authenticated';
  select count(*) into v_count from public.hr_leave_dates where id = v_leave;
  if v_count = 1 then v_ok := v_ok + 1; else v_fail := v_fail + 1; v_notes := v_notes || ' lead;'; end if;

  reset role;
  perform set_config('request.jwt.claim.sub', v_manager::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_manager, 'role', 'authenticated', 'aal', 'aal1')::text, true);
  execute 'set local role authenticated';
  select count(*) into v_count from public.hr_leave_dates where id = v_leave;
  if v_count = 0 then v_ok := v_ok + 1; else v_fail := v_fail + 1; v_notes := v_notes || ' manager aal1;'; end if;

  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', v_manager, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  execute 'set local role authenticated';
  select count(*) into v_count from public.hr_leave_dates where id = v_leave;
  if v_count = 1 then v_ok := v_ok + 1; else v_fail := v_fail + 1; v_notes := v_notes || ' manager aal2;'; end if;

  reset role;
  perform set_config('request.jwt.claim.sub', v_director::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_director, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  execute 'set local role authenticated';
  select count(*) into v_count from public.hr_leave_dates where id = v_leave;
  if v_count = 1 then v_ok := v_ok + 1; else v_fail := v_fail + 1; v_notes := v_notes || ' director;'; end if;

  reset role;
  perform set_config('request.jwt.claim.sub', v_owner::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  execute 'set local role authenticated';
  select count(*) into v_count from public.hr_leave_dates where id = v_leave;
  if v_count = 0 then v_ok := v_ok + 1; else v_fail := v_fail + 1; v_notes := v_notes || ' owner leave;'; end if;
  if (public.org_chart()->'companies') is not null then v_ok := v_ok + 1; else v_fail := v_fail + 1; v_notes := v_notes || ' org;'; end if;
  if public.workspace_access_row(v_employee, 'people') ? 'level' then v_ok := v_ok + 1; else v_fail := v_fail + 1; v_notes := v_notes || ' owner access;'; end if;

  reset role;
  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  execute 'set local role authenticated';
  if public.workspace_access_row(v_employee, 'people') ? 'level' then v_ok := v_ok + 1; else v_fail := v_fail + 1; v_notes := v_notes || ' admin access;'; end if;

  reset role;
  perform set_config('request.jwt.claim.sub', v_guest::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_guest, 'role', 'authenticated', 'aal', 'aal1')::text, true);
  execute 'set local role authenticated';
  select count(*) into v_count from public.hr_leave_dates where id = v_leave;
  if v_count = 0 then v_ok := v_ok + 1; else v_fail := v_fail + 1; v_notes := v_notes || ' guest;'; end if;

  reset role;
  insert into hr.positions (title) values ('Hardening probe');
  v_ok := v_ok + 1;

  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claim.role', 'service_role', true);
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  update public.profiles set workspace_role = 'member' where workspace_role = 'owner' and id <> v_owner;
  begin
    update public.profiles set workspace_role = 'member' where id = v_owner;
    v_fail := v_fail + 1; v_notes := v_notes || ' last owner;';
  exception when others then
    if sqlerrm ilike '%last owner%' then v_ok := v_ok + 1; else v_fail := v_fail + 1; v_notes := v_notes || ' trigger text;'; end if;
  end;

  reset role;
  begin
    execute 'set local role anon';
    perform 1 from public.hr_leave_dates;
    v_fail := v_fail + 1; v_notes := v_notes || ' anon;';
  exception when insufficient_privilege then
    v_ok := v_ok + 1;
  end;

  raise exception 'RESULTS ok=% fail=% %', v_ok, v_fail, v_notes;
end
$$;
