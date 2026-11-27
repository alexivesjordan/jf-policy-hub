-- Pulse Supply screens and Orderwise import. Edit can change records. Admin deletes mappings and settings.
-- New file only. Do not apply to production.

create or replace function public.supply_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = supply, public
as $$
declare
  v_run uuid;
  v_sync timestamptz;
begin
  if not supply.can_read() then
    raise exception 'app: You cannot see supply records.';
  end if;
  select id into v_run
  from supply.forecast_runs
  where finished_at is not null
  order by finished_at desc
  limit 1;
  select last_sync_finished_at into v_sync from supply.settings where id;
  return jsonb_build_object(
    'lastSync', v_sync,
    'zeroStock', (
      select count(*)
      from supply.stock_snapshots ss
      join supply.sku_settings k on k.sku = ss.sku and not k.exclude
      where ss.on_hand <= 0
        and ss.captured_at = (
          select max(s2.captured_at) from supply.stock_snapshots s2 where s2.sku = ss.sku
        )
        and (select zero_stock_alert from supply.settings where id)
    ),
    'belowReorder', (
      select count(*) from supply.reorder_suggestions where run_id = v_run and below_reorder
    ),
    'overstock', (
      select count(*) from supply.reorder_suggestions where run_id = v_run and overstock
    ),
    'alerts', coalesce((
      select jsonb_agg(row order by (row->>'zeroStock')::boolean desc, row->>'sku')
      from (
        select jsonb_build_object(
          'sku', s.sku,
          'reason', s.reason,
          'onHand', s.on_hand,
          'available', s.available,
          'onOrder', s.on_order,
          'zeroStock', s.zero_stock,
          'belowReorder', s.below_reorder
        ) as row
        from supply.reorder_suggestions s
        where s.run_id = v_run and (s.zero_stock or s.below_reorder)
        order by s.zero_stock desc, s.sku
        limit 50
      ) alerts
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.supply_reorder()
returns jsonb
language plpgsql
stable
security definer
set search_path = supply, public
as $$
declare
  v_run uuid;
begin
  if not supply.can_read() then
    raise exception 'app: You cannot see supply records.';
  end if;
  select id into v_run from supply.forecast_runs where finished_at is not null order by finished_at desc limit 1;
  return jsonb_build_object(
    'runId', v_run,
    'canEdit', supply.can_write(),
    'groups', coalesce((
      select jsonb_agg(jsonb_build_object(
        'supplierId', g.supplier_id,
        'supplierName', coalesce(sup.name, 'No supplier'),
        'currency', coalesce(sup.currency, 'GBP'),
        'rows', g.rows
      ) order by coalesce(sup.name, 'No supplier'))
      from (
        select s.supplier_id,
          jsonb_agg(jsonb_build_object(
            'id', s.id,
            'sku', s.sku,
            'available', s.available,
            'onOrder', s.on_order,
            'reorderPoint', s.reorder_point,
            'suggestedQty', s.suggested_qty,
            'reason', s.reason
          ) order by s.sku) as rows
        from supply.reorder_suggestions s
        where s.run_id = v_run and s.suggested_qty > 0
        group by s.supplier_id
      ) g
      left join supply.suppliers sup on sup.id = g.supplier_id
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.supply_set_qty(p_id uuid, p_qty numeric)
returns void
language plpgsql
security definer
set search_path = supply, public
as $$
begin
  if not supply.can_write() then
    raise exception 'app: You cannot change a reorder quantity.';
  end if;
  if p_qty is null or p_qty < 0 or p_qty > 1000000 then
    raise exception 'app: Enter a quantity of zero or more.';
  end if;
  update supply.reorder_suggestions
  set suggested_qty = ceil(p_qty)
  where id = p_id
    and run_id = (select id from supply.forecast_runs where finished_at is not null order by finished_at desc limit 1);
  if not found then
    raise exception 'app: That suggestion is not on the latest run.';
  end if;
end;
$$;

create or replace function public.supply_skus(p_search text, p_offset integer, p_limit integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = supply, public
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 100);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_q text := nullif(btrim(p_search), '');
begin
  if not supply.can_read() then
    raise exception 'app: You cannot see supply records.';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'sku', k.sku,
      'label', k.label,
      'supplier', sup.name,
      'exclude', k.exclude,
      'onHand', st.on_hand,
      'available', st.available
    ) order by k.sku)
    from (
      select sku from supply.sku_settings
      where v_q is null or sku ilike '%' || v_q || '%' or label ilike '%' || v_q || '%'
      order by sku
      offset v_offset
      limit v_limit
    ) page
    join supply.sku_settings k on k.sku = page.sku
    left join supply.suppliers sup on sup.id = k.supplier_id
    left join lateral (
      select on_hand, available from supply.stock_snapshots ss
      where ss.sku = k.sku
      order by captured_at desc
      limit 1
    ) st on true
  ), '[]'::jsonb);
end;
$$;

create or replace function public.supply_sku(p_sku text)
returns jsonb
language plpgsql
stable
security definer
set search_path = supply, public
as $$
declare
  v_sku text := left(btrim(coalesce(p_sku, '')), 80);
  v_run uuid;
  v_row jsonb;
begin
  if not supply.can_read() then
    raise exception 'app: You cannot see supply records.';
  end if;
  select id into v_run from supply.forecast_runs where finished_at is not null order by finished_at desc limit 1;
  select jsonb_build_object(
    'sku', k.sku,
    'label', k.label,
    'supplierId', k.supplier_id,
    'supplierName', sup.name,
    'leadTimeDays', coalesce(k.lead_time_days, sup.lead_time_days),
    'leadTimeSource', k.lead_time_source,
    'moq', k.moq,
    'orderMultiple', k.order_multiple,
    'safetyDays', k.safety_days,
    'exclude', k.exclude,
    'onHand', st.on_hand,
    'allocated', st.allocated,
    'available', st.available,
    'onOrder', st.on_order,
    'capturedAt', st.captured_at,
    'demand', coalesce((
      select jsonb_agg(jsonb_build_object('month', d.month, 'qty', d.qty, 'source', d.source, 'orderCount', d.order_count) order by d.month, d.source)
      from supply.demand_monthly d where d.sku = k.sku
    ), '[]'::jsonb),
    'forecast', coalesce((
      select jsonb_agg(jsonb_build_object('month', f.month, 'qty', f.qty, 'method', f.method) order by f.month)
      from supply.forecasts f where f.run_id = v_run and f.sku = k.sku
    ), '[]'::jsonb)
  ) into v_row
  from supply.sku_settings k
  left join supply.suppliers sup on sup.id = k.supplier_id
  left join lateral (
    select on_hand, allocated, available, on_order, captured_at
    from supply.stock_snapshots ss where ss.sku = k.sku
    order by captured_at desc limit 1
  ) st on true
  where k.sku = v_sku;
  if v_row is null then
    raise exception 'app: That SKU is not on Supply.';
  end if;
  return v_row;
end;
$$;

create or replace function public.supply_suppliers()
returns jsonb
language plpgsql
stable
security definer
set search_path = supply, public
as $$
begin
  if not supply.can_read() then
    raise exception 'app: You cannot see supply records.';
  end if;
  return jsonb_build_object(
    'canEdit', supply.can_write(),
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', id, 'name', name, 'leadTimeDays', lead_time_days, 'moq', moq,
        'orderMultiple', order_multiple, 'currency', currency, 'active', active, 'source', source
      ) order by name)
      from supply.suppliers
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.supply_save_supplier(p_body jsonb)
returns uuid
language plpgsql
security definer
set search_path = supply, public
as $$
declare
  v_id uuid := nullif(p_body->>'id', '')::uuid;
  v_name text := left(btrim(coalesce(p_body->>'name', '')), 160);
begin
  if not supply.can_write() then
    raise exception 'app: You cannot change suppliers.';
  end if;
  if v_name = '' then
    raise exception 'app: Enter a supplier name.';
  end if;
  if v_id is null then
    insert into supply.suppliers (name, lead_time_days, moq, order_multiple, currency, notes, active, source)
    values (
      v_name,
      (p_body->>'leadTimeDays')::integer,
      (p_body->>'moq')::numeric,
      (p_body->>'orderMultiple')::numeric,
      coalesce(nullif(p_body->>'currency', ''), 'GBP'),
      nullif(p_body->>'notes', ''),
      coalesce((p_body->>'active')::boolean, true),
      'manual'
    )
    returning id into v_id;
  else
    update supply.suppliers set
      name = v_name,
      lead_time_days = (p_body->>'leadTimeDays')::integer,
      moq = (p_body->>'moq')::numeric,
      order_multiple = (p_body->>'orderMultiple')::numeric,
      currency = coalesce(nullif(p_body->>'currency', ''), currency),
      notes = nullif(p_body->>'notes', ''),
      active = coalesce((p_body->>'active')::boolean, active)
    where id = v_id;
    if not found then
      raise exception 'app: That supplier was not found.';
    end if;
  end if;
  return v_id;
end;
$$;

create or replace function public.supply_save_sku(p_body jsonb)
returns void
language plpgsql
security definer
set search_path = supply, public
as $$
declare
  v_sku text := left(btrim(coalesce(p_body->>'sku', '')), 80);
begin
  if not supply.can_write() then
    raise exception 'app: You cannot change SKU settings.';
  end if;
  if v_sku = '' then
    raise exception 'app: Enter a SKU.';
  end if;
  insert into supply.sku_settings (sku, supplier_id, lead_time_days, lead_time_source, moq, order_multiple, safety_days, exclude)
  values (
    v_sku,
    nullif(p_body->>'supplierId', '')::uuid,
    (p_body->>'leadTimeDays')::integer,
    coalesce(nullif(p_body->>'leadTimeSource', ''), 'manual'),
    (p_body->>'moq')::numeric,
    (p_body->>'orderMultiple')::numeric,
    (p_body->>'safetyDays')::integer,
    coalesce((p_body->>'exclude')::boolean, false)
  )
  on conflict (sku) do update set
    supplier_id = excluded.supplier_id,
    lead_time_days = excluded.lead_time_days,
    lead_time_source = excluded.lead_time_source,
    moq = excluded.moq,
    order_multiple = excluded.order_multiple,
    safety_days = excluded.safety_days,
    exclude = excluded.exclude;
end;
$$;

create or replace function public.supply_settings()
returns jsonb
language plpgsql
stable
security definer
set search_path = supply, public
as $$
begin
  if not supply.can_read() then
    raise exception 'app: You cannot see supply records.';
  end if;
  return (
    select jsonb_build_object(
      'serviceLevel', service_level,
      'reviewDays', review_days,
      'defaultLeadTimeDays', default_lead_time_days,
      'forecastMonths', forecast_months,
      'zeroStockAlert', zero_stock_alert,
      'stockLocation', stock_location,
      'smaWindow', sma_window,
      'crostonAlpha', croston_alpha,
      'initialLookbackMonths', initial_lookback_months,
      'canAdmin', supply.can_admin(),
      'lastSync', last_sync_finished_at,
      'lastSyncError', last_sync_error,
      'phase', sync_phase
    )
    from supply.settings where id
  );
end;
$$;

create or replace function public.supply_save_settings(p_body jsonb)
returns void
language plpgsql
security definer
set search_path = supply, public
as $$
begin
  if not supply.can_admin() then
    raise exception 'app: Only a supply admin can change settings.';
  end if;
  update supply.settings set
    service_level = (p_body->>'serviceLevel')::numeric,
    review_days = (p_body->>'reviewDays')::integer,
    default_lead_time_days = (p_body->>'defaultLeadTimeDays')::integer,
    forecast_months = (p_body->>'forecastMonths')::integer,
    zero_stock_alert = coalesce((p_body->>'zeroStockAlert')::boolean, zero_stock_alert),
    stock_location = nullif(left(btrim(coalesce(p_body->>'stockLocation', '')), 80), ''),
    sma_window = (p_body->>'smaWindow')::integer,
    croston_alpha = (p_body->>'crostonAlpha')::numeric,
    initial_lookback_months = (p_body->>'initialLookbackMonths')::integer
  where id;
end;
$$;

create or replace function public.supply_mappings()
returns jsonb
language plpgsql
stable
security definer
set search_path = supply, public
as $$
begin
  if not supply.can_read() then
    raise exception 'app: You cannot see supply records.';
  end if;
  return jsonb_build_object(
    'canEdit', supply.can_write(),
    'canAdmin', supply.can_admin(),
    'mappings', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', id, 'name', name, 'kind', kind, 'columns', columns, 'dateFormat', date_format, 'delimiter', delimiter
      ) order by name)
      from supply.import_mappings
    ), '[]'::jsonb),
    'batches', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', b.id, 'mappingId', b.mapping_id, 'mappingName', m.name, 'kind', m.kind,
        'filePath', b.file_path, 'status', b.status, 'rowsRead', b.rows_read,
        'rowsLoaded', b.rows_loaded, 'rowsUnmatched', b.rows_unmatched, 'createdAt', b.created_at
      ) order by b.created_at desc)
      from supply.import_batches b
      left join supply.import_mappings m on m.id = b.mapping_id
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.supply_save_mapping(p_body jsonb)
returns uuid
language plpgsql
security definer
set search_path = supply, public
as $$
declare
  v_id uuid := nullif(p_body->>'id', '')::uuid;
  v_name text := left(btrim(coalesce(p_body->>'name', '')), 80);
  v_kind text := p_body->>'kind';
  v_format text := coalesce(nullif(p_body->>'dateFormat', ''), 'dd/mm/yyyy');
  v_delimiter text := coalesce(nullif(p_body->>'delimiter', ''), ',');
begin
  if not supply.can_write() then
    raise exception 'app: You cannot change import mappings.';
  end if;
  if v_name = '' then
    raise exception 'app: Enter a mapping name.';
  end if;
  if v_kind not in ('sales_lines', 'purchase_lines', 'suppliers') then
    raise exception 'app: Choose a mapping kind.';
  end if;
  if v_delimiter = '\t' or v_delimiter = 'tab' then
    v_delimiter := E'\t';
  end if;
  if v_id is null then
    insert into supply.import_mappings (name, kind, columns, date_format, delimiter)
    values (v_name, v_kind, coalesce(p_body->'columns', '{}'::jsonb), v_format, v_delimiter)
    returning id into v_id;
  else
    update supply.import_mappings set
      name = v_name,
      kind = v_kind,
      columns = coalesce(p_body->'columns', columns),
      date_format = v_format,
      delimiter = v_delimiter
    where id = v_id;
    if not found then
      raise exception 'app: That mapping was not found.';
    end if;
  end if;
  return v_id;
end;
$$;

create or replace function public.supply_delete_mapping(p_id uuid)
returns void
language plpgsql
security definer
set search_path = supply, public
as $$
begin
  if not supply.can_admin() then
    raise exception 'app: Only a supply admin can delete a mapping.';
  end if;
  delete from supply.import_mappings where id = p_id;
  if not found then
    raise exception 'app: That mapping was not found.';
  end if;
end;
$$;

create or replace function public.supply_import_begin(p_body jsonb)
returns uuid
language plpgsql
security definer
set search_path = supply, public
as $$
declare
  v_id uuid := nullif(p_body->>'batchId', '')::uuid;
  v_mapping uuid := nullif(p_body->>'mappingId', '')::uuid;
begin
  if coalesce(auth.role(), '') is distinct from 'service_role' and not supply.can_write() then
    raise exception 'app: You cannot import supply history.';
  end if;
  if v_mapping is null or not exists (select 1 from supply.import_mappings where id = v_mapping) then
    raise exception 'app: Choose a mapping.';
  end if;
  if v_id is null then
    insert into supply.import_batches (mapping_id, file_path, status, created_by)
    values (v_mapping, nullif(left(coalesce(p_body->>'filePath', ''), 300), ''), 'loading', auth.uid())
    returning id into v_id;
    return v_id;
  end if;
  if not exists (select 1 from supply.import_batches where id = v_id) then
    raise exception 'app: That import batch was not found.';
  end if;
  perform supply.restore_supplier_undo(v_id);
  delete from supply.suppliers where batch_id = v_id;
  delete from supply.demand_monthly where batch_id = v_id;
  delete from supply.po_history where batch_id = v_id;
  delete from supply.import_unmatched where batch_id = v_id;
  update supply.import_batches set
    mapping_id = v_mapping,
    file_path = coalesce(nullif(left(coalesce(p_body->>'filePath', ''), 300), ''), file_path),
    status = 'loading',
    rows_read = 0,
    rows_loaded = 0,
    rows_unmatched = 0,
    errors = '[]'::jsonb,
    undo = '[]'::jsonb
  where id = v_id;
  return v_id;
end;
$$;

create or replace function public.supply_import_chunk(p_batch uuid, p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = supply, public
as $$
declare
  v_kind text;
  v_row jsonb;
  v_name text;
  v_existing uuid;
  v_loaded integer := 0;
begin
  if coalesce(auth.role(), '') is distinct from 'service_role' and not supply.can_write() then
    raise exception 'app: You cannot import supply history.';
  end if;
  select m.kind into v_kind
  from supply.import_batches b
  join supply.import_mappings m on m.id = b.mapping_id
  where b.id = p_batch and b.status in ('pending', 'loading');
  if v_kind is null then
    raise exception 'app: That import batch is not open.';
  end if;

  if v_kind = 'sales_lines' then
    insert into supply.demand_monthly (sku, month, qty, order_count, source, batch_id)
    select left(btrim(sku), 80), date_trunc('month', month)::date, sum(greatest(qty, 0)), sum(greatest(order_count, 0)), 'orderwise', p_batch
    from jsonb_to_recordset(coalesce(p_rows->'demand', '[]'::jsonb)) as x(sku text, month date, qty numeric, order_count integer)
    where nullif(btrim(sku), '') is not null and month is not null
    group by left(btrim(sku), 80), date_trunc('month', month)::date
    on conflict (sku, month, batch_id) where batch_id is not null
    do update set qty = supply.demand_monthly.qty + excluded.qty, order_count = supply.demand_monthly.order_count + excluded.order_count;
    get diagnostics v_loaded = row_count;
  elsif v_kind = 'purchase_lines' then
    insert into supply.po_history (source, po_ref, supplier_key, sku, qty, ordered_on, received_on, batch_id)
    select 'orderwise', left(btrim(po_ref), 80), left(nullif(btrim(supplier_key), ''), 160), left(btrim(sku), 80),
           greatest(qty, 0), ordered_on, received_on, p_batch
    from jsonb_to_recordset(coalesce(p_rows->'purchases', '[]'::jsonb)) as x(
      po_ref text, supplier_key text, sku text, qty numeric, ordered_on date, received_on date
    )
    where nullif(btrim(po_ref), '') is not null and nullif(btrim(sku), '') is not null;
    get diagnostics v_loaded = row_count;
  elsif v_kind = 'suppliers' then
    for v_row in select value from jsonb_array_elements(coalesce(p_rows->'suppliers', '[]'::jsonb))
    loop
      v_name := left(btrim(coalesce(v_row->>'name', '')), 160);
      if v_name = '' then continue; end if;
      select id into v_existing from supply.suppliers where lower(name) = lower(v_name) order by created_at limit 1;
      if v_existing is null then
        insert into supply.suppliers (name, lead_time_days, moq, order_multiple, currency, active, source, batch_id)
        values (
          v_name,
          (v_row->>'leadTimeDays')::integer,
          (v_row->>'moq')::numeric,
          (v_row->>'orderMultiple')::numeric,
          coalesce(nullif(v_row->>'currency', ''), 'GBP'),
          true,
          'orderwise',
          p_batch
        );
      else
        update supply.import_batches b set undo = b.undo || jsonb_build_array(jsonb_build_object(
          'id', s.id, 'lead_time_days', s.lead_time_days, 'moq', s.moq, 'order_multiple', s.order_multiple,
          'currency', s.currency, 'notes', s.notes, 'active', s.active
        ))
        from supply.suppliers s
        where b.id = p_batch and s.id = v_existing
          and not exists (
            select 1 from jsonb_array_elements(b.undo) item where item->>'id' = v_existing::text
          );
        update supply.suppliers set
          lead_time_days = coalesce((v_row->>'leadTimeDays')::integer, lead_time_days),
          moq = coalesce((v_row->>'moq')::numeric, moq),
          order_multiple = coalesce((v_row->>'orderMultiple')::numeric, order_multiple),
          currency = coalesce(nullif(v_row->>'currency', ''), currency)
        where id = v_existing;
      end if;
      v_loaded := v_loaded + 1;
    end loop;
  end if;

  insert into supply.import_unmatched (batch_id, external_code, qty)
  select p_batch, left(btrim(code), 80), sum(greatest(coalesce(qty, 0), 0))
  from jsonb_to_recordset(coalesce(p_rows->'unmatched', '[]'::jsonb)) as x(code text, qty numeric)
  where nullif(btrim(code), '') is not null
  group by left(btrim(code), 80)
  on conflict (batch_id, external_code) do update set qty = supply.import_unmatched.qty + excluded.qty;

  return jsonb_build_object('loaded', v_loaded);
end;
$$;

create or replace function public.supply_import_finish(p_batch uuid, p_body jsonb)
returns void
language plpgsql
security definer
set search_path = supply, public
as $$
begin
  if coalesce(auth.role(), '') is distinct from 'service_role' and not supply.can_write() then
    raise exception 'app: You cannot import supply history.';
  end if;
  update supply.import_batches b set
    status = 'loaded',
    rows_read = greatest(coalesce((p_body->>'rowsRead')::integer, 0), 0),
    rows_loaded = (
      select count(*) from supply.demand_monthly d where d.batch_id = b.id
    ) + (
      select count(*) from supply.po_history p where p.batch_id = b.id
    ) + (
      select count(*) from supply.suppliers s where s.batch_id = b.id
    ),
    rows_unmatched = (select count(*) from supply.import_unmatched u where u.batch_id = b.id),
    errors = coalesce(p_body->'errors', '[]'::jsonb)
  where b.id = p_batch and b.status in ('pending', 'loading');
  if not found then
    raise exception 'app: That import batch is not open.';
  end if;
end;
$$;

create or replace function public.supply_remove_batch(p_batch uuid)
returns void
language plpgsql
security definer
set search_path = supply, public
as $$
declare
  v_name text;
begin
  if coalesce(auth.role(), '') is distinct from 'service_role' and not supply.can_write() then
    raise exception 'app: You cannot remove an import batch.';
  end if;
  select coalesce(m.name, b.file_path, b.id::text) into v_name
  from supply.import_batches b
  left join supply.import_mappings m on m.id = b.mapping_id
  where b.id = p_batch;
  if v_name is null then
    raise exception 'app: That import batch was not found.';
  end if;
  perform supply.restore_supplier_undo(p_batch);
  update supply.import_batches set undo = '[]'::jsonb where id = p_batch;
  delete from supply.import_batches where id = p_batch;
end;
$$;

create or replace function public.supply_unmatched(p_batch uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = supply, public
as $$
begin
  if not supply.can_read() and coalesce(auth.role(), '') is distinct from 'service_role' then
    raise exception 'app: You cannot see supply records.';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('code', external_code, 'qty', qty) order by external_code)
    from supply.import_unmatched where batch_id = p_batch
  ), '[]'::jsonb);
end;
$$;

create or replace function public.supply_aliases()
returns jsonb
language plpgsql
stable
security definer
set search_path = supply, public
as $$
begin
  if not supply.can_read() then
    raise exception 'app: You cannot see supply records.';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', id, 'source', source, 'externalCode', external_code, 'sku', sku) order by external_code)
    from supply.sku_aliases
  ), '[]'::jsonb);
end;
$$;

create or replace function public.supply_save_alias(p_body jsonb)
returns void
language plpgsql
security definer
set search_path = supply, public
as $$
declare
  v_source text := coalesce(nullif(p_body->>'source', ''), 'orderwise');
  v_code text := left(btrim(coalesce(p_body->>'externalCode', '')), 80);
  v_sku text := left(btrim(coalesce(p_body->>'sku', '')), 80);
begin
  if not supply.can_write() then
    raise exception 'app: You cannot change SKU aliases.';
  end if;
  if v_source not in ('orderwise', 'cin7') or v_code = '' or v_sku = '' then
    raise exception 'app: Enter a code and a SKU.';
  end if;
  insert into supply.sku_aliases (source, external_code, sku)
  values (v_source, v_code, v_sku)
  on conflict (source, external_code) do update set sku = excluded.sku;
end;
$$;

revoke all on function public.supply_sync_state() from public, anon, authenticated;
revoke all on function public.supply_sync_state_save(jsonb) from public, anon, authenticated;
revoke all on function public.supply_sync_products(jsonb) from public, anon, authenticated;
revoke all on function public.supply_sync_suppliers(jsonb) from public, anon, authenticated;
revoke all on function public.supply_sync_stock(jsonb) from public, anon, authenticated;
revoke all on function public.supply_sync_stock_fold(timestamptz) from public, anon, authenticated;
revoke all on function public.supply_sync_sales(jsonb) from public, anon, authenticated;
revoke all on function public.supply_sync_purchases(jsonb) from public, anon, authenticated;
revoke all on function public.supply_forecast_inputs(integer, integer) from public, anon, authenticated;
revoke all on function public.supply_save_run(jsonb) from public, anon, authenticated;
grant execute on function public.supply_sync_state() to service_role;
grant execute on function public.supply_sync_state_save(jsonb) to service_role;
grant execute on function public.supply_sync_products(jsonb) to service_role;
grant execute on function public.supply_sync_suppliers(jsonb) to service_role;
grant execute on function public.supply_sync_stock(jsonb) to service_role;
grant execute on function public.supply_sync_stock_fold(timestamptz) to service_role;
grant execute on function public.supply_sync_sales(jsonb) to service_role;
grant execute on function public.supply_sync_purchases(jsonb) to service_role;
grant execute on function public.supply_forecast_inputs(integer, integer) to service_role;
grant execute on function public.supply_save_run(jsonb) to service_role;

revoke all on function public.supply_assert_admin() from public, anon;
revoke all on function public.supply_overview() from public, anon;
revoke all on function public.supply_reorder() from public, anon;
revoke all on function public.supply_set_qty(uuid, numeric) from public, anon;
revoke all on function public.supply_skus(text, integer, integer) from public, anon;
revoke all on function public.supply_sku(text) from public, anon;
revoke all on function public.supply_suppliers() from public, anon;
revoke all on function public.supply_save_supplier(jsonb) from public, anon;
revoke all on function public.supply_save_sku(jsonb) from public, anon;
revoke all on function public.supply_settings() from public, anon;
revoke all on function public.supply_save_settings(jsonb) from public, anon;
revoke all on function public.supply_mappings() from public, anon;
revoke all on function public.supply_save_mapping(jsonb) from public, anon;
revoke all on function public.supply_delete_mapping(uuid) from public, anon;
revoke all on function public.supply_import_begin(jsonb) from public, anon;
revoke all on function public.supply_import_chunk(uuid, jsonb) from public, anon;
revoke all on function public.supply_import_finish(uuid, jsonb) from public, anon;
revoke all on function public.supply_remove_batch(uuid) from public, anon;
revoke all on function public.supply_unmatched(uuid) from public, anon;
revoke all on function public.supply_aliases() from public, anon;
revoke all on function public.supply_save_alias(jsonb) from public, anon;

grant execute on function public.supply_assert_admin() to authenticated, service_role;
grant execute on function public.supply_overview() to authenticated, service_role;
grant execute on function public.supply_reorder() to authenticated, service_role;
grant execute on function public.supply_set_qty(uuid, numeric) to authenticated, service_role;
grant execute on function public.supply_skus(text, integer, integer) to authenticated, service_role;
grant execute on function public.supply_sku(text) to authenticated, service_role;
grant execute on function public.supply_suppliers() to authenticated, service_role;
grant execute on function public.supply_save_supplier(jsonb) to authenticated, service_role;
grant execute on function public.supply_save_sku(jsonb) to authenticated, service_role;
grant execute on function public.supply_settings() to authenticated, service_role;
grant execute on function public.supply_save_settings(jsonb) to authenticated, service_role;
grant execute on function public.supply_mappings() to authenticated, service_role;
grant execute on function public.supply_save_mapping(jsonb) to authenticated, service_role;
grant execute on function public.supply_delete_mapping(uuid) to authenticated, service_role;
grant execute on function public.supply_import_begin(jsonb) to authenticated, service_role;
grant execute on function public.supply_import_chunk(uuid, jsonb) to authenticated, service_role;
grant execute on function public.supply_import_finish(uuid, jsonb) to authenticated, service_role;
grant execute on function public.supply_remove_batch(uuid) to authenticated, service_role;
grant execute on function public.supply_unmatched(uuid) to authenticated, service_role;
grant execute on function public.supply_aliases() to authenticated, service_role;
grant execute on function public.supply_save_alias(jsonb) to authenticated, service_role;
