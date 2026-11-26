-- Director-only HR access. Raises RESULTS and rolls back.
-- Run on TEST after 20261127100000, as a role that can insert auth.users.

do $$
declare
  v_admin uuid := gen_random_uuid();
  v_owner uuid := gen_random_uuid();
  v_director uuid := gen_random_uuid();
  v_manager uuid := gen_random_uuid();
  v_member uuid := gen_random_uuid();
  v_emp_m uuid;
  v_emp_member uuid;
  v_case uuid;
  v_count integer;
  v_type text;
  v_ok integer := 0;
  v_fail integer := 0;
  v_notes text := '';
begin
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, email_change, email_change_token_new, recovery_token
  )
  select '00000000-0000-0000-0000-000000000000', id, 'authenticated', 'authenticated',
         'um-5a-' || id::text || '@jordanfitness.com', '', now(),
         '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', ''
  from (values (v_admin), (v_owner), (v_director), (v_manager), (v_member)) as people(id);

  update public.profiles set role = 'staff', workspace_role = 'admin', access_granted = true, is_active = true where id = v_admin;
  update public.profiles set role = 'admin', workspace_role = 'owner', access_granted = true, is_active = true where id = v_owner;
  update public.profiles set role = 'staff', workspace_role = 'member', access_granted = true, is_active = true where id in (v_director, v_manager, v_member);
  update public.module_access set enabled = true where module_id = 'people' and profile_id in (v_admin, v_owner, v_director, v_manager, v_member);

  insert into hr.employees (profile_id, full_name, status) values (v_manager, 'Line Manager', 'active') returning id into v_emp_m;
  insert into hr.employees (profile_id, full_name, status, manager_id) values (v_member, 'Team Member', 'active', v_emp_m) returning id into v_emp_member;
  insert into hr.employees (profile_id, full_name, status) values (v_admin, 'Workspace Admin', 'active');
  insert into hr.employees (profile_id, full_name, status) values (v_owner, 'Workspace Owner', 'active');
  insert into hr.salaries (employee_id, amount, pay_basis, effective_from) values (v_emp_member, 28000, 'annual', '2026-05-01');
  insert into hr.directors (profile_id) values (v_director);
  insert into hr.cases (case_type, subject_employee_id, title, route, stage, opened_by)
  values ('grievance', v_emp_member, 'Director only case', 'director_only', 'raised', v_director)
  returning id into v_case;
  insert into hr.case_members (case_id, profile_id, member_role) values (v_case, v_director, 'owner');
  insert into public.calendar_entries (entry_type, profile_id, starts_on, ends_on, notes, request_status, created_by)
  values ('sick', v_member, '2026-12-01', '2026-12-01', 'private reason', 'confirmed', v_director);

  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  execute 'set local role authenticated';
  if hr.is_director() then v_fail := v_fail + 1; v_notes := v_notes || ' admin is director;'; else v_ok := v_ok + 1; end if;
  select count(*) into v_count from hr.employees where id = v_emp_member;
  if v_count = 0 then v_ok := v_ok + 1; else v_fail := v_fail + 1; v_notes := v_notes || ' admin read member;'; end if;
  select count(*) into v_count from hr.salaries where employee_id = v_emp_member;
  if v_count = 0 then v_ok := v_ok + 1; else v_fail := v_fail + 1; v_notes := v_notes || ' admin salary;'; end if;
  select count(*) into v_count from hr.cases where id = v_case;
  if v_count = 0 then v_ok := v_ok + 1; else v_fail := v_fail + 1; v_notes := v_notes || ' admin case;'; end if;
  select entry_type into v_type from public.calendar_entries_visible where profile_id = v_member and entry_type = 'sick';
  if v_type is null then v_ok := v_ok + 1; else v_fail := v_fail + 1; v_notes := v_notes || ' admin sick type;'; end if;
  select count(*) into v_count from hr.employees where profile_id = v_admin;
  if v_count = 1 then v_ok := v_ok + 1; else v_fail := v_fail + 1; v_notes := v_notes || ' admin own;'; end if;

  reset role;
  perform set_config('request.jwt.claim.sub', v_owner::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  execute 'set local role authenticated';
  if hr.is_director() then v_fail := v_fail + 1; v_notes := v_notes || ' owner is director;'; else v_ok := v_ok + 1; end if;
  select count(*) into v_count from hr.employees where id = v_emp_member;
  if v_count = 0 then v_ok := v_ok + 1; else v_fail := v_fail + 1; v_notes := v_notes || ' owner read member;'; end if;

  reset role;
  perform set_config('request.jwt.claim.sub', v_director::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_director, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  execute 'set local role authenticated';
  if hr.is_director() then v_ok := v_ok + 1; else v_fail := v_fail + 1; v_notes := v_notes || ' director false;'; end if;
  select count(*) into v_count from hr.employees;
  if v_count >= 4 then v_ok := v_ok + 1; else v_fail := v_fail + 1; v_notes := v_notes || ' director employees ' || v_count || ';'; end if;
  select count(*) into v_count from hr.salaries where employee_id = v_emp_member;
  if v_count = 1 then v_ok := v_ok + 1; else v_fail := v_fail + 1; v_notes := v_notes || ' director salary;'; end if;
  select count(*) into v_count from hr.cases where id = v_case;
  if v_count = 1 then v_ok := v_ok + 1; else v_fail := v_fail + 1; v_notes := v_notes || ' director case;'; end if;

  reset role;
  perform set_config('request.jwt.claim.sub', v_director::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_director, 'role', 'authenticated', 'aal', 'aal1')::text, true);
  execute 'set local role authenticated';
  select count(*) into v_count from hr.salaries where employee_id = v_emp_member;
  if v_count = 0 then v_ok := v_ok + 1; else v_fail := v_fail + 1; v_notes := v_notes || ' director aal1 salary;'; end if;

  reset role;
  perform set_config('request.jwt.claim.sub', v_manager::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_manager, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  execute 'set local role authenticated';
  select count(*) into v_count from hr.employees where id = v_emp_member;
  if v_count = 1 then v_ok := v_ok + 1; else v_fail := v_fail + 1; v_notes := v_notes || ' manager report;'; end if;
  select count(*) into v_count from hr.cases where id = v_case;
  if v_count = 0 then v_ok := v_ok + 1; else v_fail := v_fail + 1; v_notes := v_notes || ' manager case;'; end if;

  reset role;
  perform set_config('request.jwt.claim.sub', v_member::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_member, 'role', 'authenticated', 'aal', 'aal1')::text, true);
  execute 'set local role authenticated';
  select count(*) into v_count from hr.employees where profile_id = v_member;
  if v_count = 1 then v_ok := v_ok + 1; else v_fail := v_fail + 1; v_notes := v_notes || ' member self;'; end if;
  select count(*) into v_count from hr.employees where id = v_emp_m;
  if v_count = 0 then v_ok := v_ok + 1; else v_fail := v_fail + 1; v_notes := v_notes || ' member saw manager;'; end if;

  reset role;
  begin
    execute 'set local role anon';
    perform 1 from public.hr_employees;
    v_fail := v_fail + 1; v_notes := v_notes || ' anon read;';
  exception when insufficient_privilege then
    v_ok := v_ok + 1;
  end;

  raise exception 'RESULTS ok=% fail=% %', v_ok, v_fail, v_notes;
end
$$;
