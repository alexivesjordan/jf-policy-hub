-- Load plan RLS. Raises RESULTS and rolls the test rows back.
-- Run after 20261129100000, as a role that can insert auth.users.
-- A logistics admin can change container and vehicle spaces.
-- A logistics view user can read and save plans, and cannot change load spaces.

do $$
declare
  v_admin uuid := gen_random_uuid();
  v_view uuid := gen_random_uuid();
  v_outsider uuid := gen_random_uuid();
  v_ok integer := 0;
  v_fail integer := 0;
  v_notes text := '';
  v_height integer;
  v_count integer;
  v_flag boolean;
  v_plan uuid;
begin
  perform set_config('orbit.profile_sync', 'on', true);

  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, email_change, email_change_token_new, recovery_token
  ) values
    ('00000000-0000-0000-0000-000000000000', v_admin, 'authenticated', 'authenticated',
     'load-admin-' || v_admin::text || '@example.com', '', now(),
     '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', ''),
    ('00000000-0000-0000-0000-000000000000', v_view, 'authenticated', 'authenticated',
     'load-view-' || v_view::text || '@example.com', '', now(),
     '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', ''),
    ('00000000-0000-0000-0000-000000000000', v_outsider, 'authenticated', 'authenticated',
     'load-out-' || v_outsider::text || '@example.com', '', now(),
     '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', '');

  update public.profiles
  set role = 'staff', workspace_role = 'member', access_mode = 'custom', access_granted = true, is_active = true
  where id in (v_admin, v_view, v_outsider);

  insert into public.module_access (profile_id, module_id, enabled, access_level)
  values
    (v_admin, 'logistics', true, 'admin'),
    (v_admin, 'operations', true, 'view'),
    (v_view, 'logistics', true, 'view'),
    (v_view, 'operations', true, 'view'),
    (v_outsider, 'logistics', false, 'none'),
    (v_outsider, 'operations', false, 'none')
  on conflict (profile_id, module_id) do update
  set enabled = excluded.enabled, access_level = excluded.access_level;

  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  select public.logistics_can_admin_spaces() into v_flag;
  if v_flag then v_ok := v_ok + 1; else v_fail := v_fail + 1; v_notes := v_notes || ' admin flag;'; end if;

  begin
    update logistics.load_spaces set height_cm = 240 where code = 'container-20dc';
    get diagnostics v_count = row_count;
    select height_cm into v_height from logistics.load_spaces where code = 'container-20dc';
    if v_count = 1 and v_height = 240 then v_ok := v_ok + 1; else v_fail := v_fail + 1; v_notes := v_notes || ' admin container edit;'; end if;
  exception when others then
    v_fail := v_fail + 1;
    v_notes := v_notes || ' admin container ' || sqlerrm || ';';
  end;

  begin
    update logistics.load_spaces set name = 'UK standard changed' where code = 'uk-standard';
    get diagnostics v_count = row_count;
    if v_count = 0 then v_ok := v_ok + 1; else v_fail := v_fail + 1; v_notes := v_notes || ' pallet edit allowed;'; end if;
  exception when others then
    v_fail := v_fail + 1;
    v_notes := v_notes || ' pallet edit ' || sqlerrm || ';';
  end;

  begin
    insert into logistics.load_spaces (code, kind, name, length_cm, width_cm, height_cm, max_weight_kg, tare_kg, deck_cm, sort_order)
    values ('pallet-extra', 'pallet', 'Extra pallet', 120, 100, 180, 800, 25, 15, 90);
    v_fail := v_fail + 1;
    v_notes := v_notes || ' pallet insert allowed;';
  exception when others then
    if sqlerrm ilike '%row-level security%' then v_ok := v_ok + 1; else v_fail := v_fail + 1; v_notes := v_notes || ' pallet insert ' || sqlerrm || ';'; end if;
  end;

  begin
    insert into logistics.load_spaces (code, kind, name, length_cm, width_cm, height_cm, max_weight_kg, sort_order)
    values ('van-measured', 'vehicle', 'Measured van', 410, 170, 175, 1100, 80);
    v_ok := v_ok + 1;
  exception when others then
    v_fail := v_fail + 1;
    v_notes := v_notes || ' vehicle insert ' || sqlerrm || ';';
  end;

  begin
    insert into logistics.load_plans (name, space_code, reference, pieces, summary, created_by)
    values (
      'SO fixture',
      'container-20dc',
      'SO-FIXTURE',
      '[{"sku":"RACK","qty":1}]'::jsonb,
      '{"version":1}'::jsonb,
      v_admin
    )
    returning id into v_plan;
    if v_plan is not null then v_ok := v_ok + 1; else v_fail := v_fail + 1; v_notes := v_notes || ' plan id;'; end if;
  exception when others then
    v_fail := v_fail + 1;
    v_notes := v_notes || ' admin plan ' || sqlerrm || ';';
  end;

  begin
    update logistics.load_plans set created_by = v_view where id = v_plan;
    v_fail := v_fail + 1;
    v_notes := v_notes || ' author change allowed;';
  exception when others then
    if sqlerrm ilike '%author%' then v_ok := v_ok + 1; else v_fail := v_fail + 1; v_notes := v_notes || ' author ' || sqlerrm || ';'; end if;
  end;

  reset role;
  perform set_config('request.jwt.claim.sub', v_view::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_view, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  select public.logistics_can_admin_spaces() into v_flag;
  if v_flag then v_fail := v_fail + 1; v_notes := v_notes || ' view flag true;'; else v_ok := v_ok + 1; end if;

  select height_cm into v_height from logistics.load_spaces where code = 'container-20dc';
  if v_height = 240 then v_ok := v_ok + 1; else v_fail := v_fail + 1; v_notes := v_notes || ' view read space;'; end if;

  begin
    update logistics.load_spaces set height_cm = 200 where code = 'container-20dc';
    get diagnostics v_count = row_count;
    select height_cm into v_height from logistics.load_spaces where code = 'container-20dc';
    if v_count = 0 and v_height = 240 then v_ok := v_ok + 1; else v_fail := v_fail + 1; v_notes := v_notes || ' view edited space;'; end if;
  exception when others then
    v_fail := v_fail + 1;
    v_notes := v_notes || ' view update ' || sqlerrm || ';';
  end;

  begin
    insert into logistics.load_spaces (code, kind, name, length_cm, width_cm, height_cm, max_weight_kg)
    values ('van-view', 'vehicle', 'View van', 300, 160, 160, 800);
    v_fail := v_fail + 1;
    v_notes := v_notes || ' view insert space;';
  exception when others then
    if sqlerrm ilike '%row-level security%' then v_ok := v_ok + 1; else v_fail := v_fail + 1; v_notes := v_notes || ' view insert ' || sqlerrm || ';'; end if;
  end;

  select count(*) into v_count from logistics.load_plans where id = v_plan;
  if v_count = 1 then v_ok := v_ok + 1; else v_fail := v_fail + 1; v_notes := v_notes || ' view read plan;'; end if;

  begin
    insert into logistics.load_plans (name, space_code, reference, pieces, summary, created_by)
    values ('View plan', 'van-lwb', 'PO-FIXTURE', '[]'::jsonb, '{}'::jsonb, v_view);
    v_ok := v_ok + 1;
  exception when others then
    v_fail := v_fail + 1;
    v_notes := v_notes || ' view plan ' || sqlerrm || ';';
  end;

  begin
    insert into logistics.load_plans (name, space_code, reference, pieces, summary, created_by)
    values ('Stolen', 'van-lwb', '', '[]'::jsonb, '{}'::jsonb, v_admin);
    v_fail := v_fail + 1;
    v_notes := v_notes || ' forged author allowed;';
  exception when others then
    if sqlerrm ilike '%row-level security%' then v_ok := v_ok + 1; else v_fail := v_fail + 1; v_notes := v_notes || ' forged author ' || sqlerrm || ';'; end if;
  end;

  reset role;
  perform set_config('request.jwt.claim.sub', v_outsider::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_outsider, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  select count(*) into v_count from logistics.load_plans;
  if v_count = 0 then v_ok := v_ok + 1; else v_fail := v_fail + 1; v_notes := v_notes || ' outsider read ' || v_count::text || ';'; end if;

  begin
    insert into logistics.load_plans (name, space_code, reference, pieces, summary, created_by)
    values ('Out', 'van-lwb', '', '[]'::jsonb, '{}'::jsonb, v_outsider);
    v_fail := v_fail + 1;
    v_notes := v_notes || ' outsider insert allowed;';
  exception when others then
    if sqlerrm ilike '%row-level security%' then v_ok := v_ok + 1; else v_fail := v_fail + 1; v_notes := v_notes || ' outsider insert ' || sqlerrm || ';'; end if;
  end;

  reset role;
  begin
    execute 'set local role anon';
    perform 1 from logistics.load_plans;
    v_fail := v_fail + 1;
    v_notes := v_notes || ' anon read allowed;';
  exception when insufficient_privilege then
    v_ok := v_ok + 1;
  when others then
    v_fail := v_fail + 1;
    v_notes := v_notes || ' anon ' || sqlerrm || ';';
  end;

  raise exception 'RESULTS: passed=% failed=% %', v_ok, v_fail, v_notes;
end $$;
