-- Member activity: email match, admin gate, sign-in writes, invite writes.
-- Raises RESULTS and rolls back. Run on TEST after 20261127400000.

do $$
declare
  v_admin uuid := gen_random_uuid();
  v_owner uuid := gen_random_uuid();
  v_member uuid := gen_random_uuid();
  v_target uuid := gen_random_uuid();
  v_quiet uuid := gen_random_uuid();
  v_mail text;
  v_mixed text;
  v_grant text := 'activity-3221-grant-' || left(gen_random_uuid()::text, 8) || '@jordanfitness.com';
  v_other text := 'activity-3221-other-' || left(gen_random_uuid()::text, 8) || '@jordanfitness.com';
  v_invite uuid;
  v_row jsonb;
  v_next jsonb;
  v_count int;
  v_ok int := 0;
  v_fail int := 0;
  v_notes text := '';
  v_cursor timestamptz;
begin
  perform set_config('orbit.profile_sync', 'on', true);

  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, email_change, email_change_token_new, recovery_token
  )
  select '00000000-0000-0000-0000-000000000000', id, 'authenticated', 'authenticated',
         'activity-3221-' || left(id::text, 8) || '@jordanfitness.com', '', now(),
         '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', ''
  from (values (v_admin), (v_owner), (v_member), (v_target), (v_quiet)) as people(id);

  update public.profiles set first_name = 'Ada', last_name = 'Admin', role = 'staff', workspace_role = 'admin', access_mode = 'follow', access_granted = true, is_active = true where id = v_admin;
  update public.profiles set first_name = 'Owen', last_name = 'Owner', role = 'staff', workspace_role = 'owner', access_mode = 'follow', access_granted = true, is_active = true where id = v_owner;
  update public.profiles set first_name = 'Mia', last_name = 'Member', role = 'staff', workspace_role = 'member', access_mode = 'follow', access_granted = true, is_active = true where id = v_member;
  update public.profiles set first_name = 'Sam', last_name = 'Target', role = 'staff', workspace_role = 'member', access_mode = 'follow', access_granted = true, is_active = true where id = v_target;
  update public.profiles set first_name = 'Quin', last_name = 'Quiet', role = 'staff', workspace_role = 'member', access_mode = 'follow', access_granted = true, is_active = true where id = v_quiet;
  select lower(email) into v_mail from public.profiles where id = v_target;
  v_mixed := replace(overlay(v_mail placing 'A' from 1 for 1), '@jordanfitness.com', '@JordanFitness.com');

  perform set_config('request.jwt.claim.sub', v_member::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_member, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    perform public.workspace_member_activity(v_target);
    v_fail := v_fail + 1; v_notes := v_notes || ' member allowed;';
  exception when others then
    if sqlerrm ilike '%owner or admin%' then v_ok := v_ok + 1; else v_fail := v_fail + 1; v_notes := v_notes || ' member;'; end if;
  end;
  begin
    perform public.workspace_log_invite_resent(v_mail);
    v_fail := v_fail + 1; v_notes := v_notes || ' resent member;';
  exception when others then
    if sqlerrm ilike '%owner or admin%' then v_ok := v_ok + 1; else v_fail := v_fail + 1; v_notes := v_notes || ' resent-deny;'; end if;
  end;

  reset role;
  if has_function_privilege('anon', 'public.workspace_member_activity(uuid, integer, timestamp with time zone)', 'execute')
     or has_function_privilege('public', 'public.workspace_member_activity(uuid, integer, timestamp with time zone)', 'execute')
  then v_fail := v_fail + 1; v_notes := v_notes || ' anon-grant;'; else v_ok := v_ok + 1; end if;
  if has_function_privilege('authenticated', 'public.workspace_member_activity(uuid, integer, timestamp with time zone)', 'execute')
     and has_function_privilege('service_role', 'public.workspace_member_activity(uuid, integer, timestamp with time zone)', 'execute')
  then v_ok := v_ok + 1; else v_fail := v_fail + 1; v_notes := v_notes || ' grants;'; end if;
  begin
    execute 'set local role anon';
    perform public.workspace_member_activity(v_target);
    v_fail := v_fail + 1; v_notes := v_notes || ' anon;';
  exception when insufficient_privilege then
    v_ok := v_ok + 1;
  end;
  reset role;

  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    perform public.workspace_member_activity(gen_random_uuid());
    v_fail := v_fail + 1; v_notes := v_notes || ' missing;';
  exception when others then
    if sqlerrm ilike '%not found%' then v_ok := v_ok + 1; else v_fail := v_fail + 1; v_notes := v_notes || ' missing;'; end if;
  end;
  v_row := public.workspace_member_activity(v_member);
  if v_row = '[]'::jsonb then v_ok := v_ok + 1; else v_fail := v_fail + 1; v_notes := v_notes || ' empty;'; end if;

  reset role;
  insert into public.access_audit_log (actor_id, action, entity_type, entity_id, before, after, created_at)
  values
    (v_admin, 'user.invited', 'profile', null, null, jsonb_build_object('email', v_mixed), timestamptz '2026-03-02 09:00:00+00'),
    (v_admin, 'user.invited', 'profile', null, null, jsonb_build_object('email', v_other), timestamptz '2026-03-03 09:00:00+00'),
    (v_admin, 'job.status_changed', 'install_job', v_target, null, jsonb_build_object('status', 'live'), timestamptz '2026-03-04 09:00:00+00');
  insert into public.audit_log (actor_id, action, entity_type, entity_id, details, created_at)
  values
    (v_admin, 'user.role_changed', 'profile', v_target, jsonb_build_object('from_role', 'staff', 'to_role', 'admin'), timestamptz '2026-02-01 09:00:00+00'),
    (v_admin, 'user.module_changed', 'profile', v_target, jsonb_build_object('module_id', 'sales'), timestamptz '2026-02-02 09:00:00+00'),
    (v_admin, 'user.deactivated', 'profile', v_target, jsonb_build_object('email', v_mail), timestamptz '2026-02-03 09:00:00+00'),
    (v_admin, 'user.reactivated', 'profile', v_target, jsonb_build_object('email', v_mail), timestamptz '2026-02-04 09:00:00+00');

  execute 'set local role authenticated';
  v_row := public.workspace_member_activity(v_target, 200, null);
  if exists (
    select 1 from jsonb_array_elements(v_row) item
    where item->>'action' = 'user.invited'
      and item->>'entity_id' is null
      and lower(item->'after'->>'email') = v_mail
  ) then v_ok := v_ok + 1; else v_fail := v_fail + 1; v_notes := v_notes || ' email-match;'; end if;
  if exists (select 1 from jsonb_array_elements(v_row) item where item->>'action' = 'user.role_changed')
     and exists (select 1 from jsonb_array_elements(v_row) item where item->>'action' = 'user.module_changed')
     and exists (select 1 from jsonb_array_elements(v_row) item where item->>'action' = 'user.deactivated')
  then v_ok := v_ok + 1; else v_fail := v_fail + 1; v_notes := v_notes || ' old-audit;'; end if;
  if exists (select 1 from jsonb_array_elements(v_row) item where item->>'action' in ('user.reactivated', 'job.status_changed'))
     or exists (select 1 from jsonb_array_elements(v_row) item where lower(item->'after'->>'email') = v_other)
  then v_fail := v_fail + 1; v_notes := v_notes || ' leaked;'; else v_ok := v_ok + 1; end if;
  if v_row->0 ? 'id' and v_row->0 ? 'at' and v_row->0 ? 'actor_name' and v_row->0 ? 'before' and v_row->0 ? 'after'
  then v_ok := v_ok + 1; else v_fail := v_fail + 1; v_notes := v_notes || ' shape;'; end if;

  perform public.workspace_prepare_invite(v_mail, 'Sam', 'Target', 'member');
  perform public.workspace_log_invite_resent(v_mail);
  v_invite := public.create_invitation(v_other, 'member', null, null);
  perform public.revoke_invitation(v_invite);
  reset role;
  select count(*) into v_count
  from public.access_audit_log
  where action = 'user.invited' and entity_id = v_target and after->>'email' = v_mail;
  if v_count = 1 then v_ok := v_ok + 1; else v_fail := v_fail + 1; v_notes := v_notes || ' prepare;'; end if;
  select count(*) into v_count
  from public.access_audit_log
  where action = 'user.invite_resent' and entity_id = v_target and after->>'email' = v_mail;
  if v_count = 1 then v_ok := v_ok + 1; else v_fail := v_fail + 1; v_notes := v_notes || ' resent-write;'; end if;
  select count(*) into v_count
  from public.access_audit_log
  where action = 'user.invited' and entity_id is null and after->>'email' = v_other and after->>'kind' = 'member';
  if v_count = 1 then v_ok := v_ok + 1; else v_fail := v_fail + 1; v_notes := v_notes || ' create;'; end if;
  select count(*) into v_count
  from public.access_audit_log
  where action = 'user.invite_revoked' and after->>'email' = v_other;
  if v_count = 1 then v_ok := v_ok + 1; else v_fail := v_fail + 1; v_notes := v_notes || ' revoke-invitation;'; end if;
  execute 'set local role authenticated';

  reset role;
  insert into public.access_grants (email, full_name, first_name, last_name, role, people_enabled)
  values (v_grant, 'Grant Person', 'Grant', 'Person', 'staff', true);
  execute 'set local role authenticated';
  perform public.workspace_revoke_invite(v_grant);
  reset role;
  select count(*) into v_count
  from public.access_audit_log
  where action = 'user.invite_revoked' and entity_id is null and after->>'email' = v_grant;
  if v_count = 1 then v_ok := v_ok + 1; else v_fail := v_fail + 1; v_notes := v_notes || ' revoke-grant;'; end if;

  reset role;
  update auth.users set last_sign_in_at = timestamptz '2026-11-01 09:00:00+00' where id = v_target;
  select count(*) into v_count from public.access_audit_log where action = 'user.signed_in' and entity_id = v_target;
  if v_count = 1 then v_ok := v_ok + 1; else v_fail := v_fail + 1; v_notes := v_notes || ' sign-1;'; end if;
  update auth.users set last_sign_in_at = timestamptz '2026-11-01 09:00:00+00' where id = v_target;
  select count(*) into v_count from public.access_audit_log where action = 'user.signed_in' and entity_id = v_target;
  if v_count = 1 then v_ok := v_ok + 1; else v_fail := v_fail + 1; v_notes := v_notes || ' sign-same;'; end if;
  update auth.users set last_sign_in_at = timestamptz '2026-11-02 09:00:00+00' where id = v_target;
  select count(*) into v_count from public.access_audit_log where action = 'user.signed_in' and entity_id = v_target;
  if v_count = 2 then v_ok := v_ok + 1; else v_fail := v_fail + 1; v_notes := v_notes || ' sign-2;'; end if;

  update public.profiles set last_sign_in_at = timestamptz '2026-08-01 10:00:00+00' where id = v_quiet;
  select count(*) into v_count from public.access_audit_log where action = 'user.signed_in' and entity_id = v_quiet;
  if v_count = 0 then v_ok := v_ok + 1; else v_fail := v_fail + 1; v_notes := v_notes || ' synthetic-row;'; end if;

  perform set_config('request.jwt.claim.sub', v_owner::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_row := public.workspace_member_activity(v_quiet, 50, null);
  if exists (
    select 1 from jsonb_array_elements(v_row) item
    where item->>'action' = 'user.signed_in'
      and (item->>'at')::timestamptz = timestamptz '2026-08-01 10:00:00+00'
      and not exists (select 1 from public.access_audit_log a where a.id = (item->>'id')::uuid)
  ) then v_ok := v_ok + 1; else v_fail := v_fail + 1; v_notes := v_notes || ' synthetic;'; end if;
  if jsonb_typeof(public.workspace_member_activity(v_target, 20, null)) = 'array' then v_ok := v_ok + 1; else v_fail := v_fail + 1; v_notes := v_notes || ' owner;'; end if;

  reset role;
  insert into public.access_audit_log (actor_id, action, entity_type, entity_id, after, created_at)
  select v_admin, 'user.name_changed', 'profile', v_quiet, jsonb_build_object('n', g),
         timestamptz '2024-01-01 00:00:00+00' + (g || ' minutes')::interval
  from generate_series(1, 55) as g;

  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_row := public.workspace_member_activity(v_quiet, 50, null);
  if jsonb_array_length(v_row) = 50 then v_ok := v_ok + 1; else v_fail := v_fail + 1; v_notes := v_notes || ' page;'; end if;
  v_cursor := (v_row->49->>'at')::timestamptz;
  v_next := public.workspace_member_activity(v_quiet, 50, v_cursor);
  if jsonb_array_length(v_next) > 0
     and not exists (
       select 1
       from jsonb_array_elements(v_next) item
       where (item->>'at')::timestamptz >= v_cursor
          or exists (select 1 from jsonb_array_elements(v_row) earlier where earlier->>'id' = item->>'id')
     )
  then v_ok := v_ok + 1; else v_fail := v_fail + 1; v_notes := v_notes || ' before;'; end if;

  raise exception 'RESULTS ok=% fail=% %', v_ok, v_fail, v_notes;
end
$$;
