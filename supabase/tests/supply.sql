-- Pulse Supply access. Raises RESULTS and rolls back.
-- Run on TEST as a role that can insert auth.users. Not for production.

do $$
declare
  v_none uuid := gen_random_uuid();
  v_view uuid := gen_random_uuid();
  v_edit uuid := gen_random_uuid();
  v_admin uuid := gen_random_uuid();
  v_owner uuid := gen_random_uuid();
  v_ok integer := 0;
  v_fail integer := 0;
  v_notes text := '';
  v_count integer;
  v_mapping uuid;
  v_batch uuid;
  v_supplier uuid;
  v_qty numeric;
  v_err text;
  i integer;
begin
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, email_change, email_change_token_new, recovery_token
  )
  select '00000000-0000-0000-0000-000000000000', id, 'authenticated', 'authenticated',
         'supply-test-' || id::text || '@example.com', '', now(),
         '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', ''
  from (values (v_none), (v_view), (v_edit), (v_admin), (v_owner)) as people(id);

  update public.profiles
  set role = 'staff', workspace_role = 'member', access_mode = 'custom', access_granted = true, is_active = true
  where id in (v_none, v_view, v_edit, v_admin);
  update public.profiles
  set role = 'staff', workspace_role = 'owner', access_mode = 'follow', access_granted = true, is_active = true
  where id = v_owner;
  update public.module_access set access_level = 'none', enabled = false where profile_id = v_none and module_id = 'supply';
  update public.module_access set access_level = 'view', enabled = true where profile_id = v_view and module_id = 'supply';
  update public.module_access set access_level = 'edit', enabled = true where profile_id = v_edit and module_id = 'supply';
  update public.module_access set access_level = 'admin', enabled = true where profile_id = v_admin and module_id = 'supply';

  begin
    execute 'set local role anon';
    perform count(*) from supply.suppliers;
    v_fail := v_fail + 1; v_notes := v_notes || ' anon read;';
  exception when insufficient_privilege then
    v_ok := v_ok + 1;
  end;
  reset role;

  perform set_config('request.jwt.claim.sub', v_none::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_none, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into v_count from supply.settings;
  if v_count = 0 then v_ok := v_ok + 1; else v_fail := v_fail + 1; v_notes := v_notes || ' none saw settings;'; end if;
  begin
    perform public.supply_overview();
    v_fail := v_fail + 1; v_notes := v_notes || ' none overview;';
  exception when others then
    if sqlerrm ilike '%cannot see%' then v_ok := v_ok + 1; else v_fail := v_fail + 1; v_notes := v_notes || ' none overview ' || sqlerrm || ';'; end if;
  end;
  reset role;

  perform set_config('request.jwt.claim.sub', v_view::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_view, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into v_count from supply.settings;
  if v_count = 1 then v_ok := v_ok + 1; else v_fail := v_fail + 1; v_notes := v_notes || ' view settings ' || v_count::text || ';'; end if;
  begin
    if public.supply_overview() ? 'zeroStock' then v_ok := v_ok + 1; else v_fail := v_fail + 1; v_notes := v_notes || ' view overview shape;'; end if;
  exception when others then
    v_fail := v_fail + 1; v_notes := v_notes || ' view overview ' || sqlerrm || ';';
  end;
  begin
    insert into supply.suppliers (name) values ('Blocked Supplier');
    v_fail := v_fail + 1; v_notes := v_notes || ' view insert;';
  exception when insufficient_privilege then
    v_ok := v_ok + 1;
  end;
  begin
    perform public.supply_save_supplier(jsonb_build_object('name', 'Blocked Supplier'));
    v_fail := v_fail + 1; v_notes := v_notes || ' view save;';
  exception when others then
    if sqlerrm ilike '%cannot change%' then v_ok := v_ok + 1; else v_fail := v_fail + 1; v_notes := v_notes || ' view save ' || sqlerrm || ';'; end if;
  end;
  reset role;

  perform set_config('request.jwt.claim.sub', v_edit::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_edit, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    v_supplier := public.supply_save_supplier(jsonb_build_object('name', 'Example Parts', 'currency', 'GBP', 'leadTimeDays', 21, 'moq', 4));
    if v_supplier is not null then v_ok := v_ok + 1; else v_fail := v_fail + 1; v_notes := v_notes || ' edit supplier null;'; end if;
  exception when others then
    v_fail := v_fail + 1; v_notes := v_notes || ' edit supplier ' || sqlerrm || ';';
  end;
  begin
    v_mapping := public.supply_save_mapping(jsonb_build_object(
      'name', 'Orderwise sales', 'kind', 'sales_lines', 'dateFormat', 'dd/mm/yyyy', 'delimiter', ',',
      'columns', jsonb_build_object('date', 'Date', 'sku', 'Code', 'qty', 'Qty')
    ));
    v_ok := v_ok + 1;
  exception when others then
    v_fail := v_fail + 1; v_notes := v_notes || ' mapping ' || sqlerrm || ';';
  end;
  begin
    perform public.supply_save_settings(jsonb_build_object('serviceLevel', 0.9, 'reviewDays', 14, 'defaultLeadTimeDays', 14, 'forecastMonths', 6, 'smaWindow', 6, 'crostonAlpha', 0.2, 'initialLookbackMonths', 36));
    v_fail := v_fail + 1; v_notes := v_notes || ' edit settings;';
  exception when others then
    if sqlerrm ilike '%admin%' then v_ok := v_ok + 1; else v_fail := v_fail + 1; v_notes := v_notes || ' edit settings ' || sqlerrm || ';'; end if;
  end;
  begin
    perform public.supply_delete_mapping(v_mapping);
    v_fail := v_fail + 1; v_notes := v_notes || ' edit delete mapping;';
  exception when others then
    if sqlerrm ilike '%admin%' then v_ok := v_ok + 1; else v_fail := v_fail + 1; v_notes := v_notes || ' edit delete ' || sqlerrm || ';'; end if;
  end;
  delete from supply.settings where id;
  get diagnostics v_count = row_count;
  if v_count = 0 then v_ok := v_ok + 1; else v_fail := v_fail + 1; v_notes := v_notes || ' edit deleted settings;'; end if;

  begin
    v_batch := public.supply_import_begin(jsonb_build_object('mappingId', v_mapping, 'filePath', 'synthetic.csv'));
    for i in 1..10 loop
      perform public.supply_import_chunk(v_batch, jsonb_build_object(
        'demand', (
          select jsonb_agg(jsonb_build_object(
            'sku', 'SKU-' || lpad((g % 100)::text, 2, '0'),
            'month', '2020-01-01',
            'qty', 1,
            'order_count', 1
          ))
          from generate_series((i - 1) * 5000 + 1, i * 5000) g
        ),
        'unmatched', jsonb_build_array(jsonb_build_object('code', 'OLD-' || i::text, 'qty', 1))
      ));
    end loop;
    perform public.supply_import_finish(v_batch, jsonb_build_object('rowsRead', 50000, 'errors', '[]'::jsonb));
    select coalesce(sum(qty), 0) into v_qty from supply.demand_monthly where batch_id = v_batch;
    select count(*) into v_count from supply.import_unmatched where batch_id = v_batch;
    if v_qty = 50000 and v_count = 10 then v_ok := v_ok + 1; else v_fail := v_fail + 1; v_notes := v_notes || ' 50k qty ' || v_qty::text || ' unmatched ' || v_count::text || ';'; end if;
  exception when others then
    v_fail := v_fail + 1; v_notes := v_notes || ' 50k ' || sqlerrm || ';';
  end;

  begin
    perform public.supply_import_begin(jsonb_build_object('batchId', v_batch, 'mappingId', v_mapping, 'filePath', 'synthetic.csv'));
    perform public.supply_import_chunk(v_batch, jsonb_build_object(
      'demand', jsonb_build_array(jsonb_build_object('sku', 'SKU-00', 'month', '2020-01-01', 'qty', 7, 'order_count', 1))
    ));
    perform public.supply_import_finish(v_batch, jsonb_build_object('rowsRead', 1));
    select count(*) into v_count from supply.demand_monthly where batch_id = v_batch;
    select qty into v_qty from supply.demand_monthly where batch_id = v_batch and sku = 'SKU-00';
    if v_count = 1 and v_qty = 7 then v_ok := v_ok + 1; else v_fail := v_fail + 1; v_notes := v_notes || ' reimport ' || v_count::text || ' ' || coalesce(v_qty::text, 'null') || ';'; end if;
  exception when others then
    v_fail := v_fail + 1; v_notes := v_notes || ' reimport ' || sqlerrm || ';';
  end;
  reset role;

  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  execute 'set local role service_role';
  begin
    perform public.supply_sync_products(jsonb_build_array(jsonb_build_object('sku', 'SKU-00', 'label', 'Example bar')));
    perform public.supply_sync_sales(jsonb_build_array(jsonb_build_object(
      'saleId', 'sale-1', 'status', 'COMPLETED', 'orderedOn', '2024-06-15',
      'lines', jsonb_build_array(jsonb_build_object('sku', 'SKU-00', 'qty', 3))
    )));
    perform public.supply_sync_purchases(jsonb_build_object(
      'lines', jsonb_build_array(jsonb_build_object('poRef', 'PO-1', 'supplierKey', 'Example Parts', 'sku', 'SKU-00', 'qty', 2, 'orderedOn', '2024-05-01', 'receivedOn', '2024-05-20'))
    ));
    select qty into v_qty from supply.demand_monthly where source = 'cin7' and sku = 'SKU-00' and month = '2024-06-01';
    if v_qty = 3 then v_ok := v_ok + 1; else v_fail := v_fail + 1; v_notes := v_notes || ' cin7 demand ' || coalesce(v_qty::text, 'null') || ';'; end if;
  exception when others then
    v_fail := v_fail + 1; v_notes := v_notes || ' sync ' || sqlerrm || ';';
  end;
  reset role;

  perform set_config('request.jwt.claim.sub', v_edit::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_edit, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    perform public.supply_remove_batch(v_batch);
    select count(*) into v_count from supply.demand_monthly where batch_id = v_batch or (source = 'orderwise' and sku = 'SKU-00');
    select qty into v_qty from supply.demand_monthly where source = 'cin7' and sku = 'SKU-00';
    if v_count = 0 and v_qty = 3 then v_ok := v_ok + 1; else v_fail := v_fail + 1; v_notes := v_notes || ' remove ' || v_count::text || ' cin7 ' || coalesce(v_qty::text, 'null') || ';'; end if;
  exception when others then
    v_fail := v_fail + 1; v_notes := v_notes || ' remove ' || sqlerrm || ';';
  end;
  reset role;

  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    perform public.supply_delete_mapping(v_mapping);
    if not exists (select 1 from supply.import_mappings where id = v_mapping) then v_ok := v_ok + 1; else v_fail := v_fail + 1; v_notes := v_notes || ' admin mapping remains;'; end if;
  exception when others then
    v_fail := v_fail + 1; v_notes := v_notes || ' admin delete ' || sqlerrm || ';';
  end;
  reset role;

  perform set_config('request.jwt.claim.sub', v_owner::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    perform public.supply_save_settings(jsonb_build_object(
      'serviceLevel', 0.95, 'reviewDays', 14, 'defaultLeadTimeDays', 14,
      'forecastMonths', 6, 'zeroStockAlert', true, 'smaWindow', 6, 'crostonAlpha', 0.2, 'initialLookbackMonths', 36
    ));
    v_ok := v_ok + 1;
  exception when others then
    v_fail := v_fail + 1; v_notes := v_notes || ' owner settings ' || sqlerrm || ';';
  end;
  reset role;

  raise exception 'RESULTS ok=% fail=% %', v_ok, v_fail, v_notes;
end
$$;
