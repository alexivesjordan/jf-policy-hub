-- A fresh quote cannot book a second live install for the same order.
-- The quote's own install can still be rebooked. Order keys also drop zero-width spaces.

create or replace function ops.install_order_key(p_order text)
returns text
language sql
immutable
as $$
  select nullif(lower(regexp_replace(
    coalesce(p_order, ''),
    '[\s' || chr(8203) || '-' || chr(8205) || chr(8288) || chr(65279) || chr(160) || ']',
    '',
    'g'
  )), '');
$$;

revoke all on function ops.install_order_key(text) from public, anon, authenticated;

create or replace function public.install_book(p_quote_id uuid, p_start date, p_warranty text)
returns jsonb
language plpgsql
security definer
set search_path = ops, public
as $$
declare
  v_quote ops.install_quotes%rowtype;
  v_payload jsonb;
  v_weekends boolean := false;
  v_total integer;
  v_days date[];
  v_ids uuid[];
  v_install uuid;
  v_end date;
  v_option text := nullif(p_warranty, 'none');
  v_price numeric;
  v_resources jsonb;
  v_requirements jsonb;
  v_existing ops.installs%rowtype;
  v_block text;
  v_rebook boolean := false;
begin
  if ops.is_field_engineer() then
    raise exception 'app: You cannot book an install.';
  end if;
  if not (public.workspace_can('sales', 'edit') or public.workspace_can('operations', 'edit')) then
    raise exception 'app: You cannot book an install.';
  end if;
  select * into v_quote from ops.install_quotes where id = p_quote_id for update;
  if v_quote.id is null then
    raise exception 'app: Price the order before booking.';
  end if;
  if v_quote.install_id is not null then
    select * into v_existing from ops.installs where id = v_quote.install_id for update;
    if v_existing.status = 'quoting' then
      raise exception 'app: That order is out for a subcontractor quote.';
    end if;
    if v_existing.id is not null and v_existing.status not in ('cancelled', 'completed') then
      v_rebook := true;
    end if;
  end if;
  select other.status into v_block
  from ops.installs other
  where other.id is distinct from v_quote.install_id
    and other.status not in ('cancelled', 'completed')
    and ops.install_order_key(other.order_number) is not null
    and ops.install_order_key(other.order_number) = ops.install_order_key(v_quote.order_number)
  order by case when other.status = 'quoting' then 0 else 1 end
  limit 1;
  if v_block = 'quoting' then
    raise exception 'app: That order is out for a subcontractor quote.';
  end if;
  if v_block is not null then
    raise exception 'app: That order is already booked.';
  end if;
  if v_quote.created_by is distinct from auth.uid() and not public.workspace_is_admin() and not public.workspace_can('operations', 'edit') then
    raise exception 'app: You cannot book that quote.';
  end if;
  v_payload := v_quote.payload;
  v_total := greatest(coalesce((v_payload->>'totalDays')::integer, 1), 1);
  select coalesce(array_agg(day order by day), '{}') into v_days
  from ops.install_working_days(p_start, v_total, v_weekends) as day;
  if coalesce(array_length(v_days, 1), 0) < v_total or v_days[1] is distinct from p_start then
    raise exception 'app: Choose a weekday start date.';
  end if;
  if v_rebook then
    delete from ops.install_reservations where install_id = v_existing.id;
  end if;
  v_requirements := coalesce(v_payload->'requirements', '{}'::jsonb);
  v_ids := ops.pick_install_resources(
    v_days,
    greatest(coalesce((v_requirements->>'installers')::integer, 1), 1),
    greatest(coalesce((v_requirements->>'licensedDrivers')::integer, 0), 0),
    coalesce(v_requirements->>'vanSize', 'small'),
    greatest(coalesce((v_requirements->>'vanCount')::integer, 1), 1),
    coalesce((v_requirements->>'stairClimber')::boolean, false)
  );
  if v_ids is null then
    raise exception 'app: Those engineers or vans are no longer free. Choose another start date.';
  end if;
  if v_option is not null and v_option not in ('annual', 'twice_yearly', 'extension', 'annual_bundle', 'twice_yearly_bundle') then
    raise exception 'app: Choose a warranty option from the priced quote.';
  end if;
  v_price := case v_option
    when 'annual' then (v_payload #>> '{warranty,annual}')::numeric
    when 'twice_yearly' then (v_payload #>> '{warranty,twice}')::numeric
    when 'extension' then (v_payload #>> '{warranty,extension}')::numeric
    when 'annual_bundle' then (v_payload #>> '{warranty,annualBundle}')::numeric
    when 'twice_yearly_bundle' then (v_payload #>> '{warranty,twiceBundle}')::numeric
    else null
  end;
  if v_option is not null and v_price is null then
    raise exception 'app: That warranty option was not priced.';
  end if;
  v_end := v_days[array_length(v_days, 1)];
  if v_rebook then
    v_resources := ops.hold_install_resources(v_existing.id, v_ids, v_days);
    update ops.installs set
      goods_net = (v_payload->>'goodsNet')::numeric,
      install_price = (v_payload->>'installPrice')::numeric,
      warranty_option = v_option,
      warranty_price = v_price,
      start_on = p_start,
      end_on = v_end,
      resources = v_resources,
      updated_at = now()
    where id = v_existing.id;
    return public.install_read(v_existing.id);
  end if;
  insert into ops.installs (
    quote_id, order_number, goods_net, install_price, warranty_option, warranty_price,
    start_on, end_on, customer_name, contact_name, contact_email, contact_phone, site_address,
    status, booking_rep_id, service_quote_id, proposal_path,
    flags, hq_build, site_install, crew, van_size, van_count, lines, cin7_sale_id, cin7_customer_id
  ) values (
    v_quote.id, v_quote.order_number,
    (v_payload->>'goodsNet')::numeric, (v_payload->>'installPrice')::numeric,
    v_option, v_price, p_start, v_end,
    coalesce(v_payload->>'customerName', ''),
    v_payload->>'contactName', v_payload->>'contactEmail', v_payload->>'contactPhone', v_payload->>'siteAddress',
    'booked', auth.uid(),
    nullif(v_payload->>'serviceQuoteId', '')::uuid, v_payload->>'proposalPath',
    coalesce(v_payload->'flags', '[]'::jsonb),
    coalesce(v_payload->'hqBuild', '{}'::jsonb),
    coalesce(v_payload->'siteInstall', '{}'::jsonb),
    greatest(coalesce((v_requirements->>'installers')::integer, 1), 1),
    coalesce(v_requirements->>'vanSize', 'small'),
    greatest(coalesce((v_requirements->>'vanCount')::integer, 1), 1),
    coalesce(v_payload->'lines', '[]'::jsonb),
    v_payload->>'cin7SaleId', v_payload->>'cin7CustomerId'
  ) returning id into v_install;
  v_resources := ops.hold_install_resources(v_install, v_ids, v_days);
  update ops.installs set resources = v_resources where id = v_install;
  update ops.install_quotes set install_id = v_install where id = v_quote.id;
  return public.install_read(v_install);
end;
$$;


create or replace function public.subcontractor_followup(p_install uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ops, public
as $$
declare
  v_row ops.installs%rowtype;
  v_quote ops.install_quotes%rowtype;
begin
  if ops.is_field_engineer() then
    raise exception 'app: Field engineers cannot do that.';
  end if;
  if not (public.workspace_can('sales', 'view') or public.workspace_can('operations', 'view') or public.workspace_is_admin()) then
    raise exception 'app: You cannot see that install.';
  end if;
  select * into v_row from ops.installs where id = p_install;
  if v_row.id is null or v_row.status is distinct from 'quoting' then
    return null;
  end if;
  select * into v_quote from ops.install_quotes where id = v_row.quote_id;
  return jsonb_build_object(
    'quoteId', v_quote.id,
    'orderNumber', v_row.order_number,
    'customerName', v_row.customer_name,
    'postcode', coalesce(v_quote.payload->>'postcode', ''),
    'crew', v_row.crew,
    'suggestedDates', to_jsonb(v_row.suggested_dates),
    'lines', coalesce((
      select jsonb_agg(jsonb_build_object(
        'qty', coalesce(item->>'qty', '0'),
        'description', coalesce(item->>'description', ''),
        'category', item->>'category'
      ))
      from jsonb_array_elements(coalesce(v_row.lines, '[]'::jsonb)) as listed(item)
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.subcontractor_followup(uuid) from public, anon;
grant execute on function public.subcontractor_followup(uuid) to authenticated, service_role;
