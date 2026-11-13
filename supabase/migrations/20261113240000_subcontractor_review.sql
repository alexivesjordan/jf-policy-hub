-- Review fixes for subcontractor quoting. Does not replace install_calendar,
-- install_move, or install_set_status.

alter table ops.subcontractor_messages
  add column if not exists body_unavailable boolean not null default false;

do $$
declare
  v_name text;
begin
  select con.conname into v_name
  from pg_constraint con
  join pg_class rel on rel.oid = con.conrelid
  join pg_namespace nsp on nsp.oid = rel.relnamespace
  where nsp.nspname = 'ops'
    and rel.relname = 'subcontractor_threads'
    and con.contype = 'c'
    and pg_get_constraintdef(con.oid) ilike '%queued%';
  if v_name is not null then
    execute format('alter table ops.subcontractor_threads drop constraint %I', v_name);
  end if;
end $$;

alter table ops.subcontractor_threads
  add constraint subcontractor_threads_status_check
  check (status in ('queued', 'sent', 'replied', 'chosen', 'declined', 'failed'));

update storage.buckets
set allowed_mime_types = array['application/pdf', 'image/jpeg', 'image/png']
where id = 'insurance';

create or replace function ops.reject_field_engineer()
returns void
language plpgsql
stable
as $$
declare
  v_engineer boolean := false;
begin
  if to_regprocedure('ops.is_field_engineer()') is null then
    return;
  end if;
  execute 'select ops.is_field_engineer()' into v_engineer;
  if v_engineer then
    raise exception 'app: Field engineers cannot do that.';
  end if;
end;
$$;

create or replace function ops.subcontractor_email_blocked(p_email text)
returns boolean
language sql
immutable
as $$
  select lower(btrim(coalesce(p_email, ''))) in ('sarah@amazon-leisure', 'service@poerleisure.info')
      or btrim(coalesce(p_email, '')) !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$';
$$;

revoke all on function ops.reject_field_engineer() from public, anon, authenticated;
revoke all on function ops.subcontractor_email_blocked(text) from public, anon, authenticated;

create or replace function public.subcontractor_save(p_id uuid, p_row jsonb)
returns uuid
language plpgsql
security definer
set search_path = ops, public
as $$
declare
  v_id uuid := p_id;
  v_name text := nullif(btrim(coalesce(p_row->>'name', '')), '');
  v_status text := coalesce(nullif(p_row->>'status', ''), 'active');
  v_emails text[] := '{}';
  v_regions text[] := '{}';
  v_types text[] := '{}';
  v_email text;
  v_max integer := nullif(p_row->>'maxCrew', '')::integer;
begin
  if ops.is_field_engineer() then
    raise exception 'app: Field engineers cannot do that.';
  end if;
  if not public.workspace_can('operations', 'edit') then
    raise exception 'app: You cannot change subcontractors.';
  end if;
  if v_name is null then
    raise exception 'app: Enter a name.';
  end if;
  if v_status not in ('active', 'preferred', 'on_hold', 'inactive') then
    raise exception 'app: Choose a status.';
  end if;
  if v_max is not null and v_max < 1 then
    raise exception 'app: Crew size has to be at least 1.';
  end if;
  select coalesce(array_agg(distinct lower(btrim(item))), '{}') into v_emails
  from jsonb_array_elements_text(coalesce(p_row->'emails', '[]'::jsonb)) as listed(item)
  where btrim(item) <> '';
  select coalesce(array_agg(distinct btrim(item)), '{}') into v_regions
  from jsonb_array_elements_text(coalesce(p_row->'regions', '[]'::jsonb)) as listed(item)
  where btrim(item) <> '';
  select coalesce(array_agg(distinct lower(btrim(item))), '{}') into v_types
  from jsonb_array_elements_text(coalesce(p_row->'jobTypes', '[]'::jsonb)) as listed(item)
  where btrim(item) <> '';
  v_email := v_emails[1];
  if p_id is null then
    insert into ops.subcontractors (
      name, contact_name, phone, email, emails, regions, capabilities, max_crew, status, notes
    ) values (
      v_name, nullif(btrim(coalesce(p_row->>'contactName', '')), ''),
      nullif(btrim(coalesce(p_row->>'phone', '')), ''),
      v_email, v_emails, v_regions, v_types, v_max, v_status,
      nullif(btrim(coalesce(p_row->>'notes', '')), '')
    ) returning id into v_id;
  else
    update ops.subcontractors set
      name = v_name,
      contact_name = nullif(btrim(coalesce(p_row->>'contactName', '')), ''),
      phone = nullif(btrim(coalesce(p_row->>'phone', '')), ''),
      email = v_email, emails = v_emails, regions = v_regions, capabilities = v_types,
      max_crew = v_max, status = v_status, notes = nullif(btrim(coalesce(p_row->>'notes', '')), '')
    where id = p_id returning id into v_id;
    if v_id is null then
      raise exception 'app: That subcontractor was not found.';
    end if;
  end if;
  return v_id;
end;
$$;

create or replace function public.subcontractor_remove(p_id uuid)
returns void language plpgsql security definer set search_path = ops, public as $$
begin
  if ops.is_field_engineer() then
    raise exception 'app: Field engineers cannot do that.';
  end if;
  if not public.workspace_can('operations', 'edit') then
    raise exception 'app: You cannot remove subcontractors.';
  end if;
  if exists (select 1 from ops.subcontractor_threads where subcontractor_id = p_id) then
    raise exception 'app: This subcontractor has quote threads.';
  end if;
  delete from ops.subcontractors where id = p_id;
  if not found then raise exception 'app: That subcontractor was not found.'; end if;
end;
$$;

create or replace function public.subcontractor_attach_insurance(p_subcontractor uuid, p_file uuid, p_expires date, p_label text)
returns uuid language plpgsql security definer set search_path = ops, public as $$
declare v_id uuid;
begin
  if ops.is_field_engineer() then
    raise exception 'app: Field engineers cannot do that.';
  end if;
  if coalesce(auth.role(), '') is distinct from 'service_role' and not public.workspace_can('operations', 'edit') then
    raise exception 'app: You cannot add insurance.';
  end if;
  if p_expires is null then raise exception 'app: Enter an expiry date.'; end if;
  if not exists (
    select 1 from core.files
    where id = p_file and bucket = 'insurance' and entity_schema = 'ops'
      and entity_table = 'subcontractors' and entity_id = p_subcontractor and kind = 'insurance'
  ) then
    raise exception 'app: That file is not an insurance document.';
  end if;
  insert into ops.subcontractor_insurance (subcontractor_id, file_id, expires_on, label)
  values (p_subcontractor, p_file, p_expires, nullif(btrim(coalesce(p_label, '')), ''))
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.subcontractor_drop_insurance(p_id uuid)
returns void language plpgsql security definer set search_path = ops, public as $$
begin
  if ops.is_field_engineer() then
    raise exception 'app: Field engineers cannot do that.';
  end if;
  if not public.workspace_can('operations', 'edit') then
    raise exception 'app: You cannot remove insurance.';
  end if;
  delete from ops.subcontractor_insurance where id = p_id;
  if not found then raise exception 'app: That document was not found.'; end if;
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

create or replace function public.subcontractor_resend(p_thread uuid)
returns jsonb language plpgsql security definer set search_path = ops, public as $$
declare
  v_thread ops.subcontractor_threads%rowtype;
  v_body text;
  v_emails text[];
  v_pending jsonb;
begin
  if ops.is_field_engineer() then
    raise exception 'app: Field engineers cannot do that.';
  end if;
  if not (public.workspace_can('sales', 'edit') or public.workspace_can('operations', 'edit')) then
    raise exception 'app: You cannot send a subcontractor quote.';
  end if;
  select * into v_thread from ops.subcontractor_threads where id = p_thread for update;
  if v_thread.id is null or v_thread.status is distinct from 'failed' then
    raise exception 'app: That quote cannot be resent.';
  end if;
  select coalesce(array_agg(lower(btrim(addr))), '{}') into v_emails
  from ops.subcontractors sub
  cross join lateral unnest(sub.emails) as addr
  where sub.id = v_thread.subcontractor_id and not ops.subcontractor_email_blocked(addr);
  if coalesce(array_length(v_emails, 1), 0) = 0 then
    raise exception 'app: Check email before sending.';
  end if;
  select message.body_text into v_body
  from ops.subcontractor_messages message
  where message.thread_id = v_thread.id and message.direction = 'out'
  order by message.created_at desc limit 1;
  update ops.subcontractor_threads set status = 'queued' where id = v_thread.id;
  select coalesce(jsonb_agg(addr), '[]'::jsonb) into v_pending
  from unnest(v_emails) as addr
  where not exists (
    select 1 from ops.subcontractor_messages message
    where message.thread_id = v_thread.id and message.direction = 'out'
      and lower(message.to_address) = addr and message.delivery in ('logged', 'sent', 'redirected')
  );
  return jsonb_build_object('installId', v_thread.install_id, 'replyToken', v_thread.reply_token, 'subject', v_thread.subject, 'body', coalesce(v_body, ''), 'emails', v_pending);
end;
$$;

create or replace function public.subcontractor_log_message(
  p_thread uuid, p_direction text, p_from text, p_to text, p_subject text, p_body text, p_provider text, p_delivery text, p_suggested numeric
) returns uuid language plpgsql security definer set search_path = ops, public as $$
declare v_id uuid;
begin
  if ops.is_field_engineer() then
    raise exception 'app: Field engineers cannot do that.';
  end if;
  if coalesce(auth.role(), '') is distinct from 'service_role'
     and not (public.workspace_can('sales', 'edit') or public.workspace_can('operations', 'edit')) then
    raise exception 'app: You cannot write that thread.';
  end if;
  if p_direction is distinct from 'out' then
    raise exception 'app: Inbound mail is recorded by the webhook.';
  end if;
  insert into ops.subcontractor_messages (
    thread_id, direction, from_address, to_address, subject, body_text, provider_id, delivery, suggested_price
  ) values (
    p_thread, 'out', p_from, p_to, p_subject, p_body, nullif(p_provider, ''), p_delivery, p_suggested
  ) returning id into v_id;
  if p_delivery = 'failed' then
    update ops.subcontractor_threads set status = 'failed'
    where id = p_thread and not exists (
      select 1 from ops.subcontractor_messages message
      where message.thread_id = p_thread and message.direction = 'out' and message.delivery in ('logged', 'sent', 'redirected')
    );
  elsif p_delivery in ('logged', 'sent', 'redirected') then
    update ops.subcontractor_threads set status = 'sent' where id = p_thread and status in ('queued', 'failed');
  end if;
  return v_id;
end;
$$;

drop function if exists public.subcontractor_record_reply(text, text, text, text, text, text, numeric);

create function public.subcontractor_record_reply(
  p_token text, p_from text, p_to text, p_subject text, p_body text, p_provider text, p_suggested numeric, p_body_unavailable boolean default false
) returns jsonb language plpgsql security definer set search_path = ops, public as $$
declare v_thread ops.subcontractor_threads%rowtype;
begin
  if coalesce(auth.role(), '') is distinct from 'service_role' then
    raise exception 'app: You cannot write that reply.';
  end if;
  if p_provider is not null and exists (select 1 from ops.subcontractor_messages where provider_id = p_provider) then
    return jsonb_build_object('matched', true, 'duplicate', true);
  end if;
  select * into v_thread from ops.subcontractor_threads where reply_token = p_token;
  if v_thread.id is null then return jsonb_build_object('matched', false); end if;
  insert into ops.subcontractor_messages (
    thread_id, direction, from_address, to_address, subject, body_text, provider_id, suggested_price, body_unavailable
  ) values (
    v_thread.id, 'in', p_from, p_to, p_subject, nullif(p_body, ''), nullif(p_provider, ''), p_suggested, coalesce(p_body_unavailable, false)
  );
  update ops.subcontractor_threads
  set status = case when status = 'chosen' then status else 'replied' end,
      suggested_price = coalesce(p_suggested, suggested_price)
  where id = v_thread.id;
  if coalesce(p_body_unavailable, false) then
    perform ops.notify_install(v_thread.install_id, 'Subcontractor reply', 'A reply arrived, but the message body could not be read.');
  end if;
  return jsonb_build_object('matched', true, 'threadId', v_thread.id, 'installId', v_thread.install_id);
end;
$$;

create or replace function public.subcontractor_confirm_price(p_thread uuid, p_price numeric)
returns void language plpgsql security definer set search_path = ops, public as $$
declare v_install uuid; v_rep uuid;
begin
  if ops.is_field_engineer() then
    raise exception 'app: Field engineers cannot do that.';
  end if;
  if p_price is null or p_price <= 0 then raise exception 'app: Enter the subcontractor price.'; end if;
  select thread.install_id, install.booking_rep_id into v_install, v_rep
  from ops.subcontractor_threads thread
  join ops.installs install on install.id = thread.install_id
  where thread.id = p_thread;
  if v_install is null then raise exception 'app: That reply was not found.'; end if;
  if v_rep is distinct from auth.uid() and not public.workspace_is_admin() and not public.workspace_can('operations', 'edit') then
    raise exception 'app: You cannot confirm that price.';
  end if;
  update ops.subcontractor_threads set confirmed_price = p_price where id = p_thread;
end;
$$;

create or replace function public.subcontractor_award(p_install uuid, p_subcontractor uuid, p_customer_price numeric, p_start date)
returns jsonb language plpgsql security definer set search_path = ops, public as $$
declare
  v_row ops.installs%rowtype;
  v_quote ops.install_quotes%rowtype;
  v_thread ops.subcontractor_threads%rowtype;
  v_hours numeric;
  v_count integer;
  v_days date[];
  v_ids uuid[];
  v_resources jsonb := '[]'::jsonb;
  v_end date;
begin
  if ops.is_field_engineer() then
    raise exception 'app: Field engineers cannot do that.';
  end if;
  if p_customer_price is null or p_customer_price <= 0 then raise exception 'app: Enter the customer price.'; end if;
  select * into v_row from ops.installs where id = p_install for update;
  if v_row.id is null or v_row.status is distinct from 'quoting' then raise exception 'app: That quote is not open.'; end if;
  if v_row.booking_rep_id is distinct from auth.uid() and not public.workspace_is_admin() and not public.workspace_can('operations', 'edit') then
    raise exception 'app: You cannot award that quote.';
  end if;
  if not ops.subcontractor_insured(p_subcontractor, current_date) then
    raise exception 'app: That subcontractor has no in-date insurance.';
  end if;
  select * into v_thread from ops.subcontractor_threads where install_id = p_install and subcontractor_id = p_subcontractor;
  if v_thread.id is null then raise exception 'app: Email that subcontractor before awarding the job.'; end if;
  if v_thread.confirmed_price is null then raise exception 'app: Confirm the subcontractor price first.'; end if;
  select coalesce(array_agg(day order by day), '{}') into v_days from ops.install_working_days(p_start, 1, false) as day;
  if v_days[1] is distinct from p_start then raise exception 'app: Choose a weekday start date.'; end if;
  select * into v_quote from ops.install_quotes where id = v_row.quote_id;
  v_hours := coalesce((v_quote.payload #>> '{hqBuild,personHours}')::numeric, 0);
  v_end := p_start;
  if v_hours > 0 then
    v_count := greatest(1, ceil(v_hours / (greatest(v_row.crew, 1) * 8.0))::integer);
    select coalesce(array_agg(day order by day), '{}') into v_days from ops.install_working_days(p_start, v_count, false) as day;
    v_ids := ops.pick_install_resources(v_days, greatest(v_row.crew, 1), 0, 'small', 0, false);
    if v_ids is null then raise exception 'app: Those engineers or vans are no longer free. Choose another start date.'; end if;
    v_end := v_days[array_length(v_days, 1)];
    v_resources := ops.hold_install_resources(v_row.id, v_ids, v_days);
  end if;
  update ops.installs set
    status = 'booked', install_price = p_customer_price, subcontractor_price = v_thread.confirmed_price,
    subcontractor_id = p_subcontractor, delivered_by = 'subcontractor',
    start_on = p_start, end_on = v_end, resources = v_resources, updated_at = now()
  where id = v_row.id;
  update ops.subcontractor_threads
  set status = case when subcontractor_id = p_subcontractor then 'chosen' else 'declined' end
  where install_id = v_row.id;
  return public.install_read(v_row.id);
end;
$$;

create or replace function public.install_subcontractor_board(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = ops, public as $$
begin
  if ops.is_field_engineer() then
    raise exception 'app: Field engineers cannot do that.';
  end if;
  if not (public.workspace_can('operations', 'view') or public.workspace_can('sales', 'view') or public.workspace_is_admin()) then
    raise exception 'app: You cannot see that install.';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', thread.id,
      'subcontractorId', thread.subcontractor_id,
      'name', sub.name,
      'emails', case when coalesce(array_length(sub.emails, 1), 0) > 0 then to_jsonb(sub.emails) else jsonb_build_array(sub.email) end,
      'status', thread.status,
      'subject', thread.subject,
      'suggestedPrice', thread.suggested_price,
      'confirmedPrice', thread.confirmed_price,
      'messages', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', message.id, 'direction', message.direction, 'from', message.from_address, 'to', message.to_address,
          'subject', message.subject, 'body', message.body_text, 'delivery', message.delivery,
          'suggestedPrice', message.suggested_price, 'bodyUnavailable', message.body_unavailable, 'createdAt', message.created_at
        ) order by message.created_at)
        from ops.subcontractor_messages message where message.thread_id = thread.id
      ), '[]'::jsonb)
    ) order by sub.name)
    from ops.subcontractor_threads thread
    join ops.subcontractors sub on sub.id = thread.subcontractor_id
    where thread.install_id = p_id
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.subcontractor_record_reply(text, text, text, text, text, text, numeric, boolean) from public, anon, authenticated;
revoke all on function public.install_job_preview(text) from public, anon, authenticated;
grant execute on function public.subcontractor_record_reply(text, text, text, text, text, text, numeric, boolean) to service_role;
grant execute on function public.install_job_preview(text) to service_role;
revoke all on function public.subcontractor_resend(uuid) from public, anon;
grant execute on function public.subcontractor_resend(uuid) to authenticated, service_role;




