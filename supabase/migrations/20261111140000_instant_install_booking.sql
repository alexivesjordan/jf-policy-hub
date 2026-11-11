-- Instant install booking. One install row is read by Sales and by Operations.
-- New file only. Do not edit earlier migrations. Do not apply this to production.

create table ops.install_quotes (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references public.profiles (id) on delete restrict,
  order_number text not null,
  payload jsonb not null,
  install_id uuid,
  created_at timestamptz not null default now()
);

create table ops.installs (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null unique references ops.install_quotes (id) on delete restrict,
  order_number text not null,
  goods_net numeric(14,2),
  install_price numeric(14,2) not null,
  warranty_option text,
  warranty_price numeric(14,2),
  start_on date not null,
  end_on date not null,
  customer_name text not null,
  contact_name text,
  contact_email text,
  contact_phone text,
  site_address text,
  status text not null default 'booked'
    check (status in ('booked', 'scheduled', 'in_progress', 'completed', 'cancelled')),
  booking_rep_id uuid not null references public.profiles (id) on delete restrict,
  service_quote_id uuid references ops.service_quotes (id) on delete set null,
  proposal_path text,
  flags jsonb not null default '[]'::jsonb,
  hq_build jsonb not null default '{}'::jsonb,
  site_install jsonb not null default '{}'::jsonb,
  crew integer not null check (crew > 0),
  van_size text not null check (van_size in ('small', 'crafter')),
  van_count integer not null check (van_count > 0),
  resources jsonb not null default '[]'::jsonb,
  lines jsonb not null default '[]'::jsonb,
  cin7_sale_id text,
  cin7_customer_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_on >= start_on),
  check (
    warranty_option is null
    or warranty_option in ('annual', 'twice_yearly', 'extension', 'annual_bundle', 'twice_yearly_bundle')
  )
);

alter table ops.install_quotes
  add constraint install_quotes_install_fk
  foreign key (install_id) references ops.installs (id) on delete set null;

create table ops.install_reservations (
  install_id uuid not null references ops.installs (id) on delete cascade,
  resource_id uuid not null references ops.resources (id) on delete restrict,
  day date not null,
  primary key (resource_id, day)
);

create index installs_dates_idx on ops.installs (start_on, end_on);
create index installs_booking_rep_idx on ops.installs (booking_rep_id);
create index install_reservations_install_idx on ops.install_reservations (install_id);

alter table ops.install_quotes enable row level security;
alter table ops.installs enable row level security;
alter table ops.install_reservations enable row level security;

revoke all on ops.install_quotes, ops.installs, ops.install_reservations from public, anon, authenticated;
grant all on ops.install_quotes, ops.installs, ops.install_reservations to service_role;

comment on table ops.installs is
  'One install. Sales and Operations read it through different functions. There is no second copy.';

comment on table ops.install_reservations is
  'One resource can be on one install per day. The primary key is the double-book lock.';

-- ---------------------------------------------------------------------------
-- Duration and resource picking. Flags are never consulted.
-- ---------------------------------------------------------------------------

create or replace function ops.install_working_days(p_start date, p_count integer, p_weekends boolean)
returns setof date
language plpgsql
immutable
as $$
declare
  v_day date := p_start;
  v_left integer := greatest(coalesce(p_count, 1), 1);
  v_guard integer := 0;
begin
  while v_left > 0 and v_guard < 400 loop
    if p_weekends or extract(isodow from v_day) < 6 then
      return next v_day;
      v_left := v_left - 1;
    end if;
    v_day := v_day + 1;
    v_guard := v_guard + 1;
  end loop;
end;
$$;

create or replace function ops.resource_free_for_days(p_resource uuid, p_days date[])
returns boolean
language sql
stable
as $$
  select not exists (
    select 1
    from unnest(p_days) as needed(day)
    where exists (
      select 1 from ops.install_reservations held
      where held.resource_id = p_resource and held.day = needed.day
    )
    or exists (
      select 1 from ops.reservations older
      where older.resource_id = p_resource and older.day = needed.day
    )
    or exists (
      select 1 from ops.unavailability away
      where away.resource_id = p_resource and needed.day between away.starts_on and away.ends_on
    )
  );
$$;

create or replace function ops.pick_install_resources(
  p_days date[],
  p_installers integer,
  p_drivers integer,
  p_van_size text,
  p_van_count integer,
  p_climber boolean
)
returns uuid[]
language plpgsql
stable
set search_path = ops, public
as $$
declare
  v_chosen uuid[] := '{}';
  v_id uuid;
  v_need_installers integer := p_installers;
  v_need_drivers integer := p_drivers;
  v_van_count integer := 0;
begin
  if p_climber then
    select id into v_id
    from ops.resources
    where resource_type = 'climber'
      and status = 'active'
      and ops.resource_free_for_days(id, p_days)
    order by name
    limit 1;
    if v_id is null then
      return null;
    end if;
    v_chosen := v_chosen || v_id;
  end if;

  for v_id in
    select id
    from ops.resources
    where resource_type = 'van'
      and status = 'active'
      and (
        (p_van_size = 'crafter' and name ilike '%crafter%')
        or (p_van_size = 'small' and name not ilike '%crafter%')
      )
      and ops.resource_free_for_days(id, p_days)
    order by name
    limit p_van_count
  loop
    v_chosen := v_chosen || v_id;
    v_van_count := v_van_count + 1;
  end loop;
  if v_van_count < p_van_count then
    return null;
  end if;

  for v_id in
    select id
    from ops.resources
    where resource_type = 'installer'
      and status = 'active'
      and has_licence = false
      and ops.resource_free_for_days(id, p_days)
    order by name
  loop
    exit when v_need_installers <= 0;
    v_chosen := v_chosen || v_id;
    v_need_installers := v_need_installers - 1;
  end loop;

  for v_id in
    select id
    from ops.resources
    where status = 'active'
      and not (id = any(v_chosen))
      and ops.resource_free_for_days(id, p_days)
      and (
        (resource_type = 'installer' and has_licence)
        or (resource_type <> 'installer' and resource_type <> 'van' and has_licence and insured)
      )
    order by case when resource_type = 'installer' then 0 else 1 end, name
  loop
    exit when v_need_installers <= 0 and v_need_drivers <= 0;
    if v_need_installers > 0 then
      v_chosen := v_chosen || v_id;
      v_need_installers := v_need_installers - 1;
      v_need_drivers := greatest(0, v_need_drivers - 1);
    elsif v_need_drivers > 0 then
      v_chosen := v_chosen || v_id;
      v_need_drivers := v_need_drivers - 1;
    end if;
  end loop;

  if v_need_installers > 0 or v_need_drivers > 0 then
    return null;
  end if;
  return v_chosen;
end;
$$;

-- ---------------------------------------------------------------------------
-- Reads. The shape depends on the caller, not on a column the client selects.
-- ---------------------------------------------------------------------------

create or replace function ops.install_span(p_row ops.installs)
returns jsonb
language sql
stable
as $$
  select jsonb_build_object(
    'id', p_row.id,
    'orderNumber', p_row.order_number,
    'goodsNet', p_row.goods_net,
    'installPrice', p_row.install_price,
    'warrantyOption', p_row.warranty_option,
    'warrantyPrice', p_row.warranty_price,
    'startOn', p_row.start_on,
    'endOn', p_row.end_on,
    'customerName', p_row.customer_name,
    'contactName', p_row.contact_name,
    'contactEmail', p_row.contact_email,
    'contactPhone', p_row.contact_phone,
    'siteAddress', p_row.site_address,
    'status', p_row.status,
    'bookingRepId', p_row.booking_rep_id,
    'bookingRepName', (select full_name from public.profiles where id = p_row.booking_rep_id),
    'proposalPath', coalesce(p_row.proposal_path, (select proposal_path from ops.service_quotes where id = p_row.service_quote_id)),
    'serviceQuoteId', p_row.service_quote_id
  );
$$;

create or replace function public.install_calendar(p_from date, p_to date, p_mine boolean)
returns jsonb
language plpgsql
stable
security definer
set search_path = ops, public
as $$
declare
  v_ops boolean := public.workspace_can('operations', 'view') or public.workspace_is_admin();
  v_sales boolean := v_ops or public.workspace_can('sales', 'view');
begin
  if not v_sales then
    raise exception 'app: You cannot see installs.';
  end if;
  if p_from is null or p_to is null or p_to < p_from then
    raise exception 'app: Choose a date range.';
  end if;
  return coalesce((
    select jsonb_agg(ops.install_span(i) || case when v_ops then jsonb_build_object(
      'flags', i.flags,
      'hqBuild', i.hq_build,
      'siteInstall', i.site_install,
      'crew', i.crew,
      'vans', jsonb_build_object('size', i.van_size, 'count', i.van_count),
      'resources', i.resources,
      'lines', i.lines,
      'cin7SaleId', i.cin7_sale_id,
      'cin7CustomerId', i.cin7_customer_id
    ) else '{}'::jsonb end order by i.start_on, i.order_number)
    from ops.installs i
    where i.status <> 'cancelled'
      and i.start_on <= p_to
      and i.end_on >= p_from
      and (not coalesce(p_mine, false) or i.booking_rep_id = auth.uid())
  ), '[]'::jsonb);
end;
$$;

create or replace function public.install_read(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ops, public
as $$
declare
  v_row ops.installs%rowtype;
  v_ops boolean := public.workspace_can('operations', 'view') or public.workspace_is_admin();
begin
  if not (v_ops or public.workspace_can('sales', 'view')) then
    raise exception 'app: You cannot see that install.';
  end if;
  select * into v_row from ops.installs where id = p_id;
  if v_row.id is null then
    raise exception 'app: That install was not found.';
  end if;
  return ops.install_span(v_row) || case when v_ops then jsonb_build_object(
    'flags', v_row.flags,
    'hqBuild', v_row.hq_build,
    'siteInstall', v_row.site_install,
    'crew', v_row.crew,
    'vans', jsonb_build_object('size', v_row.van_size, 'count', v_row.van_count),
    'resources', v_row.resources,
    'lines', v_row.lines,
    'cin7SaleId', v_row.cin7_sale_id,
    'cin7CustomerId', v_row.cin7_customer_id
  ) else '{}'::jsonb end;
end;
$$;

-- ---------------------------------------------------------------------------
-- Save the priced quote. The payload is not returned to the browser.
-- ---------------------------------------------------------------------------

create or replace function public.install_save_quote(p_order_number text, p_payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = ops, public
as $$
declare
  v_id uuid;
begin
  if not (public.workspace_can('sales', 'edit') or public.workspace_can('operations', 'edit')) then
    raise exception 'app: You cannot save an install quote.';
  end if;
  if nullif(btrim(coalesce(p_order_number, '')), '') is null then
    raise exception 'app: Enter an order number.';
  end if;
  insert into ops.install_quotes (created_by, order_number, payload)
  values (auth.uid(), btrim(p_order_number), coalesce(p_payload, '{}'::jsonb))
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function ops.hold_install_resources(p_install uuid, p_ids uuid[], p_days date[])
returns jsonb
language plpgsql
as $$
declare
  v_id uuid;
  v_day date;
  v_resources jsonb := '[]'::jsonb;
begin
  perform 1
  from ops.resources
  where id = any(p_ids)
  order by id
  for update;

  foreach v_id in array p_ids loop
    foreach v_day in array p_days loop
      insert into ops.install_reservations (install_id, resource_id, day)
      values (p_install, v_id, v_day);
    end loop;
  end loop;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', r.id,
    'name', r.name,
    'resourceType', r.resource_type
  ) order by r.resource_type, r.name), '[]'::jsonb)
  into v_resources
  from ops.resources r
  where r.id = any(p_ids);
  return v_resources;
exception
  when unique_violation then
    raise exception 'app: Those engineers or vans are no longer free. Choose another start date.';
end;
$$;

create or replace function public.install_book(p_quote_id uuid, p_start date, p_warranty text)
returns jsonb
language plpgsql
security definer
set search_path = ops, public
as $$
declare
  v_quote ops.install_quotes%rowtype;
  v_payload jsonb;
  v_weekends boolean := public.workspace_is_admin();
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
  v_weekends boolean := public.workspace_is_admin();
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
  v_weekends boolean := public.workspace_is_admin();
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

create or replace function public.install_set_status(p_id uuid, p_status text)
returns jsonb
language plpgsql
security definer
set search_path = ops, public
as $$
begin
  if not public.workspace_can('operations', 'edit') then
    raise exception 'app: You cannot change that install.';
  end if;
  if p_status not in ('booked', 'scheduled', 'in_progress', 'completed', 'cancelled') then
    raise exception 'app: Choose a status.';
  end if;
  update ops.installs
  set status = p_status, updated_at = now()
  where id = p_id;
  if not found then
    raise exception 'app: That install was not found.';
  end if;
  if p_status = 'cancelled' then
    delete from ops.install_reservations where install_id = p_id;
  end if;
  return public.install_read(p_id);
end;
$$;

revoke all on function ops.install_working_days(date, integer, boolean) from public, anon, authenticated;
revoke all on function ops.resource_free_for_days(uuid, date[]) from public, anon, authenticated;
revoke all on function ops.pick_install_resources(date[], integer, integer, text, integer, boolean) from public, anon, authenticated;
revoke all on function ops.hold_install_resources(uuid, uuid[], date[]) from public, anon, authenticated;
revoke all on function ops.install_span(ops.installs) from public, anon, authenticated;

revoke all on function public.install_calendar(date, date, boolean) from public, anon;
revoke all on function public.install_read(uuid) from public, anon;
revoke all on function public.install_save_quote(text, jsonb) from public, anon;
revoke all on function public.install_book(uuid, date, text) from public, anon;
revoke all on function public.install_available_starts(uuid, date, date) from public, anon;
revoke all on function public.install_move(uuid, date) from public, anon;
revoke all on function public.install_set_status(uuid, text) from public, anon;

grant execute on function public.install_calendar(date, date, boolean) to authenticated, service_role;
grant execute on function public.install_read(uuid) to authenticated, service_role;
grant execute on function public.install_save_quote(text, jsonb) to authenticated, service_role;
grant execute on function public.install_book(uuid, date, text) to authenticated, service_role;
grant execute on function public.install_available_starts(uuid, date, date) to authenticated, service_role;
grant execute on function public.install_move(uuid, date) to authenticated, service_role;
grant execute on function public.install_set_status(uuid, text) to authenticated, service_role;
