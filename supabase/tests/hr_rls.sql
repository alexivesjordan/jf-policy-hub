-- HR Pulse and company-calendar privacy checks.
-- The block raises RESULTS and rolls back. Run on TEST as a role that can insert auth.users.

do $$
declare
  v_a uuid := gen_random_uuid();
  v_b uuid := gen_random_uuid();
  v_m uuid := gen_random_uuid();
  v_n uuid := gen_random_uuid();
  v_d uuid := gen_random_uuid();
  v_p uuid := gen_random_uuid();
  v_admin uuid := gen_random_uuid();
  v_emp_a uuid;
  v_emp_b uuid;
  v_emp_m uuid;
  v_case_p uuid;
  v_case_hidden uuid;
  v_sick uuid;
  v_leave uuid;
  v_ok integer := 0;
  v_fail integer := 0;
  v_notes text := '';
  v_count integer;
  v_type text;
  v_notes_text text;
  v_public boolean;
begin
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, email_change, email_change_token_new, recovery_token
  )
  select '00000000-0000-0000-0000-000000000000', id, 'authenticated', 'authenticated',
         'hr-test-' || id::text || '@jordanfitness.com', '', now(),
         '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', ''
  from (values (v_a), (v_b), (v_m), (v_n), (v_d), (v_p), (v_admin)) as people(id);

  update public.profiles set role = 'staff', workspace_role = 'member', access_granted = true, is_active = true where id in (v_a, v_b, v_m, v_n, v_p);
  update public.profiles set role = 'staff', workspace_role = 'admin', access_granted = true, is_active = true where id = v_d;
  update public.profiles set role = 'admin', workspace_role = 'admin', access_granted = true, is_active = true where id = v_admin;
  update public.module_access
  set enabled = true
  where module_id = 'people'
    and profile_id in (v_a, v_b, v_m, v_n, v_d, v_p, v_admin);

  insert into hr.employees (profile_id, full_name, status) values (v_m, 'Blake Morgan', 'active') returning id into v_emp_m;
  insert into hr.employees (profile_id, full_name, status, manager_id) values (v_a, 'Avery Quinn', 'active', v_emp_m) returning id into v_emp_a;
  insert into hr.employees (profile_id, full_name, status) values (v_b, 'Casey Reed', 'active') returning id into v_emp_b;
  insert into hr.salaries (employee_id, amount, pay_basis, effective_from) values (v_emp_a, 32000, 'annual', '2026-05-01');
  insert into hr.directors (profile_id) values (v_d);
  insert into hr.cases (case_type, subject_employee_id, title, route, stage, opened_by)
  values ('grievance', v_emp_b, 'Hidden case', 'director_only', 'raised', v_admin) returning id into v_case_hidden;
  insert into hr.cases (case_type, subject_employee_id, title, route, stage, opened_by)
  values ('flexible_working', v_emp_a, 'Hours change', 'manager', 'requested', v_a) returning id into v_case_p;
  insert into hr.case_members (case_id, profile_id, member_role) values (v_case_p, v_p, 'hr_partner');
  insert into public.calendar_entries (entry_type, profile_id, starts_on, ends_on, notes, request_status, created_by)
  values ('sick', v_a, '2026-11-19', '2026-11-19', 'private flu', 'confirmed', v_admin) returning id into v_sick;
  insert into public.calendar_entries (entry_type, profile_id, starts_on, ends_on, notes, request_status, created_by)
  values ('annual_leave', v_a, '2026-11-16', '2026-11-18', 'holiday note', 'confirmed', v_admin) returning id into v_leave;

  perform set_config('request.jwt.claim.sub', v_b::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_b, 'role', 'authenticated', 'aal', 'aal1')::text, true);
  execute 'set local role authenticated';
  select count(*) into v_count from hr.employees where id = v_emp_a;
  if v_count = 0 then v_ok := v_ok + 1; else v_fail := v_fail + 1; v_notes := v_notes || ' B read A;'; end if;
  select entry_type, notes into v_type, v_notes_text from public.calendar_entries_visible where id = v_sick;
  if v_type = 'off' and v_notes_text is null then v_ok := v_ok + 1; else v_fail := v_fail + 1; v_notes := v_notes || ' staff sick ' || coalesce(v_type, 'null') || ';'; end if;
  select entry_type, notes into v_type, v_notes_text from public.calendar_entries_visible where id = v_leave;
  if v_type = 'annual_leave' and v_notes_text is null then v_ok := v_ok + 1; else v_fail := v_fail + 1; v_notes := v_notes || ' staff leave notes;'; end if;
  begin
    perform entry_type from public.calendar_entries where id = v_sick;
    v_fail := v_fail + 1; v_notes := v_notes || ' staff selected sick type;';
  exception when insufficient_privilege then
    v_ok := v_ok + 1;
  end;

  reset role;
  perform set_config('request.jwt.claim.sub', v_m::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_m, 'role', 'authenticated', 'aal', 'aal1')::text, true);
  execute 'set local role authenticated';
  select count(*) into v_count from hr.salaries where employee_id = v_emp_a;
  if v_count = 0 then v_ok := v_ok + 1; else v_fail := v_fail + 1; v_notes := v_notes || ' aal1 manager read salary;'; end if;

  reset role;
  perform set_config('request.jwt.claim.sub', v_m::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_m, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  execute 'set local role authenticated';
  select count(*) into v_count from hr.salaries where employee_id = v_emp_a;
  if v_count = 1 then v_ok := v_ok + 1; else v_fail := v_fail + 1; v_notes := v_notes || ' manager missed salary;'; end if;
  select notes into v_notes_text from public.calendar_entries_visible where id = v_sick;
  if v_notes_text = 'private flu' then v_ok := v_ok + 1; else v_fail := v_fail + 1; v_notes := v_notes || ' manager missed sick note;'; end if;

  reset role;
  perform set_config('request.jwt.claim.sub', v_n::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_n, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  execute 'set local role authenticated';
  select count(*) into v_count from hr.employees where id = v_emp_a;
  if v_count = 0 then v_ok := v_ok + 1; else v_fail := v_fail + 1; v_notes := v_notes || ' N read A;'; end if;

  reset role;
  perform set_config('request.jwt.claim.sub', v_d::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_d, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  execute 'set local role authenticated';
  select count(*) into v_count from hr.employees where id = v_emp_a;
  if v_count = 1 then v_ok := v_ok + 1; else v_fail := v_fail + 1; v_notes := v_notes || ' director missed record;'; end if;
  select count(*) into v_count from hr.cases where id = v_case_hidden;
  if v_count = 0 then v_ok := v_ok + 1; else v_fail := v_fail + 1; v_notes := v_notes || ' director saw a case they are not on;'; end if;
  select entry_type into v_type from public.calendar_entries_visible where id = v_sick;
  if v_type = 'sick' then v_ok := v_ok + 1; else v_fail := v_fail + 1; v_notes := v_notes || ' director sick label;'; end if;

  reset role;
  perform set_config('request.jwt.claim.sub', v_p::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_p, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  execute 'set local role authenticated';
  select count(*) into v_count from hr.cases where id = v_case_p;
  if v_count = 1 then v_ok := v_ok + 1; else v_fail := v_fail + 1; v_notes := v_notes || ' partner missed own case;'; end if;
  select count(*) into v_count from hr.cases where id = v_case_hidden;
  if v_count = 0 then v_ok := v_ok + 1; else v_fail := v_fail + 1; v_notes := v_notes || ' partner saw another case;'; end if;
  select count(*) into v_count from hr.employees where id = v_emp_a;
  if v_count = 0 then v_ok := v_ok + 1; else v_fail := v_fail + 1; v_notes := v_notes || ' partner read a record;'; end if;

  reset role;
  perform set_config('request.jwt.claim.sub', v_a::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_a, 'role', 'authenticated', 'aal', 'aal1')::text, true);
  execute 'set local role authenticated';
  select notes into v_notes_text from public.calendar_entries_visible where id = v_leave;
  if v_notes_text = 'holiday note' then v_ok := v_ok + 1; else v_fail := v_fail + 1; v_notes := v_notes || ' self missed own note;'; end if;

  reset role;
  begin
    update hr.audit_log set action = 'tamper' where entity_table = 'employees';
    v_fail := v_fail + 1; v_notes := v_notes || ' audit updated;';
  exception when others then
    if sqlerrm ilike '%immutable%' then v_ok := v_ok + 1; else v_fail := v_fail + 1; v_notes := v_notes || ' audit ' || sqlerrm || ';'; end if;
  end;

  select b.public into v_public from storage.buckets b where b.id = 'hr-private';
  if v_public is false then v_ok := v_ok + 1; else v_fail := v_fail + 1; v_notes := v_notes || ' bucket public;'; end if;

  raise exception 'RESULTS ok=% fail=% %', v_ok, v_fail, v_notes;
end
$$;
