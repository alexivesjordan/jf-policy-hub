-- Member detail is owner or admin only, labels the source, and returns no HR fields.
-- Raises RESULTS and rolls back. Run on TEST after 20261127110000.

do $$
declare
  v_admin uuid := gen_random_uuid();
  v_member uuid := gen_random_uuid();
  v_custom uuid := gen_random_uuid();
  v_row jsonb;
  v_ok int := 0;
  v_fail int := 0;
  v_notes text := '';
  v_source text;
begin
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, email_change, email_change_token_new, recovery_token
  )
  select '00000000-0000-0000-0000-000000000000', id, 'authenticated', 'authenticated',
         'um-2-' || id::text || '@jordanfitness.com', '', now(),
         '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', ''
  from (values (v_admin), (v_member), (v_custom)) as people(id);

  update public.profiles set role = 'staff', workspace_role = 'admin', access_mode = 'follow', access_granted = true, is_active = true where id = v_admin;
  update public.profiles set role = 'staff', workspace_role = 'member', access_mode = 'follow', access_granted = true, is_active = true where id = v_member;
  update public.profiles set role = 'staff', workspace_role = 'member', access_mode = 'custom', access_granted = true, is_active = true where id = v_custom;
  update public.module_access set enabled = true, access_level = 'view' where profile_id = v_custom and module_id = 'sales';

  perform set_config('request.jwt.claim.sub', v_member::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_member, 'role', 'authenticated', 'aal', 'aal1')::text, true);
  execute 'set local role authenticated';
  begin
    perform public.workspace_member(v_admin);
    v_fail := v_fail + 1; v_notes := v_notes || ' member allowed;';
  exception when others then
    if sqlerrm ilike '%owner or admin%' then v_ok := v_ok + 1; else v_fail := v_fail + 1; v_notes := v_notes || sqlerrm || ';'; end if;
  end;

  reset role;
  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  execute 'set local role authenticated';
  v_row := public.workspace_member(v_admin);
  if v_row ? 'salary' or v_row ? 'employee' or v_row ? 'employee_id' then
    v_fail := v_fail + 1; v_notes := v_notes || ' hr leak;';
  else
    v_ok := v_ok + 1;
  end if;
  select item->>'source' into v_source from jsonb_array_elements(v_row->'access') item where item->>'pulse' = 'people';
  if v_source = 'Admin' then v_ok := v_ok + 1; else v_fail := v_fail + 1; v_notes := v_notes || ' admin source;'; end if;
  v_row := public.workspace_member(v_custom);
  select item->>'source' into v_source from jsonb_array_elements(v_row->'access') item where item->>'pulse' = 'sales';
  if v_source = 'Override' then v_ok := v_ok + 1; else v_fail := v_fail + 1; v_notes := v_notes || ' override;'; end if;
  if jsonb_array_length(public.workspace_member_list()) >= 3 then v_ok := v_ok + 1; else v_fail := v_fail + 1; v_notes := v_notes || ' list;'; end if;

  reset role;
  begin
    execute 'set local role anon';
    perform public.workspace_member(v_admin);
    v_fail := v_fail + 1; v_notes := v_notes || ' anon;';
  exception when insufficient_privilege then
    v_ok := v_ok + 1;
  end;

  raise exception 'RESULTS ok=% fail=% %', v_ok, v_fail, v_notes;
end
$$;
