-- Weekday starts only. Owner weekend overrides come later.
-- Replaces the three functions from 20261111140000. Do not apply this to production.

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
begin
  if not (public.workspace_can('sales', 'edit') or public.workspace_can('operations', 'edit')) then
    raise exception 'app: You cannot book an install.';
  end if;
  select * into v_quote from ops.install_quotes where id = p_quote_id for update;
  if v_quote.id is null then
    raise exception 'app: Price the order before booking.';
  end if;
  if v_quote.install_id is not null then
    raise exception 'app: That order is already booked.';
  end if;
  if v_quote.created_by is distinct from auth.uid() and not public.workspace_is_admin() and not public.workspace_can('operations', 'edit') then
    raise exception 'app: You cannot book that quote.';
  end if;

  v_payload := v_quote.payload;
  v_total := greatest(coalesce((v_payload->>'totalDays')::integer, 1), 1);
  select coalesce(array_agg(day order by day), '{}')
  into v_days
  from ops.install_working_days(p_start, v_total, v_weekends) as day;
  if coalesce(array_length(v_days, 1), 0) < v_total or v_days[1] is distinct from p_start then
    raise exception 'app: Choose a weekday start date.';
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
  insert into ops.installs (
    quote_id, order_number, goods_net, install_price, warranty_option, warranty_price,
    start_on, end_on, customer_name, contact_name, contact_email, contact_phone, site_address,
    status, booking_rep_id, service_quote_id, proposal_path,
    flags, hq_build, site_install, crew, van_size, van_count, lines, cin7_sale_id, cin7_customer_id
  )
  values (
    v_quote.id,
    v_quote.order_number,
    (v_payload->>'goodsNet')::numeric,
    (v_payload->>'installPrice')::numeric,
    v_option,
    v_price,
    p_start,
    v_end,
    coalesce(v_payload->>'customerName', ''),
    v_payload->>'contactName',
    v_payload->>'contactEmail',
    v_payload->>'contactPhone',
    v_payload->>'siteAddress',
    'booked',
    auth.uid(),
    nullif(v_payload->>'serviceQuoteId', '')::uuid,
    v_payload->>'proposalPath',
    coalesce(v_payload->'flags', '[]'::jsonb),
    coalesce(v_payload->'hqBuild', '{}'::jsonb),
    coalesce(v_payload->'siteInstall', '{}'::jsonb),
    greatest(coalesce((v_requirements->>'installers')::integer, 1), 1),
    coalesce(v_requirements->>'vanSize', 'small'),
    greatest(coalesce((v_requirements->>'vanCount')::integer, 1), 1),
    coalesce(v_payload->'lines', '[]'::jsonb),
    v_payload->>'cin7SaleId',
    v_payload->>'cin7CustomerId'
  )
  returning id into v_install;

  v_resources := ops.hold_install_resources(v_install, v_ids, v_days);
  update ops.installs set resources = v_resources where id = v_install;
  update ops.install_quotes set install_id = v_install where id = v_quote.id;
  return public.install_read(v_install);
end;
$$;

create or replace function public.install_available_starts(p_quote_id uuid, p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ops, public
as $$
declare
  v_quote ops.install_quotes%rowtype;
  v_payload jsonb;
  v_total integer;
  v_weekends boolean := false;
  v_day date;
  v_days date[];
  v_found date[] := '{}';
  v_requirements jsonb;
begin
  if not (public.workspace_can('sales', 'view') or public.workspace_can('operations', 'view')) then
    raise exception 'app: You cannot see install dates.';
  end if;
  select * into v_quote from ops.install_quotes where id = p_quote_id;
  if v_quote.id is null then
    raise exception 'app: Price the order before booking.';
  end if;
  if v_quote.created_by is distinct from auth.uid() and not public.workspace_is_admin() and not public.workspace_can('operations', 'view') then
    raise exception 'app: You cannot see dates for that quote.';
  end if;
  if p_from is null or p_to is null or p_to < p_from or p_to > p_from + 120 then
    raise exception 'app: Choose a shorter date range.';
  end if;
  v_payload := v_quote.payload;
  v_total := greatest(coalesce((v_payload->>'totalDays')::integer, 1), 1);
  v_requirements := coalesce(v_payload->'requirements', '{}'::jsonb);
  v_day := p_from;
  while v_day <= p_to loop
    if v_weekends or extract(isodow from v_day) < 6 then
      select coalesce(array_agg(day order by day), '{}')
      into v_days
      from ops.install_working_days(v_day, v_total, v_weekends) as day;
      if v_days[1] is not distinct from v_day and ops.pick_install_resources(
        v_days,
        greatest(coalesce((v_requirements->>'installers')::integer, 1), 1),
        greatest(coalesce((v_requirements->>'licensedDrivers')::integer, 0), 0),
        coalesce(v_requirements->>'vanSize', 'small'),
        greatest(coalesce((v_requirements->>'vanCount')::integer, 1), 1),
        coalesce((v_requirements->>'stairClimber')::boolean, false)
      ) is not null then
        v_found := v_found || v_day;
      end if;
    end if;
    v_day := v_day + 1;
  end loop;
  return to_jsonb(v_found);
end;
$$;

create or replace function public.install_move(p_id uuid, p_start date)
returns jsonb
language plpgsql
security definer
set search_path = ops, public
as $$
declare
  v_row ops.installs%rowtype;
  v_quote ops.install_quotes%rowtype;
  v_total integer;
  v_days date[];
  v_ids uuid[];
  v_end date;
  v_weekends boolean := false;
  v_requirements jsonb;
  v_resources jsonb;
begin
  if not public.workspace_can('operations', 'edit') then
    raise exception 'app: You cannot move that install.';
  end if;
  select * into v_row from ops.installs where id = p_id for update;
  if v_row.id is null or v_row.status = 'cancelled' then
    raise exception 'app: That install was not found.';
  end if;
  select * into v_quote from ops.install_quotes where id = v_row.quote_id;
  v_total := greatest(coalesce((v_quote.payload->>'totalDays')::integer, 1), 1);
  select coalesce(array_agg(day order by day), '{}')
  into v_days
  from ops.install_working_days(p_start, v_total, v_weekends) as day;
  if coalesce(array_length(v_days, 1), 0) < v_total or v_days[1] is distinct from p_start then
    raise exception 'app: Choose a weekday start date.';
  end if;
  delete from ops.install_reservations where install_id = v_row.id;
  v_requirements := coalesce(v_quote.payload->'requirements', '{}'::jsonb);
  v_ids := ops.pick_install_resources(
    v_days,
    v_row.crew,
    greatest(coalesce((v_requirements->>'licensedDrivers')::integer, 0), 0),
    v_row.van_size,
    v_row.van_count,
    coalesce((v_requirements->>'stairClimber')::boolean, false)
  );
  if v_ids is null then
    raise exception 'app: Those engineers or vans are no longer free. Choose another start date.';
  end if;
  v_end := v_days[array_length(v_days, 1)];
  v_resources := ops.hold_install_resources(v_row.id, v_ids, v_days);
  update ops.installs
  set start_on = p_start, end_on = v_end, resources = v_resources, updated_at = now()
  where id = v_row.id;
  return public.install_read(v_row.id);
end;
$$;

