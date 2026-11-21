-- Commercial invoice checks. The block always raises RESULTS and rolls back.
-- Run after 20261121100000 and 20261121100100, as a role that can insert auth.users.

do $$
declare
  v_admin uuid := gen_random_uuid();
  v_engineer uuid := gen_random_uuid();
  v_ok integer := 0;
  v_fail integer := 0;
  v_notes text := '';
  v_year integer := extract(year from timezone('Europe/London', now()))::integer;
  v_before integer;
  v_after integer;
  v_first jsonb;
  v_replay jsonb;
  v_second jsonb;
  v_third jsonb;
  v_id uuid;
  v_number text;
  v_count integer;
  v_seller text;
  v_filename text;
  v_payload jsonb;
begin
  perform set_config('orbit.profile_sync', 'on', true);

  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, email_change, email_change_token_new, recovery_token
  ) values
    ('00000000-0000-0000-0000-000000000000', v_admin, 'authenticated', 'authenticated',
     'logistics-ci-admin-' || v_admin::text || '@example.com', '', now(),
     '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', ''),
    ('00000000-0000-0000-0000-000000000000', v_engineer, 'authenticated', 'authenticated',
     'logistics-ci-installer-' || v_engineer::text || '@example.com', '', now(),
     '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', '');

  update public.profiles
  set role = 'admin', workspace_role = 'admin', access_granted = true, is_active = true
  where id = v_admin;
  update public.profiles
  set role = 'staff', workspace_role = 'member', access_granted = true, is_active = true
  where id = v_engineer;
  insert into ops.resources (resource_type, name, profile_id, status)
  values ('installer', 'CI installer', v_engineer, 'active');

  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  begin
    insert into logistics.product_customs (sku, hs_code, country_of_origin, net_weight_kg)
    values ('CI-TEST-SKU', '9506910000', 'CN', 1.500);
    v_ok := v_ok + 1;
  exception when others then
    v_fail := v_fail + 1;
    v_notes := v_notes || ' admin customs ' || sqlerrm || ';';
  end;

  if logistics.can_use() then v_ok := v_ok + 1; else v_fail := v_fail + 1; v_notes := v_notes || ' admin can_use false;'; end if;

  reset role;
  perform set_config('request.jwt.claim.sub', v_engineer::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_engineer, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  if logistics.can_use() then
    v_fail := v_fail + 1;
    v_notes := v_notes || ' installer can_use true;';
  else
    v_ok := v_ok + 1;
  end if;

  begin
    insert into logistics.product_customs (sku, hs_code, country_of_origin, net_weight_kg)
    values ('CI-DENIED', '9506910000', 'CN', 1);
    v_fail := v_fail + 1;
    v_notes := v_notes || ' installer insert allowed;';
  exception when others then
    v_ok := v_ok + 1;
  end;

  begin
    perform public.logistics_issue_commercial_invoice('{"idempotencyKey":"00000000-0000-4000-8000-000000000001","lines":[{"orderedQty":1,"shippedQty":1}]}'::jsonb);
    v_fail := v_fail + 1;
    v_notes := v_notes || ' installer issue allowed;';
  exception when others then
    v_ok := v_ok + 1;
  end;

  reset role;
  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  select coalesce(last_number, 0) into v_before from logistics.invoice_counters where year = v_year;
  v_before := coalesce(v_before, 0);

  v_payload := jsonb_build_object(
    'idempotencyKey', gen_random_uuid(),
    'currency', 'GBP',
    'incoterm', 'DAP',
    'grossWeightKg', 2,
    'buyer', jsonb_build_object('name', 'Acme Gyms Ltd', 'address', '1 Road', 'vat', '', 'eori', ''),
    'orders', jsonb_build_array(jsonb_build_object('cin7Id', 'sale-ci', 'number', 'SO-CI')),
    'lines', jsonb_build_array(jsonb_build_object(
      'orderNumber', 'SO-CI', 'cin7SaleId', 'sale-ci', 'sku', 'CI-TEST-SKU', 'description', 'Bench',
      'orderedQty', 2, 'shippedQty', 1, 'lineNetPence', 20000, 'shippedPence', 10000,
      'hsCode', '9506910000', 'origin', 'CN', 'unitWeightKg', 1.5, 'lineWeightKg', 1.5
    ))
  );

  begin
    v_first := public.logistics_issue_commercial_invoice(v_payload);
    v_id := (v_first->>'id')::uuid;
    v_number := v_first->>'number';
    if v_number = 'CI-' || v_year::text || '-' || lpad((v_before + 1)::text, 4, '0') and coalesce((v_first->>'replayed')::boolean, false) = false then
      v_ok := v_ok + 1;
    else
      v_fail := v_fail + 1;
      v_notes := v_notes || ' first number ' || coalesce(v_number, 'null') || ';';
    end if;
  exception when others then
    v_fail := v_fail + 1;
    v_notes := v_notes || ' issue ' || sqlerrm || ';';
  end;

  begin
    v_replay := public.logistics_issue_commercial_invoice(v_payload);
    if v_replay->>'number' = v_number and (v_replay->>'replayed')::boolean then
      v_ok := v_ok + 1;
    else
      v_fail := v_fail + 1;
      v_notes := v_notes || ' replay ' || coalesce(v_replay::text, 'null') || ';';
    end if;
  exception when others then
    v_fail := v_fail + 1;
    v_notes := v_notes || ' replay ' || sqlerrm || ';';
  end;

  select last_number into v_after from logistics.invoice_counters where year = v_year;
  if v_after = v_before + 1 then v_ok := v_ok + 1; else v_fail := v_fail + 1; v_notes := v_notes || ' counter moved on replay;'; end if;

  v_payload := jsonb_set(v_payload, '{idempotencyKey}', to_jsonb(gen_random_uuid()::text));
  begin
    v_second := public.logistics_issue_commercial_invoice(v_payload);
    if v_second->>'number' = 'CI-' || v_year::text || '-' || lpad((v_before + 2)::text, 4, '0') then
      v_ok := v_ok + 1;
    else
      v_fail := v_fail + 1;
      v_notes := v_notes || ' second number ' || coalesce(v_second->>'number', 'null') || ';';
    end if;
  exception when others then
    v_fail := v_fail + 1;
    v_notes := v_notes || ' second issue ' || sqlerrm || ';';
  end;

  v_payload := jsonb_set(v_payload, '{idempotencyKey}', to_jsonb(gen_random_uuid()::text));
  begin
    v_third := public.logistics_issue_commercial_invoice(v_payload);
    v_fail := v_fail + 1;
    v_notes := v_notes || ' over-ship allowed ' || coalesce(v_third->>'number', '') || ';';
  exception when others then
    if sqlerrm ilike '%already on an issued invoice%' then v_ok := v_ok + 1;
    else v_fail := v_fail + 1; v_notes := v_notes || ' over-ship ' || sqlerrm || ';'; end if;
  end;

  select seller::text, pdf_filename into v_seller, v_filename
  from logistics.commercial_invoices where id = v_id;
  if v_seller like '%GB385438070001%' and v_seller like '%FRGB1215443160001%' and v_seller like '%12798165%' then
    v_ok := v_ok + 1;
  else
    v_fail := v_fail + 1;
    v_notes := v_notes || ' seller snapshot;';
  end if;
  if v_filename = 'Commercial Invoice - Acme Gyms Ltd - ' || v_number || ' - DAP.pdf' then
    v_ok := v_ok + 1;
  else
    v_fail := v_fail + 1;
    v_notes := v_notes || ' filename ' || coalesce(v_filename, 'null') || ';';
  end if;

  begin
    update logistics.commercial_invoices set totals_pence = 1 where id = v_id;
    v_fail := v_fail + 1;
    v_notes := v_notes || ' update allowed;';
  exception when others then
    if sqlerrm ilike '%cannot be changed%' then v_ok := v_ok + 1;
    else v_fail := v_fail + 1; v_notes := v_notes || ' update ' || sqlerrm || ';'; end if;
  end;

  begin
    delete from logistics.commercial_invoices where id = v_id;
    v_fail := v_fail + 1;
    v_notes := v_notes || ' delete allowed;';
  exception when others then
    v_ok := v_ok + 1;
  end;

  reset role;
  perform set_config('request.jwt.claim.sub', v_engineer::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_engineer, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into v_count from logistics.commercial_invoices;
  if v_count = 0 then v_ok := v_ok + 1; else v_fail := v_fail + 1; v_notes := v_notes || ' installer saw invoices;'; end if;
  begin
    perform public.logistics_void_commercial_invoice(v_id, 'Not allowed');
    v_fail := v_fail + 1;
    v_notes := v_notes || ' installer void allowed;';
  exception when others then
    v_ok := v_ok + 1;
  end;

  reset role;
  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    perform public.logistics_void_commercial_invoice(v_id, 'Test void');
    v_ok := v_ok + 1;
  exception when others then
    v_fail := v_fail + 1;
    v_notes := v_notes || ' admin void ' || sqlerrm || ';';
  end;

  begin
    update logistics.commercial_invoices set buyer = buyer where id = v_id;
    v_fail := v_fail + 1;
    v_notes := v_notes || ' void update allowed;';
  exception when others then
    v_ok := v_ok + 1;
  end;

  reset role;
  begin
    execute 'set local role anon';
    perform 1 from logistics.product_customs;
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
