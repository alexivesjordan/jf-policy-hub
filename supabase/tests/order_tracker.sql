-- Order tracker access. Raises RESULTS and rolls back.
-- Run on TEST as a role that can insert auth.users. Not for production.

do $$
declare
  v_sales uuid := gen_random_uuid();
  v_ops uuid := gen_random_uuid();
  v_none uuid := gen_random_uuid();
  v_hash text := repeat('ab', 32);
  v_hash2 text := repeat('cd', 32);
  v_sale text := '11111111-1111-4111-8111-111111111111';
  v_tracker uuid;
  v_quote uuid;
  v_install uuid;
  v_file uuid;
  v_hidden uuid;
  v_other_file uuid;
  v_photo uuid;
  v_ok integer := 0;
  v_fail integer := 0;
  v_notes text := '';
  v_list jsonb;
  v_open jsonb;
  v_media jsonb;
  v_views integer;
  v_snap jsonb;
begin
  perform set_config('orbit.profile_sync', 'on', true);
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, email_change, email_change_token_new, recovery_token
  )
  select '00000000-0000-0000-0000-000000000000', id, 'authenticated', 'authenticated',
         'track-test-' || id::text || '@example.com', '', now(),
         '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', ''
  from (values (v_sales), (v_ops), (v_none)) as people(id);

  update public.profiles
  set role = 'staff', workspace_role = 'member', access_mode = 'custom', access_granted = true, is_active = true
  where id in (v_sales, v_ops, v_none);

  update public.module_access set access_level = 'none', enabled = false
  where profile_id in (v_sales, v_ops, v_none);
  update public.module_access set access_level = 'edit', enabled = true
  where profile_id = v_sales and module_id = 'sales';
  update public.module_access set access_level = 'view', enabled = true
  where profile_id = v_ops and module_id = 'operations';

  insert into ops.install_quotes (created_by, order_number, payload)
  values (v_sales, 'SO-TRACK-1', '{}'::jsonb)
  returning id into v_quote;
  insert into ops.installs (
    quote_id, order_number, install_price, start_on, end_on, customer_name,
    booking_rep_id, crew, van_size, van_count
  ) values (
    v_quote, 'SO-TRACK-1', 4242.42, '2026-12-03', '2026-12-03', 'Staff Only Gym',
    v_sales, 1, 'small', 1
  ) returning id into v_install;

  begin
    execute 'set local role anon';
    perform 1 from ops.order_trackers;
    v_fail := v_fail + 1; v_notes := v_notes || ' anon select trackers;';
  exception when others then
    if sqlstate = '42501' then v_ok := v_ok + 1; else v_fail := v_fail + 1; v_notes := v_notes || ' anon select ' || sqlstate || ';'; end if;
  end;
  begin
    execute 'set local role anon';
    perform 1 from ops.order_tracker_photos;
    v_fail := v_fail + 1; v_notes := v_notes || ' anon select photos;';
  exception when others then
    if sqlstate = '42501' then v_ok := v_ok + 1; else v_fail := v_fail + 1; v_notes := v_notes || ' anon photos ' || sqlstate || ';'; end if;
  end;
  begin
    execute 'set local role authenticated';
    perform 1 from ops.order_trackers;
    v_fail := v_fail + 1; v_notes := v_notes || ' auth select trackers;';
  exception when others then
    if sqlstate = '42501' then v_ok := v_ok + 1; else v_fail := v_fail + 1; v_notes := v_notes || ' auth select ' || sqlstate || ';'; end if;
  end;
  begin
    execute 'set local role anon';
    perform public.order_tracker_open(v_hash);
    v_fail := v_fail + 1; v_notes := v_notes || ' anon open ran;';
  exception when others then
    if sqlstate = '42501' then v_ok := v_ok + 1; else v_fail := v_fail + 1; v_notes := v_notes || ' anon open ' || sqlstate || ' ' || sqlerrm || ';'; end if;
  end;

  reset role;
  perform set_config('request.jwt.claim.sub', v_none::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_none, 'role', 'authenticated')::text, true);
  begin
    execute 'set local role authenticated';
    perform public.order_tracker_create('SO-TRACK-1', v_sale, v_hash);
    v_fail := v_fail + 1; v_notes := v_notes || ' stranger created;';
  exception when others then
    if sqlerrm ilike '%cannot manage%' then v_ok := v_ok + 1; else v_fail := v_fail + 1; v_notes := v_notes || ' stranger ' || sqlerrm || ';'; end if;
  end;

  reset role;
  perform set_config('request.jwt.claim.sub', v_sales::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_sales, 'role', 'authenticated')::text, true);
  begin
    execute 'set local role authenticated';
    v_tracker := public.order_tracker_create('SO-TRACK-1', v_sale, v_hash);
    if v_tracker is not null then v_ok := v_ok + 1; else v_fail := v_fail + 1; v_notes := v_notes || ' create null;'; end if;
  exception when others then
    v_fail := v_fail + 1; v_notes := v_notes || ' create ' || sqlerrm || ';';
  end;
  begin
    execute 'set local role authenticated';
    perform public.order_tracker_create('SO-TRACK-1', v_sale, v_hash2);
    v_fail := v_fail + 1; v_notes := v_notes || ' duplicate allowed;';
  exception when others then
    if sqlerrm ilike '%already has%' then v_ok := v_ok + 1; else v_fail := v_fail + 1; v_notes := v_notes || ' duplicate ' || sqlerrm || ';'; end if;
  end;

  reset role;
  perform set_config('request.jwt.claim.sub', v_ops::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_ops, 'role', 'authenticated')::text, true);
  begin
    execute 'set local role authenticated';
    v_list := public.order_tracker_list('so-track-1');
    if jsonb_array_length(v_list) = 1
       and v_list->0->>'status' = 'active'
       and position(v_hash in v_list::text) = 0
       and position('4242' in v_list::text) = 0
    then v_ok := v_ok + 1; else v_fail := v_fail + 1; v_notes := v_notes || ' ops list ' || coalesce(v_list::text, 'null') || ';'; end if;
  exception when others then
    v_fail := v_fail + 1; v_notes := v_notes || ' ops list ' || sqlerrm || ';';
  end;

  reset role;
  if v_tracker is not null then
    insert into core.files (bucket, storage_path, mime_type, byte_size, uploaded_by, entity_schema, entity_table, entity_id, kind)
    values ('qc', 'ops/' || v_tracker::text || '/photo.jpg', 'image/jpeg', 20, v_sales, 'ops', 'order_trackers', v_tracker, 'qc')
    returning id into v_file;
    insert into core.files (bucket, storage_path, mime_type, byte_size, uploaded_by, entity_schema, entity_table, entity_id, kind)
    values ('qc', 'ops/' || v_tracker::text || '/hidden.jpg', 'image/jpeg', 20, v_sales, 'ops', 'order_trackers', v_tracker, 'qc')
    returning id into v_hidden;
    insert into core.files (bucket, storage_path, mime_type, byte_size, uploaded_by, entity_schema, entity_table, entity_id, kind)
    values ('access-media', 'ops/' || v_tracker::text || '/nope.jpg', 'image/jpeg', 20, v_sales, 'ops', 'order_trackers', v_tracker, 'qc')
    returning id into v_other_file;
  end if;

  perform set_config('request.jwt.claim.sub', v_sales::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_sales, 'role', 'authenticated')::text, true);
  begin
    execute 'set local role authenticated';
    perform public.order_tracker_add_photo(v_tracker, v_other_file, null);
    v_fail := v_fail + 1; v_notes := v_notes || ' wrong bucket allowed;';
  exception when others then
    if sqlerrm ilike '%not on this order%' or sqlerrm ilike '%QC bucket%' then v_ok := v_ok + 1; else v_fail := v_fail + 1; v_notes := v_notes || ' bucket ' || sqlerrm || ';'; end if;
  end;
  begin
    execute 'set local role authenticated';
    v_photo := public.order_tracker_add_photo(v_tracker, v_file, 'Packed bench');
    if v_photo is not null then v_ok := v_ok + 1; else v_fail := v_fail + 1; v_notes := v_notes || ' photo null;'; end if;
  exception when others then
    v_fail := v_fail + 1; v_notes := v_notes || ' photo ' || sqlerrm || ';';
  end;

  v_snap := jsonb_build_object(
    'orderNumber', 'SO-TRACK-1',
    'saleId', v_sale,
    'customerName', 'Example Customer',
    'status', 'ORDERED',
    'orderStatus', 'AUTHORISED',
    'pickingStatus', 'NOT PICKED',
    'packingStatus', 'NOT PACKED',
    'shippingStatus', 'NOT SHIPPED',
    'fulfilmentStatus', 'NOT FULFILLED',
    'shipBy', null,
    'requiredBy', null,
    'carrier', null,
    'trackingNumbers', '[]'::jsonb,
    'items', jsonb_build_array(jsonb_build_object('name', 'Example bench', 'quantity', 2))
  );

  reset role;
  perform set_config('request.jwt.claim.role', 'service_role', true);
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  perform set_config('request.jwt.claim.sub', '', true);
  begin
    perform public.order_tracker_save_snapshot(v_hash, v_snap || jsonb_build_object('Price', 4242.42));
    v_fail := v_fail + 1; v_notes := v_notes || ' price snapshot allowed;';
  exception when others then
    if sqlerrm ilike '%not valid%' then v_ok := v_ok + 1; else v_fail := v_fail + 1; v_notes := v_notes || ' price snap ' || sqlerrm || ';'; end if;
  end;
  begin
    perform public.order_tracker_save_snapshot(v_hash, v_snap);
    v_ok := v_ok + 1;
  exception when others then
    v_fail := v_fail + 1; v_notes := v_notes || ' save snap ' || sqlerrm || ';';
  end;
  begin
    v_open := public.order_tracker_open(v_hash);
    if v_open->>'orderNumber' = 'SO-TRACK-1'
       and v_open->'snapshot'->>'customerName' = 'Example Customer'
       and v_open->'install'->>'status' = 'booked'
       and left(v_open->'install'->>'startOn', 10) = '2026-12-03'
       and jsonb_array_length(v_open->'photos') = 0
       and position('4242' in v_open::text) = 0
       and position('Staff Only Gym' in v_open::text) = 0
       and position('Price' in v_open::text) = 0
       and position(v_hash in v_open::text) = 0
    then v_ok := v_ok + 1; else v_fail := v_fail + 1; v_notes := v_notes || ' open ' || coalesce(v_open::text, 'null') || ';'; end if;
  exception when others then
    v_fail := v_fail + 1; v_notes := v_notes || ' open ' || sqlerrm || ';';
  end;

  reset role;
  select view_count into v_views from ops.order_trackers where id = v_tracker;
  if v_views = 1 then v_ok := v_ok + 1; else v_fail := v_fail + 1; v_notes := v_notes || ' views ' || coalesce(v_views::text, 'null') || ';'; end if;

  perform set_config('request.jwt.claim.sub', v_sales::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_sales, 'role', 'authenticated')::text, true);
  begin
    execute 'set local role authenticated';
    perform public.order_tracker_photo_visible(v_photo, true);
    v_ok := v_ok + 1;
  exception when others then
    v_fail := v_fail + 1; v_notes := v_notes || ' show ' || sqlerrm || ';';
  end;

  reset role;
  perform set_config('request.jwt.claim.role', 'service_role', true);
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  perform set_config('request.jwt.claim.sub', '', true);
  v_open := public.order_tracker_open(v_hash);
  v_media := public.order_tracker_media(v_hash, v_photo);
  if jsonb_array_length(v_open->'photos') = 1
     and v_open->'photos'->0->>'caption' = 'Packed bench'
     and v_media->>'bucket' = 'qc'
     and coalesce(v_media->>'path', '') <> ''
  then v_ok := v_ok + 1; else v_fail := v_fail + 1; v_notes := v_notes || ' visible ' || coalesce(v_media::text, 'null') || ';'; end if;

  reset role;
  select view_count into v_views from ops.order_trackers where id = v_tracker;
  if v_views = 2 then v_ok := v_ok + 1; else v_fail := v_fail + 1; v_notes := v_notes || ' media views ' || coalesce(v_views::text, 'null') || ';'; end if;

  perform set_config('request.jwt.claim.sub', v_sales::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_sales, 'role', 'authenticated')::text, true);
  begin
    execute 'set local role authenticated';
    perform public.order_tracker_photo_visible(v_photo, false);
    v_ok := v_ok + 1;
  exception when others then
    v_fail := v_fail + 1; v_notes := v_notes || ' hide ' || sqlerrm || ';';
  end;

  reset role;
  perform set_config('request.jwt.claim.role', 'service_role', true);
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  v_media := public.order_tracker_media(v_hash, v_photo);
  v_open := public.order_tracker_open(v_hash);
  if v_media is null and jsonb_array_length(v_open->'photos') = 0 then v_ok := v_ok + 1;
  else v_fail := v_fail + 1; v_notes := v_notes || ' hidden still visible;'; end if;

  perform public.order_tracker_open(repeat('0', 64));
  if public.order_tracker_open(repeat('0', 64)) is null then v_ok := v_ok + 1; else v_fail := v_fail + 1; v_notes := v_notes || ' unknown hash;'; end if;

  reset role;
  perform set_config('request.jwt.claim.sub', v_sales::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_sales, 'role', 'authenticated')::text, true);
  begin
    execute 'set local role authenticated';
    perform public.order_tracker_revoke(v_tracker);
    v_ok := v_ok + 1;
  exception when others then
    v_fail := v_fail + 1; v_notes := v_notes || ' revoke ' || sqlerrm || ';';
  end;

  reset role;
  perform set_config('request.jwt.claim.role', 'service_role', true);
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  if public.order_tracker_open(v_hash) is null then v_ok := v_ok + 1; else v_fail := v_fail + 1; v_notes := v_notes || ' revoked still opens;'; end if;

  reset role;
  update ops.order_trackers set revoked_at = null, expires_on = now() - interval '1 day' where id = v_tracker;
  perform set_config('request.jwt.claim.role', 'service_role', true);
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  if public.order_tracker_open(v_hash) is null then v_ok := v_ok + 1; else v_fail := v_fail + 1; v_notes := v_notes || ' expired still opens;'; end if;

  reset role;
  perform set_config('request.jwt.claim.sub', v_ops::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_ops, 'role', 'authenticated')::text, true);
  begin
    execute 'set local role authenticated';
    perform public.order_tracker_regenerate(v_tracker, v_hash2);
    v_ok := v_ok + 1;
  exception when others then
    v_fail := v_fail + 1; v_notes := v_notes || ' regenerate ' || sqlerrm || ';';
  end;

  reset role;
  perform set_config('request.jwt.claim.role', 'service_role', true);
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  v_open := public.order_tracker_open(v_hash2);
  if public.order_tracker_open(v_hash) is null
     and v_open->>'orderNumber' = 'SO-TRACK-1'
     and left(v_open->>'expiresOn', 10) > to_char(now(), 'YYYY-MM-DD')
  then v_ok := v_ok + 1; else v_fail := v_fail + 1; v_notes := v_notes || ' new link ' || coalesce(v_open::text, 'null') || ';'; end if;

  if v_install is null then
    v_fail := v_fail + 1; v_notes := v_notes || ' install missing;';
  end if;

  raise exception 'RESULTS ok=% fail=% %', v_ok, v_fail, v_notes;
end
$$;
