-- A second quote row for the same order must not book over an open subcontractor quote,
-- and must not open another one while that order is quoting or booked.
-- Order numbers match with case and whitespace ignored. Blank numbers do not match.

create or replace function ops.install_order_key(p_order text)
returns text
language sql
immutable
as $$
  select nullif(lower(regexp_replace(coalesce(p_order, ''), '\s', '', 'g')), '');
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
  if exists (
    select 1 from ops.installs other
    where other.status = 'quoting'
      and ops.install_order_key(other.order_number) is not null
      and ops.install_order_key(other.order_number) = ops.install_order_key(v_quote.order_number)
  ) then
    raise exception 'app: That order is out for a subcontractor quote.';
  end if;
  if v_quote.install_id is not null then
    select * into v_existing from ops.installs where id = v_quote.install_id;
    if v_existing.status = 'quoting' then
      raise exception 'app: That order is out for a subcontractor quote.';
    end if;
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

create or replace function public.subcontractor_open(p_quote_id uuid, p_dates date[], p_sends jsonb)
returns jsonb language plpgsql security definer set search_path = ops, public as $$
declare
  v_quote ops.install_quotes%rowtype;
  v_install ops.installs%rowtype;
  v_payload jsonb;
  v_requirements jsonb;
  v_id uuid;
  v_existing ops.subcontractor_threads%rowtype;
  v_send jsonb;
  v_sub uuid;
  v_token text;
  v_emails text[] := '{}';
  v_pending jsonb;
  v_threads jsonb := '[]'::jsonb;
  v_block text;
begin
  if ops.is_field_engineer() then
    raise exception 'app: Field engineers cannot do that.';
  end if;
  if not (public.workspace_can('sales', 'edit') or public.workspace_can('operations', 'edit')) then
    raise exception 'app: You cannot send a subcontractor quote.';
  end if;
  if coalesce(array_length(p_dates, 1), 0) < 1 then
    raise exception 'app: Add at least one suggested date.';
  end if;
  if exists (select 1 from unnest(p_dates) as day where extract(isodow from day) >= 6) then
    raise exception 'app: Suggested dates have to be weekdays.';
  end if;
  select * into v_quote from ops.install_quotes where id = p_quote_id for update;
  if v_quote.id is null then raise exception 'app: Price the order before asking subcontractors.'; end if;
  if v_quote.created_by is distinct from auth.uid() and not public.workspace_is_admin() and not public.workspace_can('operations', 'edit') then
    raise exception 'app: You cannot send that quote.';
  end if;
  select other.status into v_block
  from ops.installs other
  where other.id is distinct from v_quote.install_id
    and other.status in ('quoting', 'booked')
    and ops.install_order_key(other.order_number) is not null
    and ops.install_order_key(other.order_number) = ops.install_order_key(v_quote.order_number)
  order by case when other.status = 'quoting' then 0 else 1 end
  limit 1;
  if v_block = 'quoting' then
    raise exception 'app: That order is out for a subcontractor quote.';
  end if;
  if v_block = 'booked' then
    raise exception 'app: That order is already booked.';
  end if;
  v_payload := v_quote.payload;
  v_requirements := coalesce(v_payload->'requirements', '{}'::jsonb);
  if v_quote.install_id is not null then
    select * into v_install from ops.installs where id = v_quote.install_id for update;
    if v_install.status is distinct from 'quoting' then raise exception 'app: That order is already booked.'; end if;
    update ops.installs set suggested_dates = p_dates, updated_at = now() where id = v_install.id;
  else
    insert into ops.installs (
      quote_id, order_number, goods_net, install_price, start_on, end_on,
      customer_name, contact_name, contact_email, contact_phone, site_address,
      status, booking_rep_id, service_quote_id, proposal_path,
      flags, hq_build, site_install, crew, van_size, van_count, lines,
      cin7_sale_id, cin7_customer_id, delivered_by, suggested_dates
    ) values (
      v_quote.id, v_quote.order_number, (v_payload->>'goodsNet')::numeric, null, null, null,
      coalesce(v_payload->>'customerName', ''), v_payload->>'contactName', v_payload->>'contactEmail',
      v_payload->>'contactPhone', v_payload->>'siteAddress', 'quoting', auth.uid(),
      nullif(v_payload->>'serviceQuoteId', '')::uuid, v_payload->>'proposalPath',
      coalesce(v_payload->'flags', '[]'::jsonb), coalesce(v_payload->'hqBuild', '{}'::jsonb),
      coalesce(v_payload->'siteInstall', '{}'::jsonb),
      greatest(coalesce((v_requirements->>'installers')::integer, 1), 1),
      case when coalesce(v_requirements->>'vanSize', 'small') = 'crafter' then 'crafter' else 'small' end,
      greatest(coalesce((v_requirements->>'vanCount')::integer, 1), 1),
      coalesce(v_payload->'lines', '[]'::jsonb), v_payload->>'cin7SaleId', v_payload->>'cin7CustomerId',
      'subcontractor', p_dates
    ) returning * into v_install;
    update ops.install_quotes set install_id = v_install.id where id = v_quote.id;
  end if;

  for v_send in select value from jsonb_array_elements(coalesce(p_sends, '[]'::jsonb))
  loop
    v_sub := (v_send->>'subcontractorId')::uuid;
    v_token := v_send->>'replyToken';
    if v_token is null or v_token !~ '^[a-z0-9]{16,64}$' then
      raise exception 'app: The reply address could not be made.';
    end if;
    if not exists (select 1 from ops.subcontractors where id = v_sub and status <> 'inactive') then
      raise exception 'app: That subcontractor cannot be emailed.';
    end if;
    if not ops.subcontractor_insured(v_sub, current_date) then
      raise exception 'app: That subcontractor has no in-date insurance.';
    end if;
    select coalesce(array_agg(distinct lower(btrim(item))), '{}') into v_emails
    from jsonb_array_elements_text(case when jsonb_typeof(v_send->'to') = 'array' then v_send->'to' else jsonb_build_array(v_send->>'to') end) as listed(item)
    where btrim(item) <> '';
    if coalesce(array_length(v_emails, 1), 0) = 0 or exists (select 1 from unnest(v_emails) as addr where ops.subcontractor_email_blocked(addr)) then
      raise exception 'app: Check email before sending.';
    end if;
    select * into v_existing from ops.subcontractor_threads where install_id = v_install.id and subcontractor_id = v_sub;
    if v_existing.id is not null and v_existing.status is distinct from 'failed' then
      raise exception 'app: That subcontractor was already emailed for this order.';
    end if;
    if v_existing.id is null then
      insert into ops.subcontractor_threads (install_id, subcontractor_id, reply_token, subject, status)
      values (v_install.id, v_sub, v_token, coalesce(v_send->>'subject', 'Install quote'), 'queued')
      returning id into v_id;
    else
      update ops.subcontractor_threads
      set status = 'queued', subject = coalesce(v_send->>'subject', subject)
      where id = v_existing.id
      returning id, reply_token into v_id, v_token;
    end if;
    select coalesce(jsonb_agg(addr), '[]'::jsonb) into v_pending
    from unnest(v_emails) as addr
    where not exists (
      select 1 from ops.subcontractor_messages message
      where message.thread_id = v_id and message.direction = 'out' and lower(message.to_address) = addr
        and message.delivery in ('logged', 'sent', 'redirected')
    );
    v_threads := v_threads || jsonb_build_array(jsonb_build_object(
      'id', v_id, 'subcontractorId', v_sub, 'replyToken', v_token, 'emails', v_pending
    ));
  end loop;
  if jsonb_array_length(v_threads) = 0 then raise exception 'app: Choose a subcontractor.'; end if;
  return jsonb_build_object('installId', v_install.id, 'threads', v_threads);
end;
$$;
