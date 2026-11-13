-- A subcontractor email can go out with a written timeframe and no date list.

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
  -- The timeframe is written in the email. A date list is optional.
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
    'postcode', coalesce(nullif(v_quote.payload->>'postcode', ''), nullif(v_row.site_address, ''), ''),
    'crew', v_row.crew,
    'suggestedDates', to_jsonb(v_row.suggested_dates),
    'lines', coalesce((
      select jsonb_agg(jsonb_build_object(
        'sku', coalesce(item->>'sku', ''),
        'qty', coalesce(item->>'qty', '0'),
        'description', coalesce(item->>'description', ''),
        'category', item->>'category',
        'unitWeightKg', item->'unitWeightKg'
      ))
      from jsonb_array_elements(coalesce(v_row.lines, '[]'::jsonb)) as listed(item)
    ), '[]'::jsonb)
  );
end;
$$;
