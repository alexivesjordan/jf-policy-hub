-- Packaging RLS. Raises RESULTS and rolls back.
-- Run after 20261128200000, as a role that can insert auth.users.

do $$
declare
  v_admin uuid := gen_random_uuid();
  v_engineer uuid := gen_random_uuid();
  v_ok integer := 0;
  v_fail integer := 0;
  v_notes text := '';
  v_count integer;
  v_length integer;
  v_seed integer;
begin
  perform set_config('orbit.profile_sync', 'on', true);

  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, email_change, email_change_token_new, recovery_token
  ) values
    ('00000000-0000-0000-0000-000000000000', v_admin, 'authenticated', 'authenticated',
     'pack-admin-' || v_admin::text || '@example.com', '', now(),
     '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', ''),
    ('00000000-0000-0000-0000-000000000000', v_engineer, 'authenticated', 'authenticated',
     'pack-installer-' || v_engineer::text || '@example.com', '', now(),
     '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', '');

  update public.profiles
  set role = 'admin', workspace_role = 'admin', access_granted = true, is_active = true
  where id = v_admin;
  update public.profiles
  set role = 'staff', workspace_role = 'member', access_granted = true, is_active = true
  where id = v_engineer;
  insert into ops.resources (resource_type, name, profile_id, status)
  values ('installer', 'Pack installer', v_engineer, 'active');

  if (select count(*) from logistics.load_spaces where kind = 'pallet') >= 2 then
    v_ok := v_ok + 1;
  else
    v_fail := v_fail + 1;
    v_notes := v_notes || ' pallet catalogue;';
  end if;
  if (select count(*) from logistics.load_spaces where kind in ('container', 'vehicle')) >= 4 then
    v_ok := v_ok + 1;
  else
    v_fail := v_fail + 1;
    v_notes := v_notes || ' load spaces;';
  end if;

  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  begin
    perform public.logistics_seed_sku_packages(jsonb_build_array(
      jsonb_build_object('sku', 'PACK-1', 'product_name', 'Bench', 'cin7_category', 'Benches', 'cin7_product_id', 'p1')
    ));
    insert into logistics.sku_packages (sku, product_name, package_no, length_cm, width_cm, height_cm, gross_weight_kg)
    values ('PACK-1', 'Bench', 1, 40, 30, 20, 12.5)
    on conflict (sku, package_no) do update
    set length_cm = 40, width_cm = 30, height_cm = 20, gross_weight_kg = 12.5;
    v_ok := v_ok + 1;
  exception when others then
    v_fail := v_fail + 1;
    v_notes := v_notes || ' admin write ' || sqlerrm || ';';
  end;

  select length_cm into v_length from logistics.sku_packages where sku = 'PACK-1' and package_no = 1;
  if v_length = 40 then v_ok := v_ok + 1; else v_fail := v_fail + 1; v_notes := v_notes || ' length missing;'; end if;

  begin
    perform public.logistics_seed_sku_packages(jsonb_build_array(
      jsonb_build_object('sku', 'PACK-1', 'product_name', 'Bench renamed', 'cin7_category', 'Benches')
    ));
    select length_cm into v_length from logistics.sku_packages where sku = 'PACK-1' and package_no = 1;
    if v_length = 40 then v_ok := v_ok + 1; else v_fail := v_fail + 1; v_notes := v_notes || ' seed overwrote dimensions;'; end if;
  exception when others then
    v_fail := v_fail + 1;
    v_notes := v_notes || ' reseed ' || sqlerrm || ';';
  end;

  select (public.logistics_list_sku_packages('PACK-1', false, 10, 0)->>'total')::integer into v_count;
  if v_count = 1 then v_ok := v_ok + 1; else v_fail := v_fail + 1; v_notes := v_notes || ' list ' || coalesce(v_count::text, 'null') || ';'; end if;

  select public.logistics_import_sku_packages(jsonb_build_array(
    jsonb_build_object('sku', 'PACK-1', 'package_no', 2, 'length_cm', 10, 'width_cm', 10, 'height_cm', 10, 'gross_weight_kg', '1.5', 'stackable', true, 'ships_on_pallet_only', true)
  )) into v_seed;
  if v_seed = 1 then v_ok := v_ok + 1; else v_fail := v_fail + 1; v_notes := v_notes || ' import count;'; end if;

  begin
    perform public.logistics_import_sku_packages(jsonb_build_array(
      jsonb_build_object('sku', 'PACK-BAD', 'package_no', 1, 'gross_weight_kg', '1.25')
    ));
    v_fail := v_fail + 1;
    v_notes := v_notes || ' bad weight imported;';
  exception when others then
    if sqlerrm ilike '%one decimal%' then v_ok := v_ok + 1; else v_fail := v_fail + 1; v_notes := v_notes || ' bad weight ' || sqlerrm || ';'; end if;
  end;

  reset role;
  perform set_config('request.jwt.claim.sub', v_engineer::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_engineer, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  begin
    insert into logistics.sku_packages (sku, product_name, package_no) values ('PACK-NO', 'Denied', 1);
    v_fail := v_fail + 1;
    v_notes := v_notes || ' installer insert allowed;';
  exception when others then
    v_ok := v_ok + 1;
  end;

  begin
    perform public.logistics_list_sku_packages('', false, 10, 0);
    v_fail := v_fail + 1;
    v_notes := v_notes || ' installer list allowed;';
  exception when others then
    v_ok := v_ok + 1;
  end;

  reset role;
  begin
    execute 'set local role anon';
    perform 1 from logistics.sku_packages;
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
