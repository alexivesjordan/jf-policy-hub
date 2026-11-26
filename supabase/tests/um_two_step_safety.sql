-- Two-step safety. Raises RESULTS and rolls back. Last TEST run: ok=14 fail=0.
-- An old owner is not redirected. A manager past the release grace is. The switch off stops every redirect.

do $$
declare
  v_owner uuid := gen_random_uuid();
  v_manager uuid := gen_random_uuid();
  v_report uuid := gen_random_uuid();
  v_plain uuid := gen_random_uuid();
  v_admin uuid := gen_random_uuid();
  v_mgr uuid;
  v_ok int := 0;
  v_fail int := 0;
  v_notes text := '';
  v_due boolean;
  v_notice boolean;
begin
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, email_change, email_change_token_new, recovery_token
  )
  select '00000000-0000-0000-0000-000000000000', id, 'authenticated', 'authenticated',
         'um-5c-' || id::text || '@jordanfitness.com', '', now(),
         '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', ''
  from (values (v_owner), (v_manager), (v_report), (v_plain), (v_admin)) as people(id);

  update public.profiles
  set role = 'staff', workspace_role = 'owner', access_granted = true, is_active = true, created_at = now() - interval '27 days'
  where id = v_owner;
  update public.profiles
  set role = 'staff', workspace_role = 'member', access_granted = true, is_active = true, created_at = now() - interval '30 days'
  where id in (v_manager, v_report, v_plain);
  update public.profiles
  set role = 'staff', workspace_role = 'admin', access_granted = true, is_active = true, created_at = now() - interval '20 days'
  where id = v_admin;

  insert into hr.employees (profile_id, full_name, status)
  values (v_manager, 'Safety Manager', 'active')
  returning id into v_mgr;
  insert into hr.employees (profile_id, full_name, status, manager_id)
  values (v_report, 'Safety Report', 'active', v_mgr);

  update core.security_policy set released_at = now(), enforcement_enabled = true where id = 1;

  perform set_config('request.jwt.claim.sub', v_owner::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated', 'aal', 'aal1')::text, true);
  execute 'set local role authenticated';
  v_due := public.two_step_due();
  v_notice := public.two_step_owner_notice();
  if v_due = false and v_notice = false then v_ok := v_ok + 1; else v_fail := v_fail + 1; v_notes := v_notes || ' fresh release;'; end if;

  reset role;
  update core.security_policy set released_at = now() - interval '8 days', enforcement_enabled = true where id = 1;

  perform set_config('request.jwt.claim.sub', v_owner::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated', 'aal', 'aal1')::text, true);
  execute 'set local role authenticated';
  v_due := public.two_step_due();
  v_notice := public.two_step_owner_notice();
  if v_due = false and v_notice = true then v_ok := v_ok + 1; else v_fail := v_fail + 1; v_notes := v_notes || ' owner banner;'; end if;

  reset role;
  perform set_config('request.jwt.claim.sub', v_manager::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_manager, 'role', 'authenticated', 'aal', 'aal1')::text, true);
  execute 'set local role authenticated';
  if public.two_step_due() = true and public.two_step_owner_notice() = false then v_ok := v_ok + 1; else v_fail := v_fail + 1; v_notes := v_notes || ' manager due;'; end if;
  begin
    perform public.set_two_step_enforcement(false);
    v_fail := v_fail + 1; v_notes := v_notes || ' member switched;';
  exception when others then
    if sqlerrm ilike '%owner%' then v_ok := v_ok + 1; else v_fail := v_fail + 1; v_notes := v_notes || ' switch err;'; end if;
  end;
  begin
    update core.security_policy set enforcement_enabled = false where id = 1;
    v_fail := v_fail + 1; v_notes := v_notes || ' direct write;';
  exception when insufficient_privilege then
    v_ok := v_ok + 1;
  end;

  reset role;
  perform set_config('request.jwt.claim.sub', v_plain::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_plain, 'role', 'authenticated', 'aal', 'aal1')::text, true);
  execute 'set local role authenticated';
  if public.two_step_due() = false then v_ok := v_ok + 1; else v_fail := v_fail + 1; v_notes := v_notes || ' plain member;'; end if;

  reset role;
  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated', 'aal', 'aal1')::text, true);
  execute 'set local role authenticated';
  if public.two_step_due() = true then v_ok := v_ok + 1; else v_fail := v_fail + 1; v_notes := v_notes || ' admin due;'; end if;

  reset role;
  perform set_config('request.jwt.claim.sub', v_owner::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated', 'aal', 'aal1')::text, true);
  execute 'set local role authenticated';
  perform public.set_two_step_enforcement(false);
  if public.two_step_enforcement() = false and public.two_step_owner_notice() = false then v_ok := v_ok + 1; else v_fail := v_fail + 1; v_notes := v_notes || ' switch off owner;'; end if;

  reset role;
  perform set_config('request.jwt.claim.sub', v_manager::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_manager, 'role', 'authenticated', 'aal', 'aal1')::text, true);
  execute 'set local role authenticated';
  if public.two_step_due() = false then v_ok := v_ok + 1; else v_fail := v_fail + 1; v_notes := v_notes || ' switch off manager;'; end if;

  reset role;
  perform set_config('request.jwt.claim.sub', v_owner::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated', 'aal', 'aal1')::text, true);
  execute 'set local role authenticated';
  perform public.set_two_step_enforcement(true);

  reset role;
  perform set_config('request.jwt.claim.sub', v_manager::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_manager, 'role', 'authenticated', 'aal', 'aal1', 'session_id', v_manager)::text, true);
  execute 'set local role authenticated';
  begin
    perform public.email_code_start('12');
    v_fail := v_fail + 1; v_notes := v_notes || ' short code;';
  exception when others then
    if sqlerrm ilike '%6-digit%' then v_ok := v_ok + 1; else v_fail := v_fail + 1; v_notes := v_notes || ' start shape;'; end if;
  end;
  perform public.email_code_start('123456');
  if public.email_code_verify('000000') = false and public.two_step_due() = true then v_ok := v_ok + 1; else v_fail := v_fail + 1; v_notes := v_notes || ' wrong code;'; end if;
  if public.email_code_verify('123456') = true then v_ok := v_ok + 1; else v_fail := v_fail + 1; v_notes := v_notes || ' verify;'; end if;
  if public.two_step_due() = false then v_ok := v_ok + 1; else v_fail := v_fail + 1; v_notes := v_notes || ' session;'; end if;

  reset role;
  begin
    execute 'set local role anon';
    perform public.two_step_due();
    v_fail := v_fail + 1; v_notes := v_notes || ' anon;';
  exception when insufficient_privilege then
    v_ok := v_ok + 1;
  end;

  raise exception 'RESULTS ok=% fail=% %', v_ok, v_fail, v_notes;
end
$$;
