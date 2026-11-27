-- Pulse Supply API. Sync is service-role only. People use these functions; tables stay closed.
-- New file only. Do not apply to production.

create or replace function supply.rebuild_cin7_demand(p_pairs jsonb)
returns void
language plpgsql
security definer
set search_path = supply, public
as $$
begin
  delete from supply.demand_monthly d
  using (
    select distinct sku, month::date as month
    from jsonb_to_recordset(coalesce(p_pairs, '[]'::jsonb)) as x(sku text, month date)
  ) t
  where d.source = 'cin7'
    and d.sku = t.sku
    and d.month = t.month
    and not exists (
      select 1 from supply.cin7_sale_lines l
      where l.sku = t.sku and l.month = t.month
    );

  insert into supply.demand_monthly (sku, month, qty, order_count, source)
  select l.sku, l.month, sum(l.qty), count(distinct l.sale_id), 'cin7'
  from supply.cin7_sale_lines l
  join (
    select distinct sku, month::date as month
    from jsonb_to_recordset(coalesce(p_pairs, '[]'::jsonb)) as x(sku text, month date)
  ) t on t.sku = l.sku and t.month = l.month
  group by l.sku, l.month
  on conflict (sku, month) where source = 'cin7'
  do update set qty = excluded.qty, order_count = excluded.order_count;
end;
$$;

create or replace function supply.restore_supplier_undo(p_batch uuid)
returns void
language plpgsql
security definer
set search_path = supply, public
as $$
declare
  v_row jsonb;
begin
  for v_row in
    select value from jsonb_array_elements(coalesce((select undo from supply.import_batches where id = p_batch), '[]'::jsonb))
  loop
    update supply.suppliers
    set lead_time_days = (v_row->>'lead_time_days')::integer,
        moq = (v_row->>'moq')::numeric,
        order_multiple = (v_row->>'order_multiple')::numeric,
        currency = coalesce(v_row->>'currency', currency),
        notes = v_row->>'notes',
        active = coalesce((v_row->>'active')::boolean, active)
    where id = (v_row->>'id')::uuid;
  end loop;
end;
$$;

revoke all on function supply.rebuild_cin7_demand(jsonb) from public, anon, authenticated;
revoke all on function supply.restore_supplier_undo(uuid) from public, anon, authenticated;
grant execute on function supply.rebuild_cin7_demand(jsonb) to service_role;
grant execute on function supply.restore_supplier_undo(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Sync. Counts and cursors only. Payloads are not returned.
-- ---------------------------------------------------------------------------

create or replace function public.supply_sync_state()
returns jsonb
language plpgsql
stable
security definer
set search_path = supply, public
as $$
declare
  v_row supply.settings;
begin
  if coalesce(auth.role(), '') is distinct from 'service_role' then
    raise exception 'app: Only the sync can read the cursor.';
  end if;
  select * into v_row from supply.settings where id;
  return jsonb_build_object(
    'phase', v_row.sync_phase,
    'productsPage', v_row.products_page,
    'suppliersPage', v_row.suppliers_page,
    'availabilityPage', v_row.availability_page,
    'salesPage', v_row.sales_page,
    'purchasesPage', v_row.purchases_page,
    'forecastOffset', v_row.forecast_offset,
    'forecastRunId', v_row.forecast_run_id,
    'salesSince', v_row.sales_since,
    'purchasesSince', v_row.purchases_since,
    'runStartedAt', v_row.run_started_at,
    'stockLocation', v_row.stock_location,
    'lookbackMonths', v_row.initial_lookback_months,
    'lastSyncFinishedAt', v_row.last_sync_finished_at,
    'lastSyncCalls', v_row.last_sync_calls,
    'lastSyncError', v_row.last_sync_error
  );
end;
$$;

create or replace function public.supply_sync_state_save(p_body jsonb)
returns void
language plpgsql
security definer
set search_path = supply, public
as $$
begin
  if coalesce(auth.role(), '') is distinct from 'service_role' then
    raise exception 'app: Only the sync can move the cursor.';
  end if;
  update supply.settings set
    sync_phase = coalesce(p_body->>'phase', sync_phase),
    products_page = coalesce((p_body->>'productsPage')::integer, products_page),
    suppliers_page = coalesce((p_body->>'suppliersPage')::integer, suppliers_page),
    availability_page = coalesce((p_body->>'availabilityPage')::integer, availability_page),
    sales_page = coalesce((p_body->>'salesPage')::integer, sales_page),
    purchases_page = coalesce((p_body->>'purchasesPage')::integer, purchases_page),
    forecast_offset = coalesce((p_body->>'forecastOffset')::integer, forecast_offset),
    forecast_run_id = case
      when p_body ? 'forecastRunId' then nullif(p_body->>'forecastRunId', '')::uuid
      else forecast_run_id
    end,
    sales_since = case when p_body ? 'salesSince' then nullif(p_body->>'salesSince', '')::timestamptz else sales_since end,
    purchases_since = case when p_body ? 'purchasesSince' then nullif(p_body->>'purchasesSince', '')::timestamptz else purchases_since end,
    run_started_at = case when p_body ? 'runStartedAt' then nullif(p_body->>'runStartedAt', '')::timestamptz else run_started_at end,
    last_sync_started_at = case when p_body ? 'lastSyncStartedAt' then nullif(p_body->>'lastSyncStartedAt', '')::timestamptz else last_sync_started_at end,
    last_sync_finished_at = case when p_body ? 'lastSyncFinishedAt' then nullif(p_body->>'lastSyncFinishedAt', '')::timestamptz else last_sync_finished_at end,
    last_sync_calls = coalesce((p_body->>'lastSyncCalls')::integer, last_sync_calls),
    last_sync_error = case when p_body ? 'lastSyncError' then left(nullif(p_body->>'lastSyncError', ''), 300) else last_sync_error end
  where id;
end;
$$;

create or replace function public.supply_sync_products(p_rows jsonb)
returns integer
language plpgsql
security definer
set search_path = supply, public
as $$
declare
  v_count integer := 0;
begin
  if coalesce(auth.role(), '') is distinct from 'service_role' then
    raise exception 'app: Only the sync can refresh products.';
  end if;
  insert into supply.sku_settings (sku, label)
  select left(btrim(sku), 80), left(nullif(btrim(label), ''), 200)
  from jsonb_to_recordset(coalesce(p_rows, '[]'::jsonb)) as x(sku text, label text)
  where nullif(btrim(sku), '') is not null
  on conflict (sku) do update set label = excluded.label
  where supply.sku_settings.label is distinct from excluded.label;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create or replace function public.supply_sync_suppliers(p_rows jsonb)
returns integer
language plpgsql
security definer
set search_path = supply, public
as $$
declare
  v_count integer := 0;
begin
  if coalesce(auth.role(), '') is distinct from 'service_role' then
    raise exception 'app: Only the sync can refresh suppliers.';
  end if;
  insert into supply.suppliers (cin7_supplier_id, name, currency, active, source)
  select left(btrim(cin7_supplier_id), 80), left(btrim(name), 160), coalesce(nullif(currency, ''), 'GBP'), coalesce(active, true), 'cin7'
  from jsonb_to_recordset(coalesce(p_rows, '[]'::jsonb)) as x(cin7_supplier_id text, name text, currency text, active boolean)
  where nullif(btrim(cin7_supplier_id), '') is not null and nullif(btrim(name), '') is not null
  on conflict (cin7_supplier_id) where cin7_supplier_id is not null
  do update set
    name = excluded.name,
    currency = excluded.currency,
    active = excluded.active,
    source = case when supply.suppliers.source = 'manual' then 'cin7' else supply.suppliers.source end;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create or replace function public.supply_sync_stock(p_rows jsonb)
returns integer
language plpgsql
security definer
set search_path = supply, public
as $$
declare
  v_count integer := 0;
begin
  if coalesce(auth.role(), '') is distinct from 'service_role' then
    raise exception 'app: Only the sync can refresh stock.';
  end if;
  insert into supply.stock_location_stage (sku, location, on_hand, allocated, available, on_order)
  select left(btrim(sku), 80), left(coalesce(location, ''), 80),
         greatest(coalesce(on_hand, 0), 0), greatest(coalesce(allocated, 0), 0),
         greatest(coalesce(available, 0), 0), greatest(coalesce(on_order, 0), 0)
  from jsonb_to_recordset(coalesce(p_rows, '[]'::jsonb)) as x(
    sku text, location text, on_hand numeric, allocated numeric, available numeric, on_order numeric
  )
  where nullif(btrim(sku), '') is not null
  on conflict (sku, location) do update set
    on_hand = excluded.on_hand,
    allocated = excluded.allocated,
    available = excluded.available,
    on_order = excluded.on_order;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create or replace function public.supply_sync_stock_fold(p_captured timestamptz)
returns integer
language plpgsql
security definer
set search_path = supply, public
as $$
declare
  v_count integer := 0;
begin
  if coalesce(auth.role(), '') is distinct from 'service_role' then
    raise exception 'app: Only the sync can store stock.';
  end if;
  if p_captured is null then
    raise exception 'app: Stock needs a capture time.';
  end if;
  insert into supply.stock_snapshots (sku, on_hand, allocated, available, on_order, captured_at)
  select sku, sum(on_hand), sum(allocated), sum(available), sum(on_order), p_captured
  from supply.stock_location_stage
  group by sku
  on conflict (sku, captured_on) do update set
    on_hand = excluded.on_hand,
    allocated = excluded.allocated,
    available = excluded.available,
    on_order = excluded.on_order,
    captured_at = excluded.captured_at;
  get diagnostics v_count = row_count;
  truncate supply.stock_location_stage;
  return v_count;
end;
$$;

create or replace function public.supply_sync_sales(p_rows jsonb)
returns integer
language plpgsql
security definer
set search_path = supply, public
as $$
declare
  v_sale jsonb;
  v_keep boolean;
  v_id text;
  v_month date;
  v_touched jsonb := '[]'::jsonb;
  v_count integer := 0;
begin
  if coalesce(auth.role(), '') is distinct from 'service_role' then
    raise exception 'app: Only the sync can write Cin7 sales.';
  end if;
  for v_sale in select value from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb))
  loop
    v_id := nullif(left(btrim(v_sale->>'saleId'), 80), '');
    if v_id is null then continue; end if;
    v_keep := upper(coalesce(v_sale->>'status', '')) in (
      'ORDERED', 'BACKORDERED', 'PICKING', 'PICKED', 'PACKING', 'PACKED',
      'SHIPPING', 'INVOICING', 'INVOICED', 'COMPLETED'
    );
    v_month := date_trunc('month', nullif(v_sale->>'orderedOn', '')::date)::date;
    v_touched := v_touched || coalesce((
      select jsonb_agg(jsonb_build_object('sku', sku, 'month', month))
      from supply.cin7_sale_lines where sale_id = v_id
    ), '[]'::jsonb);
    delete from supply.cin7_sale_lines where sale_id = v_id;
    if v_keep and v_month is not null then
      insert into supply.cin7_sale_lines (sale_id, sku, month, qty)
      select v_id, left(btrim(sku), 80), v_month, sum(greatest(coalesce(qty, 0), 0))
      from jsonb_to_recordset(coalesce(v_sale->'lines', '[]'::jsonb)) as x(sku text, qty numeric)
      where nullif(btrim(sku), '') is not null
      group by left(btrim(sku), 80);
      v_touched := v_touched || coalesce((
        select jsonb_agg(jsonb_build_object('sku', sku, 'month', month))
        from supply.cin7_sale_lines where sale_id = v_id
      ), '[]'::jsonb);
      v_count := v_count + 1;
    end if;
  end loop;
  perform supply.rebuild_cin7_demand(v_touched);
  return v_count;
end;
$$;

create or replace function public.supply_sync_purchases(p_body jsonb)
returns integer
language plpgsql
security definer
set search_path = supply, public
as $$
declare
  v_count integer := 0;
  v_ref text;
begin
  if coalesce(auth.role(), '') is distinct from 'service_role' then
    raise exception 'app: Only the sync can write Cin7 purchases.';
  end if;
  for v_ref in
    select value from jsonb_array_elements_text(coalesce(p_body->'voided', '[]'::jsonb))
  loop
    delete from supply.po_history where source = 'cin7' and po_ref = left(btrim(v_ref), 80);
  end loop;
  insert into supply.po_history (source, po_ref, supplier_key, sku, qty, ordered_on, received_on)
  select 'cin7', left(btrim(po_ref), 80), left(nullif(btrim(supplier_key), ''), 160), left(btrim(sku), 80),
         greatest(coalesce(qty, 0), 0), ordered_on, received_on
  from jsonb_to_recordset(coalesce(p_body->'lines', '[]'::jsonb)) as x(
    po_ref text, supplier_key text, sku text, qty numeric, ordered_on date, received_on date
  )
  where nullif(btrim(po_ref), '') is not null and nullif(btrim(sku), '') is not null
  on conflict (po_ref, sku) where source = 'cin7'
  do update set
    supplier_key = excluded.supplier_key,
    qty = excluded.qty,
    ordered_on = excluded.ordered_on,
    received_on = excluded.received_on;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create or replace function public.supply_forecast_inputs(p_offset integer, p_limit integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = supply, public
as $$
declare
  v_settings jsonb;
  v_rows jsonb;
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 100);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
begin
  if coalesce(auth.role(), '') is distinct from 'service_role' then
    raise exception 'app: Only the sync can read forecast inputs.';
  end if;
  select jsonb_build_object(
    'serviceLevel', service_level,
    'reviewDays', review_days,
    'defaultLeadTimeDays', default_lead_time_days,
    'forecastMonths', forecast_months,
    'smaWindow', sma_window,
    'crostonAlpha', croston_alpha
  ) into v_settings
  from supply.settings where id;

  with page as (
    select k.sku
    from supply.sku_settings k
    where not k.exclude
      and (
        exists (select 1 from supply.stock_snapshots ss where ss.sku = k.sku)
        or exists (select 1 from supply.demand_monthly d where d.sku = k.sku)
      )
    order by k.sku
    offset v_offset
    limit v_limit
  ), stock as (
    select distinct on (ss.sku) ss.sku, ss.on_hand, ss.available, ss.on_order
    from supply.stock_snapshots ss
    join page p on p.sku = ss.sku
    order by ss.sku, ss.captured_at desc
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'sku', k.sku,
    'supplierId', k.supplier_id,
    'leadTimeDays', coalesce(k.lead_time_days, sup.lead_time_days, (v_settings->>'defaultLeadTimeDays')::integer),
    'moq', coalesce(k.moq, sup.moq, 0),
    'orderMultiple', coalesce(k.order_multiple, sup.order_multiple, 0),
    'safetyDays', k.safety_days,
    'onHand', coalesce(st.on_hand, 0),
    'available', coalesce(st.available, 0),
    'onOrder', coalesce(st.on_order, 0),
    'demand', coalesce((
      select jsonb_agg(jsonb_build_object('month', d.month, 'qty', d.qty, 'source', d.source) order by d.month, d.source)
      from supply.demand_monthly d
      where d.sku = k.sku
    ), '[]'::jsonb)
  ) order by k.sku), '[]'::jsonb)
  into v_rows
  from page p
  join supply.sku_settings k on k.sku = p.sku
  left join supply.suppliers sup on sup.id = k.supplier_id
  left join stock st on st.sku = k.sku;

  return jsonb_build_object('settings', v_settings, 'rows', v_rows);
end;
$$;

create or replace function public.supply_save_run(p_body jsonb)
returns uuid
language plpgsql
security definer
set search_path = supply, public
as $$
declare
  v_id uuid;
begin
  if coalesce(auth.role(), '') is distinct from 'service_role' then
    raise exception 'app: Only the sync can store a forecast.';
  end if;
  v_id := nullif(p_body->>'runId', '')::uuid;
  if v_id is null then
    insert into supply.forecast_runs (settings, created_by)
    values (coalesce(p_body->'settings', '{}'::jsonb), auth.uid())
    returning id into v_id;
    update supply.settings set forecast_run_id = v_id where id;
  end if;
  insert into supply.forecasts (run_id, sku, method, month, qty)
  select v_id, left(btrim(sku), 80), method, month, greatest(coalesce(qty, 0), 0)
  from jsonb_to_recordset(coalesce(p_body->'forecasts', '[]'::jsonb)) as x(sku text, method text, month date, qty numeric)
  where nullif(btrim(sku), '') is not null
  on conflict (run_id, sku, month) do update set method = excluded.method, qty = excluded.qty;
  insert into supply.reorder_suggestions (
    run_id, supplier_id, sku, on_hand, available, on_order, reorder_point, suggested_qty, reason,
    zero_stock, below_reorder, overstock
  )
  select v_id, supplier_id, left(btrim(sku), 80),
         greatest(coalesce(on_hand, 0), 0), greatest(coalesce(available, 0), 0), greatest(coalesce(on_order, 0), 0),
         greatest(coalesce(reorder_point, 0), 0), greatest(coalesce(suggested_qty, 0), 0), left(coalesce(reason, ''), 200),
         coalesce(zero_stock, false), coalesce(below_reorder, false), coalesce(overstock, false)
  from jsonb_to_recordset(coalesce(p_body->'suggestions', '[]'::jsonb)) as x(
    supplier_id uuid, sku text, on_hand numeric, available numeric, on_order numeric,
    reorder_point numeric, suggested_qty numeric, reason text,
    zero_stock boolean, below_reorder boolean, overstock boolean
  )
  where nullif(btrim(sku), '') is not null
  on conflict (run_id, sku) do update set
    supplier_id = excluded.supplier_id,
    on_hand = excluded.on_hand,
    available = excluded.available,
    on_order = excluded.on_order,
    reorder_point = excluded.reorder_point,
    suggested_qty = excluded.suggested_qty,
    reason = excluded.reason,
    zero_stock = excluded.zero_stock,
    below_reorder = excluded.below_reorder,
    overstock = excluded.overstock;
  if coalesce((p_body->>'done')::boolean, false) then
    update supply.forecast_runs set finished_at = now() where id = v_id;
    update supply.settings set forecast_run_id = null, forecast_offset = 0 where id;
  end if;
  return v_id;
end;
$$;

create or replace function public.supply_assert_admin()
returns void
language plpgsql
security definer
set search_path = supply, public
as $$
begin
  if not supply.can_admin() then
    raise exception 'app: Only a supply admin can refresh Cin7.';
  end if;
end;
$$;
