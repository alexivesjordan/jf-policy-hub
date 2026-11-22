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
  v_goods integer;
  v_full integer;
  v_case text;
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

  select count(*) into v_count from logistics.customs_statement_rules where not active and incoterm = 'DDP' and destination_country = 'EU';
  if v_count = 1 then v_ok := v_ok + 1; else v_fail := v_fail + 1; v_notes := v_notes || ' ddp template inactive pending broker approval;'; end if;
  select count(*) into v_count from logistics.customs_statement_rules where not active and statement_text like 'Regime 42%';
  if v_count = 1 then v_ok := v_ok + 1; else v_fail := v_fail + 1; v_notes := v_notes || ' regime 42 inactive;'; end if;

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

  reset role;
  select coalesce((select last_number from logistics.invoice_counters where year = v_year), 0) into v_before;
  execute 'set local role service_role';

  v_payload := jsonb_build_object(
    'idempotencyKey', gen_random_uuid(),
    'issuedBy', v_admin,
    'currency', 'GBP',
    'incoterm', 'DAP',
    'grossWeightKg', 2,
    'buyer', jsonb_build_object('name', 'Acme Gyms Ltd', 'address', '1 Road', 'vat', '', 'eori', ''),
    'shipment', jsonb_build_object(
      'deliveryPence', 45000, 'surchargePence', 3250, 'vatPence', 2000,
      'palletLines', jsonb_build_array(jsonb_build_object('lengthCm', 120, 'widthCm', 100, 'depthCm', 150, 'weightKg', 2))
    ),
    'orders', jsonb_build_array(jsonb_build_object('cin7Id', 'sale-ci', 'number', 'SO-CI')),
    'lines', jsonb_build_array(jsonb_build_object(
      'id', 'sale-ci:0',
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

  select totals_pence, total_pence into v_goods, v_full
  from logistics.commercial_invoices where id = v_id;
  if v_goods = 10000 and v_full = 60250 then v_ok := v_ok + 1;
  else v_fail := v_fail + 1; v_notes := v_notes || ' total_pence goods ' || coalesce(v_goods::text, 'null') || ' full ' || coalesce(v_full::text, 'null') || ';'; end if;

  foreach v_case in array array[
    'negative delivery', 'negative surcharge', 'negative vat', 'negative gross', 'gross over cap'
  ] loop
    begin
      perform public.logistics_issue_commercial_invoice(
        jsonb_set(
          case v_case
            when 'negative delivery' then jsonb_set(v_payload, '{shipment,deliveryPence}', '-1')
            when 'negative surcharge' then jsonb_set(v_payload, '{shipment,surchargePence}', '-1')
            when 'negative vat' then jsonb_set(v_payload, '{shipment,vatPence}', '-1')
            when 'negative gross' then jsonb_set(v_payload, '{grossWeightKg}', '-1')
            else jsonb_set(v_payload, '{grossWeightKg}', '100001')
          end,
          '{idempotencyKey}', to_jsonb(gen_random_uuid()::text)
        )
      );
      v_fail := v_fail + 1;
      v_notes := v_notes || ' ' || v_case || ' allowed;';
    exception when others then
      if sqlerrm ilike '%invalid%' then v_ok := v_ok + 1;
      else v_fail := v_fail + 1; v_notes := v_notes || ' ' || v_case || ' ' || sqlerrm || ';'; end if;
    end;
  end loop;

  begin
    perform public.logistics_issue_commercial_invoice(jsonb_set(
      jsonb_set(v_payload, '{idempotencyKey}', to_jsonb(gen_random_uuid()::text)),
      '{shipment,palletLines,0,lengthCm}', '1001'
    ));
    v_fail := v_fail + 1;
    v_notes := v_notes || ' long pallet allowed;';
  exception when others then
    if sqlerrm ilike '%invalid%' then v_ok := v_ok + 1;
    else v_fail := v_fail + 1; v_notes := v_notes || ' long pallet ' || sqlerrm || ';'; end if;
  end;
  begin
    perform public.logistics_issue_commercial_invoice(jsonb_set(
      jsonb_set(v_payload, '{idempotencyKey}', to_jsonb(gen_random_uuid()::text)),
      '{shipment,palletLines,0,weightKg}', '1.25'
    ));
    v_fail := v_fail + 1;
    v_notes := v_notes || ' pallet decimal allowed;';
  exception when others then
    if sqlerrm ilike '%invalid%' then v_ok := v_ok + 1;
    else v_fail := v_fail + 1; v_notes := v_notes || ' pallet decimal ' || sqlerrm || ';'; end if;
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

  begin
    perform public.logistics_issue_commercial_invoice(jsonb_set(v_payload, '{issuedBy}', to_jsonb(v_engineer::text)));
    v_fail := v_fail + 1;
    v_notes := v_notes || ' other user replay allowed;';
  exception when others then
    if sqlerrm ilike '%cannot open%' then v_ok := v_ok + 1;
    else v_fail := v_fail + 1; v_notes := v_notes || ' other user replay ' || sqlerrm || ';'; end if;
  end;

  reset role;
  select last_number into v_after from logistics.invoice_counters where year = v_year;
  execute 'set local role service_role';
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

  v_payload := jsonb_build_object(
    'idempotencyKey', gen_random_uuid(),
    'issuedBy', v_admin,
    'currency', 'GBP',
    'incoterm', 'DAP',
    'grossWeightKg', 6,
    'buyer', jsonb_build_object('name', 'Acme Gyms Ltd', 'address', '1 Road', 'vat', '', 'eori', ''),
    'shipment', jsonb_build_object('palletLines', jsonb_build_array(jsonb_build_object('lengthCm', 120, 'widthCm', 100, 'depthCm', 120, 'weightKg', 6))),
    'orders', jsonb_build_array(jsonb_build_object('cin7Id', 'sale-dup', 'number', 'SO-DUP')),
    'lines', jsonb_build_array(
      jsonb_build_object('id', 'sale-dup:0', 'orderNumber', 'SO-DUP', 'cin7SaleId', 'sale-dup', 'sku', 'CI-DUP', 'description', 'Bench A', 'orderedQty', 2, 'shippedQty', 2, 'lineNetPence', 200, 'hsCode', '9506910000', 'origin', 'CN', 'unitWeightKg', 1, 'lineWeightKg', 2),
      jsonb_build_object('id', 'sale-dup:1', 'orderNumber', 'SO-DUP', 'cin7SaleId', 'sale-dup', 'sku', 'CI-DUP', 'description', 'Bench B', 'orderedQty', 3, 'shippedQty', 3, 'lineNetPence', 300, 'hsCode', '9506910000', 'origin', 'CN', 'unitWeightKg', 1, 'lineWeightKg', 3)
    )
  );
  begin
    perform public.logistics_issue_commercial_invoice(v_payload);
    v_ok := v_ok + 1;
  exception when others then
    v_fail := v_fail + 1;
    v_notes := v_notes || ' duplicate sku ' || sqlerrm || ';';
  end;
  v_payload := jsonb_set(v_payload, '{idempotencyKey}', to_jsonb(gen_random_uuid()::text));
  v_payload := jsonb_set(v_payload, '{lines,0,shippedQty}', '1'::jsonb);
  v_payload := jsonb_set(v_payload, '{lines,1,shippedQty}', '0'::jsonb);
  begin
    perform public.logistics_issue_commercial_invoice(v_payload);
    v_fail := v_fail + 1;
    v_notes := v_notes || ' duplicate sku over-ship allowed;';
  exception when others then
    if sqlerrm ilike '%already on an issued invoice%' then v_ok := v_ok + 1;
    else v_fail := v_fail + 1; v_notes := v_notes || ' duplicate sku over-ship ' || sqlerrm || ';'; end if;
  end;

  v_payload := jsonb_build_object(
    'idempotencyKey', gen_random_uuid(),
    'issuedBy', v_admin,
    'currency', 'GBP',
    'incoterm', 'DAP',
    'grossWeightKg', 2,
    'buyer', jsonb_build_object('name', 'Acme Gyms Ltd', 'address', '1 Road', 'vat', '', 'eori', ''),
    'shipment', jsonb_build_object('palletLines', jsonb_build_array(jsonb_build_object('lengthCm', 80, 'widthCm', 60, 'depthCm', 40, 'weightKg', 2))),
    'orders', jsonb_build_array(jsonb_build_object('cin7Id', 'sale-e', 'number', 'SO-E')),
    'lines', jsonb_build_array(
      jsonb_build_object('id', 'sale-e:D', 'orderNumber', 'SO-E', 'cin7SaleId', 'sale-e', 'sku', 'CI-E', 'description', 'Line D', 'orderedQty', 5, 'shippedQty', 0, 'lineNetPence', 500, 'hsCode', '9506910000', 'origin', 'CN', 'unitWeightKg', 1, 'lineWeightKg', 0),
      jsonb_build_object('id', 'sale-e:E', 'orderNumber', 'SO-E', 'cin7SaleId', 'sale-e', 'sku', 'CI-E', 'description', 'Line E', 'orderedQty', 1, 'shippedQty', 1, 'lineNetPence', 100, 'hsCode', '9506910000', 'origin', 'CN', 'unitWeightKg', 1, 'lineWeightKg', 1)
    )
  );
  begin
    perform public.logistics_issue_commercial_invoice(v_payload);
    v_ok := v_ok + 1;
  exception when others then
    v_fail := v_fail + 1;
    v_notes := v_notes || ' line E first ' || sqlerrm || ';';
  end;
  v_payload := jsonb_set(v_payload, '{idempotencyKey}', to_jsonb(gen_random_uuid()::text));
  begin
    perform public.logistics_issue_commercial_invoice(v_payload);
    v_fail := v_fail + 1;
    v_notes := v_notes || ' line E twice allowed;';
  exception when others then
    if sqlerrm ilike '%already on an issued invoice%' then v_ok := v_ok + 1;
    else v_fail := v_fail + 1; v_notes := v_notes || ' line E twice ' || sqlerrm || ';'; end if;
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

  reset role;
  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    update logistics.commercial_invoices set totals_pence = 1 where id = v_id;
    v_fail := v_fail + 1;
    v_notes := v_notes || ' update allowed;';
  exception when others then
    if sqlerrm ilike '%cannot be changed%' or sqlerrm ilike '%permission denied%' then v_ok := v_ok + 1;
    else v_fail := v_fail + 1; v_notes := v_notes || ' update ' || sqlerrm || ';'; end if;
  end;

  reset role;
  begin
    update logistics.commercial_invoices set total_pence = 1 where id = v_id;
    v_fail := v_fail + 1;
    v_notes := v_notes || ' total update allowed;';
  exception when others then
    if sqlerrm ilike '%cannot be changed%' then v_ok := v_ok + 1;
    else v_fail := v_fail + 1; v_notes := v_notes || ' total update ' || sqlerrm || ';'; end if;
  end;
  begin
    update logistics.commercial_invoices set currency = 'USD' where id = v_id;
    v_fail := v_fail + 1;
    v_notes := v_notes || ' owner update allowed;';
  exception when others then
    if sqlerrm ilike '%cannot be changed%' then v_ok := v_ok + 1;
    else v_fail := v_fail + 1; v_notes := v_notes || ' owner update ' || sqlerrm || ';'; end if;
  end;
  begin
    update logistics.commercial_invoice_lines set description = description where invoice_id = v_id;
    v_fail := v_fail + 1;
    v_notes := v_notes || ' line update allowed;';
  exception when others then
    if sqlerrm ilike '%cannot be changed%' then v_ok := v_ok + 1;
    else v_fail := v_fail + 1; v_notes := v_notes || ' line update ' || sqlerrm || ';'; end if;
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
  select count(*) into v_count from logistics.customs_statement_rules;
  if v_count = 0 then v_ok := v_ok + 1; else v_fail := v_fail + 1; v_notes := v_notes || ' installer saw rules;'; end if;
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
