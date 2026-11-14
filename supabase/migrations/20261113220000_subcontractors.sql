-- Subcontractor directory, quoting installs, and inbound quote replies.
-- New file only. Do not edit earlier migrations. Do not apply this to production.
-- The seed is the approved-subcontractor sheet. Monday.com insurance links are not
-- imported, so nobody is insured until a document is uploaded.

alter table ops.subcontractors
  add column emails text[] not null default '{}',
  add column max_crew integer check (max_crew is null or max_crew > 0);

alter table ops.subcontractors drop constraint if exists subcontractors_status_check;
alter table ops.subcontractors
  add constraint subcontractors_status_check
  check (status in ('active', 'preferred', 'on_hold', 'inactive'));

update ops.subcontractors
set emails = array[lower(btrim(email))]
where email is not null and btrim(email) <> '' and emails = '{}';

comment on column ops.subcontractors.capabilities is
  'Job types this subcontractor covers: install, flooring, service, and others.';
comment on column ops.subcontractors.emails is
  'Addresses we can write to. email stays as the first address for older reads.';

create table ops.subcontractor_insurance (
  id uuid primary key default gen_random_uuid(),
  subcontractor_id uuid not null references ops.subcontractors (id) on delete cascade,
  file_id uuid not null references core.files (id) on delete restrict,
  expires_on date not null,
  label text,
  created_at timestamptz not null default now()
);

create index subcontractor_insurance_sub_idx
  on ops.subcontractor_insurance (subcontractor_id, expires_on desc);

create table ops.subcontractor_threads (
  id uuid primary key default gen_random_uuid(),
  install_id uuid not null references ops.installs (id) on delete cascade,
  subcontractor_id uuid not null references ops.subcontractors (id) on delete restrict,
  reply_token text not null unique check (reply_token ~ '^[a-z0-9]{16,64}$'),
  subject text not null,
  status text not null default 'queued'
    check (status in ('queued', 'sent', 'replied', 'chosen', 'declined')),
  suggested_price numeric(14,2),
  confirmed_price numeric(14,2),
  created_at timestamptz not null default now(),
  unique (install_id, subcontractor_id)
);

create index subcontractor_threads_install_idx
  on ops.subcontractor_threads (install_id, created_at);

create table ops.subcontractor_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references ops.subcontractor_threads (id) on delete cascade,
  direction text not null check (direction in ('out', 'in')),
  from_address text,
  to_address text,
  subject text,
  body_text text,
  provider_id text,
  delivery text check (delivery is null or delivery in ('logged', 'sent', 'failed', 'redirected')),
  suggested_price numeric(14,2),
  created_at timestamptz not null default now()
);

create unique index subcontractor_messages_provider_idx
  on ops.subcontractor_messages (provider_id)
  where provider_id is not null;

alter table ops.subcontractor_insurance enable row level security;
alter table ops.subcontractor_threads enable row level security;
alter table ops.subcontractor_messages enable row level security;

revoke all on ops.subcontractor_insurance, ops.subcontractor_threads, ops.subcontractor_messages
  from public, anon, authenticated;
grant all on ops.subcontractor_insurance, ops.subcontractor_threads, ops.subcontractor_messages
  to service_role;

alter table ops.installs drop constraint if exists installs_status_check;
alter table ops.installs
  add constraint installs_status_check
  check (status in ('quoting', 'booked', 'scheduled', 'in_progress', 'completed', 'cancelled'));

alter table ops.installs alter column install_price drop not null;
alter table ops.installs alter column start_on drop not null;
alter table ops.installs alter column end_on drop not null;

alter table ops.installs
  add column delivered_by ops.delivered_by not null default 'in_house',
  add column subcontractor_id uuid references ops.subcontractors (id) on delete set null,
  add column subcontractor_price numeric(14,2),
  add column suggested_dates date[] not null default '{}';

alter table ops.installs
  add constraint installs_quoted_shape check (
    status in ('quoting', 'cancelled')
    or (install_price is not null and start_on is not null and end_on is not null)
  );

create index installs_subcontractor_idx on ops.installs (subcontractor_id);

create or replace function ops.subcontractor_insured(p_id uuid, p_on date)
returns boolean
language sql
stable
as $$
  select exists (
    select 1 from ops.subcontractor_insurance doc
    where doc.subcontractor_id = p_id and doc.expires_on >= p_on
  ) or exists (
    select 1 from ops.subcontractors sub
    where sub.id = p_id
      and sub.insurance_file_id is not null
      and sub.insurance_expires_on is not null
      and sub.insurance_expires_on >= p_on
  );
$$;

create or replace function ops.install_stage(p_row ops.installs)
returns text
language sql
stable
as $$
  select case
    when p_row.status = 'completed' then 'completed'
    when p_row.status = 'quoting' then 'quoting'
    when p_row.access_submitted_at is not null then 'ready'
    when p_row.access_sent_at is not null then 'awaiting_access'
    else 'booked'
  end;
$$;

comment on function ops.install_stage(ops.installs) is
  'quoting while a subcontractor quote is open. ready means the form was submitted. Photos and videos stay optional.';

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
    'stage', ops.install_stage(p_row),
    'needsCustomerEmail', p_row.needs_customer_email,
    'bookingRepId', p_row.booking_rep_id,
    'bookingRepName', (select full_name from public.profiles where id = p_row.booking_rep_id),
    'proposalPath', coalesce(p_row.proposal_path, (select proposal_path from ops.service_quotes where id = p_row.service_quote_id)),
    'serviceQuoteId', p_row.service_quote_id,
    'access', ops.install_access_json(p_row.id),
    'deliveredBy', p_row.delivered_by,
    'subcontractorId', p_row.subcontractor_id,
    'subcontractorName', (select name from ops.subcontractors where id = p_row.subcontractor_id),
    'subcontractorPrice', p_row.subcontractor_price,
    'suggestedDates', to_jsonb(p_row.suggested_dates)
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
    ) else '{}'::jsonb end order by i.start_on nulls last, i.order_number)
    from ops.installs i
    where i.status <> 'cancelled'
      and (
        i.status = 'quoting'
        or (i.start_on <= p_to and i.end_on >= p_from)
      )
      and (not coalesce(p_mine, false) or i.booking_rep_id = auth.uid())
  ), '[]'::jsonb);
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
  if not (public.workspace_can('sales', 'edit') or public.workspace_can('operations', 'edit')) then
    raise exception 'app: You cannot book an install.';
  end if;
  select * into v_quote from ops.install_quotes where id = p_quote_id for update;
  if v_quote.id is null then
    raise exception 'app: Price the order before booking.';
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
  if v_row.status = 'quoting' then
    raise exception 'app: Award the subcontractor quote before moving dates.';
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
declare
  v_status text;
begin
  if not public.workspace_can('operations', 'edit') then
    raise exception 'app: You cannot change that install.';
  end if;
  if p_status not in ('booked', 'scheduled', 'in_progress', 'completed', 'cancelled') then
    raise exception 'app: Choose a status.';
  end if;
  select status into v_status from ops.installs where id = p_id for update;
  if v_status is null then
    raise exception 'app: That install was not found.';
  end if;
  if v_status = 'quoting' and p_status <> 'cancelled' then
    raise exception 'app: Award the subcontractor quote before changing the status.';
  end if;
  if p_status = 'cancelled' then
    delete from ops.install_reservations where install_id = p_id;
    if v_status = 'quoting' then
      update ops.install_quotes set install_id = null where install_id = p_id;
    end if;
  end if;
  update ops.installs set status = p_status, updated_at = now() where id = p_id;
  return public.install_read(p_id);
end;
$$;

create or replace function ops.subcontractor_json(p_row ops.subcontractors)
returns jsonb
language sql
stable
as $$
  select jsonb_build_object(
    'id', p_row.id,
    'name', p_row.name,
    'contactName', p_row.contact_name,
    'phone', p_row.phone,
    'emails', case
      when coalesce(array_length(p_row.emails, 1), 0) > 0 then to_jsonb(p_row.emails)
      when nullif(btrim(coalesce(p_row.email, '')), '') is not null then jsonb_build_array(lower(btrim(p_row.email)))
      else '[]'::jsonb
    end,
    'regions', to_jsonb(p_row.regions),
    'jobTypes', to_jsonb(p_row.capabilities),
    'maxCrew', p_row.max_crew,
    'status', p_row.status,
    'notes', p_row.notes,
    'insurance', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', doc.id,
        'fileId', doc.file_id,
        'expiresOn', doc.expires_on,
        'label', doc.label,
        'bucket', (select bucket from core.files where id = doc.file_id),
        'path', (select storage_path from core.files where id = doc.file_id)
      ) order by doc.expires_on desc)
      from ops.subcontractor_insurance doc
      where doc.subcontractor_id = p_row.id
    ), '[]'::jsonb)
  );
$$;

create or replace function public.subcontractor_list()
returns jsonb
language plpgsql
stable
security definer
set search_path = ops, public
as $$
begin
  if not (
    public.workspace_can('operations', 'view')
    or public.workspace_can('sales', 'view')
    or public.workspace_is_admin()
  ) then
    raise exception 'app: You cannot see subcontractors.';
  end if;
  return coalesce((
    select jsonb_agg(ops.subcontractor_json(sub) order by sub.name)
    from ops.subcontractors sub
  ), '[]'::jsonb);
end;
$$;

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
  select coalesce(array_agg(distinct lower(btrim(item))), '{}')
  into v_emails
  from jsonb_array_elements_text(coalesce(p_row->'emails', '[]'::jsonb)) as listed(item)
  where btrim(item) <> '';
  select coalesce(array_agg(distinct btrim(item)), '{}')
  into v_regions
  from jsonb_array_elements_text(coalesce(p_row->'regions', '[]'::jsonb)) as listed(item)
  where btrim(item) <> '';
  select coalesce(array_agg(distinct lower(btrim(item))), '{}')
  into v_types
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
    update ops.subcontractors
    set name = v_name,
        contact_name = nullif(btrim(coalesce(p_row->>'contactName', '')), ''),
        phone = nullif(btrim(coalesce(p_row->>'phone', '')), ''),
        email = v_email,
        emails = v_emails,
        regions = v_regions,
        capabilities = v_types,
        max_crew = v_max,
        status = v_status,
        notes = nullif(btrim(coalesce(p_row->>'notes', '')), '')
    where id = p_id
    returning id into v_id;
    if v_id is null then
      raise exception 'app: That subcontractor was not found.';
    end if;
  end if;
  return v_id;
end;
$$;

create or replace function public.subcontractor_remove(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ops, public
as $$
begin
  if not public.workspace_can('operations', 'edit') then
    raise exception 'app: You cannot remove subcontractors.';
  end if;
  if exists (select 1 from ops.subcontractor_threads where subcontractor_id = p_id) then
    raise exception 'app: This subcontractor has quote threads.';
  end if;
  delete from ops.subcontractors where id = p_id;
  if not found then
    raise exception 'app: That subcontractor was not found.';
  end if;
end;
$$;

create or replace function public.subcontractor_attach_insurance(
  p_subcontractor uuid,
  p_file uuid,
  p_expires date,
  p_label text
)
returns uuid
language plpgsql
security definer
set search_path = ops, public
as $$
declare
  v_id uuid;
begin
  if coalesce(auth.role(), '') is distinct from 'service_role'
     and not public.workspace_can('operations', 'edit') then
    raise exception 'app: You cannot add insurance.';
  end if;
  if p_expires is null then
    raise exception 'app: Enter an expiry date.';
  end if;
  if not exists (select 1 from ops.subcontractors where id = p_subcontractor) then
    raise exception 'app: That subcontractor was not found.';
  end if;
  insert into ops.subcontractor_insurance (subcontractor_id, file_id, expires_on, label)
  values (p_subcontractor, p_file, p_expires, nullif(btrim(coalesce(p_label, '')), ''))
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.subcontractor_drop_insurance(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ops, public
as $$
begin
  if not public.workspace_can('operations', 'edit') then
    raise exception 'app: You cannot remove insurance.';
  end if;
  delete from ops.subcontractor_insurance where id = p_id;
  if not found then
    raise exception 'app: That document was not found.';
  end if;
end;
$$;

create or replace function public.subcontractor_open(p_quote_id uuid, p_dates date[], p_sends jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ops, public
as $$
declare
  v_quote ops.install_quotes%rowtype;
  v_install ops.installs%rowtype;
  v_payload jsonb;
  v_requirements jsonb;
  v_id uuid;
  v_send jsonb;
  v_sub uuid;
  v_token text;
  v_threads jsonb := '[]'::jsonb;
begin
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
  if v_quote.id is null then
    raise exception 'app: Price the order before asking subcontractors.';
  end if;
  if v_quote.created_by is distinct from auth.uid() and not public.workspace_is_admin() and not public.workspace_can('operations', 'edit') then
    raise exception 'app: You cannot send that quote.';
  end if;
  v_payload := v_quote.payload;
  v_requirements := coalesce(v_payload->'requirements', '{}'::jsonb);
  if v_quote.install_id is not null then
    select * into v_install from ops.installs where id = v_quote.install_id for update;
    if v_install.status is distinct from 'quoting' then
      raise exception 'app: That order is already booked.';
    end if;
    update ops.installs set suggested_dates = p_dates, updated_at = now() where id = v_install.id;
  else
    insert into ops.installs (
      quote_id, order_number, goods_net, install_price, start_on, end_on,
      customer_name, contact_name, contact_email, contact_phone, site_address,
      status, booking_rep_id, service_quote_id, proposal_path,
      flags, hq_build, site_install, crew, van_size, van_count, lines,
      cin7_sale_id, cin7_customer_id, delivered_by, suggested_dates
    ) values (
      v_quote.id,
      v_quote.order_number,
      (v_payload->>'goodsNet')::numeric,
      null,
      null,
      null,
      coalesce(v_payload->>'customerName', ''),
      v_payload->>'contactName',
      v_payload->>'contactEmail',
      v_payload->>'contactPhone',
      v_payload->>'siteAddress',
      'quoting',
      auth.uid(),
      nullif(v_payload->>'serviceQuoteId', '')::uuid,
      v_payload->>'proposalPath',
      coalesce(v_payload->'flags', '[]'::jsonb),
      coalesce(v_payload->'hqBuild', '{}'::jsonb),
      coalesce(v_payload->'siteInstall', '{}'::jsonb),
      greatest(coalesce((v_requirements->>'installers')::integer, 1), 1),
      case when coalesce(v_requirements->>'vanSize', 'small') = 'crafter' then 'crafter' else 'small' end,
      greatest(coalesce((v_requirements->>'vanCount')::integer, 1), 1),
      coalesce(v_payload->'lines', '[]'::jsonb),
      v_payload->>'cin7SaleId',
      v_payload->>'cin7CustomerId',
      'subcontractor',
      p_dates
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
    if not exists (
      select 1 from ops.subcontractors
      where id = v_sub and (coalesce(array_length(emails, 1), 0) > 0 or nullif(btrim(coalesce(email, '')), '') is not null)
    ) then
      raise exception 'app: That subcontractor has no email.';
    end if;
    if exists (select 1 from ops.subcontractor_threads where install_id = v_install.id and subcontractor_id = v_sub) then
      raise exception 'app: That subcontractor was already emailed for this order.';
    end if;
    insert into ops.subcontractor_threads (install_id, subcontractor_id, reply_token, subject, status)
    values (v_install.id, v_sub, v_token, coalesce(v_send->>'subject', 'Install quote'), 'queued')
    returning id into v_id;
    v_threads := v_threads || jsonb_build_array(jsonb_build_object(
      'id', v_id,
      'subcontractorId', v_sub,
      'replyToken', v_token,
      'email', coalesce(v_send->>'to', '')
    ));
  end loop;

  if jsonb_array_length(v_threads) = 0 then
    raise exception 'app: Choose a subcontractor.';
  end if;
  return jsonb_build_object('installId', v_install.id, 'threads', v_threads);
end;
$$;

create or replace function public.subcontractor_log_message(
  p_thread uuid,
  p_direction text,
  p_from text,
  p_to text,
  p_subject text,
  p_body text,
  p_provider text,
  p_delivery text,
  p_suggested numeric
)
returns uuid
language plpgsql
security definer
set search_path = ops, public
as $$
declare
  v_id uuid;
begin
  if coalesce(auth.role(), '') is distinct from 'service_role'
     and not (public.workspace_can('sales', 'edit') or public.workspace_can('operations', 'edit')) then
    raise exception 'app: You cannot write that thread.';
  end if;
  if p_direction not in ('out', 'in') then
    raise exception 'app: That message could not be stored.';
  end if;
  insert into ops.subcontractor_messages (
    thread_id, direction, from_address, to_address, subject, body_text, provider_id, delivery, suggested_price
  ) values (
    p_thread, p_direction, p_from, p_to, p_subject, p_body, nullif(p_provider, ''), p_delivery, p_suggested
  ) returning id into v_id;
  if p_direction = 'out' and p_delivery in ('logged', 'sent', 'redirected') then
    update ops.subcontractor_threads set status = 'sent' where id = p_thread and status = 'queued';
  end if;
  return v_id;
end;
$$;

create or replace function public.subcontractor_record_reply(
  p_token text,
  p_from text,
  p_to text,
  p_subject text,
  p_body text,
  p_provider text,
  p_suggested numeric
)
returns jsonb
language plpgsql
security definer
set search_path = ops, public
as $$
declare
  v_thread ops.subcontractor_threads%rowtype;
begin
  if coalesce(auth.role(), '') is distinct from 'service_role' then
    raise exception 'app: You cannot write that reply.';
  end if;
  if p_provider is not null and exists (
    select 1 from ops.subcontractor_messages where provider_id = p_provider
  ) then
    return jsonb_build_object('matched', true, 'duplicate', true);
  end if;
  select * into v_thread from ops.subcontractor_threads where reply_token = p_token;
  if v_thread.id is null then
    return jsonb_build_object('matched', false);
  end if;
  insert into ops.subcontractor_messages (
    thread_id, direction, from_address, to_address, subject, body_text, provider_id, suggested_price
  ) values (
    v_thread.id, 'in', p_from, p_to, p_subject, p_body, nullif(p_provider, ''), p_suggested
  );
  update ops.subcontractor_threads
  set status = case when status = 'chosen' then status else 'replied' end,
      suggested_price = coalesce(p_suggested, suggested_price)
  where id = v_thread.id;
  return jsonb_build_object('matched', true, 'threadId', v_thread.id, 'installId', v_thread.install_id);
end;
$$;

create or replace function public.subcontractor_confirm_price(p_thread uuid, p_price numeric)
returns void
language plpgsql
security definer
set search_path = ops, public
as $$
declare
  v_install uuid;
  v_rep uuid;
begin
  if p_price is null or p_price <= 0 then
    raise exception 'app: Enter the subcontractor price.';
  end if;
  select thread.install_id, install.booking_rep_id
  into v_install, v_rep
  from ops.subcontractor_threads thread
  join ops.installs install on install.id = thread.install_id
  where thread.id = p_thread;
  if v_install is null then
    raise exception 'app: That reply was not found.';
  end if;
  if v_rep is distinct from auth.uid() and not public.workspace_is_admin() and not public.workspace_can('operations', 'edit') then
    raise exception 'app: You cannot confirm that price.';
  end if;
  update ops.subcontractor_threads set confirmed_price = p_price where id = p_thread;
end;
$$;

create or replace function public.subcontractor_award(
  p_install uuid,
  p_subcontractor uuid,
  p_customer_price numeric,
  p_start date
)
returns jsonb
language plpgsql
security definer
set search_path = ops, public
as $$
declare
  v_row ops.installs%rowtype;
  v_quote ops.install_quotes%rowtype;
  v_thread ops.subcontractor_threads%rowtype;
  v_hours numeric;
  v_count integer;
  v_days date[];
  v_ids uuid[];
  v_requirements jsonb;
  v_resources jsonb;
  v_end date;
begin
  if p_customer_price is null or p_customer_price <= 0 then
    raise exception 'app: Enter the customer price.';
  end if;
  select * into v_row from ops.installs where id = p_install for update;
  if v_row.id is null or v_row.status is distinct from 'quoting' then
    raise exception 'app: That quote is not open.';
  end if;
  if v_row.booking_rep_id is distinct from auth.uid() and not public.workspace_is_admin() and not public.workspace_can('operations', 'edit') then
    raise exception 'app: You cannot award that quote.';
  end if;
  if not ops.subcontractor_insured(p_subcontractor, current_date) then
    raise exception 'app: That subcontractor has no in-date insurance.';
  end if;
  select * into v_thread
  from ops.subcontractor_threads
  where install_id = p_install and subcontractor_id = p_subcontractor;
  if v_thread.id is null then
    raise exception 'app: Email that subcontractor before awarding the job.';
  end if;
  if v_thread.confirmed_price is null then
    raise exception 'app: Confirm the subcontractor price first.';
  end if;
  select coalesce(array_agg(day order by day), '{}')
  into v_days
  from ops.install_working_days(p_start, 1, false) as day;
  if v_days[1] is distinct from p_start then
    raise exception 'app: Choose a weekday start date.';
  end if;

  select * into v_quote from ops.install_quotes where id = v_row.quote_id;
  v_requirements := coalesce(v_quote.payload->'requirements', '{}'::jsonb);
  v_hours := coalesce((v_quote.payload #>> '{hqBuild,personHours}')::numeric, 0);
  v_count := greatest(1, ceil(v_hours / (greatest(v_row.crew, 1) * 8.0))::integer);
  select coalesce(array_agg(day order by day), '{}')
  into v_days
  from ops.install_working_days(p_start, v_count, false) as day;
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
  set status = 'booked',
      install_price = p_customer_price,
      subcontractor_price = v_thread.confirmed_price,
      subcontractor_id = p_subcontractor,
      delivered_by = 'subcontractor',
      start_on = p_start,
      end_on = v_end,
      resources = v_resources,
      updated_at = now()
  where id = v_row.id;
  update ops.subcontractor_threads
  set status = case when subcontractor_id = p_subcontractor then 'chosen' else 'declined' end
  where install_id = v_row.id;
  return public.install_read(v_row.id);
end;
$$;

create or replace function public.install_subcontractor_board(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ops, public
as $$
begin
  if not (
    public.workspace_can('operations', 'view')
    or public.workspace_can('sales', 'view')
    or public.workspace_is_admin()
  ) then
    raise exception 'app: You cannot see that install.';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', thread.id,
      'subcontractorId', thread.subcontractor_id,
      'name', sub.name,
      'emails', case
        when coalesce(array_length(sub.emails, 1), 0) > 0 then to_jsonb(sub.emails)
        else jsonb_build_array(sub.email)
      end,
      'status', thread.status,
      'subject', thread.subject,
      'suggestedPrice', thread.suggested_price,
      'confirmedPrice', thread.confirmed_price,
      'messages', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', message.id,
          'direction', message.direction,
          'from', message.from_address,
          'to', message.to_address,
          'subject', message.subject,
          'body', message.body_text,
          'delivery', message.delivery,
          'suggestedPrice', message.suggested_price,
          'createdAt', message.created_at
        ) order by message.created_at)
        from ops.subcontractor_messages message
        where message.thread_id = thread.id
      ), '[]'::jsonb)
    ) order by sub.name)
    from ops.subcontractor_threads thread
    join ops.subcontractors sub on sub.id = thread.subcontractor_id
    where thread.install_id = p_id
  ), '[]'::jsonb);
end;
$$;

create or replace function public.install_job_preview(p_token_hash text)
returns jsonb
language plpgsql
security definer
set search_path = ops, core, public
as $$
declare
  v_token jsonb;
  v_install ops.installs%rowtype;
begin
  if coalesce(auth.role(), '') is distinct from 'service_role' then
    raise exception 'app: You cannot open that job sheet.';
  end if;
  v_token := public.orbit_resolve_token(p_token_hash);
  if v_token is null or v_token->>'purpose' is distinct from 'subcontractor_job' or v_token->>'entity_table' is distinct from 'installs' then
    return null;
  end if;
  select * into v_install from ops.installs where id = (v_token->>'entity_id')::uuid;
  if v_install.id is null then
    return null;
  end if;
  return jsonb_build_object(
    'installId', v_install.id,
    'orderNumber', v_install.order_number,
    'customerName', v_install.customer_name,
    'siteAddress', v_install.site_address,
    'startOn', v_install.start_on,
    'endOn', v_install.end_on,
    'subcontractorName', (select name from ops.subcontractors where id = v_install.subcontractor_id),
    'lines', coalesce((
      select jsonb_agg(jsonb_build_object(
        'qty', item->>'qty',
        'description', coalesce(item->>'description', item->>'sku')
      ))
      from jsonb_array_elements(coalesce(v_install.lines, '[]'::jsonb)) as listed(item)
    ), '[]'::jsonb)
  );
end;
$$;

-- Sheet rows only. No insurance documents, Monday links, or expiry dates.
insert into ops.subcontractors (
  id, name, contact_name, phone, email, emails, regions, capabilities, max_crew, status, notes
) values
  ('10000000-0000-4000-8000-000000000001', 'Amazon Leisure', 'Sarah Forder', '07834 753160', 'sarah@amazon-leisure', array['sarah@amazon-leisure'], '{}', array['install', 'flooring'], null, 'preferred', 'Can undertake any install type'),
  ('10000000-0000-4000-8000-000000000002', 'Taylor Made Fitness Solutions', 'Danny Taylor', '07538 518195', 'danny.taylor@tm-fs.com', array['danny.taylor@tm-fs.com'], '{}', array['install'], 4, 'on_hold', 'Can do up to 4 man installs'),
  ('10000000-0000-4000-8000-000000000003', 'Draig Fitness', 'Chris Stevens', '07799325318', 'chris@draigfitness.com', array['chris@draigfitness.com'], '{}', array['install'], null, 'preferred', 'Not used often.'),
  ('10000000-0000-4000-8000-000000000004', 'Eamon o''Conner', 'Eamon o''Conner', '+353 87 678 7150', 'ocmsirl@gmail.com', array['ocmsirl@gmail.com'], array['Ireland'], array['install'], null, 'on_hold', 'Ireland only.'),
  ('10000000-0000-4000-8000-000000000005', 'Fitness Bricks', 'Matt Leadbetter', '07751 193799', 'matt@fitnessbricks.co.uk', array['matt@fitnessbricks.co.uk'], '{}', array['install'], null, 'on_hold', 'Tends to be expensive.'),
  ('10000000-0000-4000-8000-000000000006', 'Globalise Fitness Solutions', 'Reg Varney', '07901 776557', 'reg@gfs-ukltd.com', array['reg@gfs-ukltd.com'], array['West Country'], array['install'], null, 'on_hold', 'Covers west country. Good pricing and reliable.'),
  ('10000000-0000-4000-8000-000000000007', 'GRS', 'Ady Dockerill', '01353 862863', 'adrian@gymrepairservices.co.uk', array['adrian@gymrepairservices.co.uk'], '{}', array['install'], null, 'preferred', 'Will not do flooring. Will pick and choose jobs.'),
  ('10000000-0000-4000-8000-000000000008', 'Power Leisure', 'Darren Bell', '07887 781791', 'service@poerleisure.info', array['service@poerleisure.info'], array['Scotland', 'UK'], array['install'], null, 'preferred', 'Based in Scotland but covers UK. Prices good, especially in Scotland.'),
  ('10000000-0000-4000-8000-000000000009', 'Trigon', 'Joe Riley', '01420 579048', 'joe@trigonfitness.com', array['joe@trigonfitness.com'], '{}', array['install'], null, 'on_hold', 'Very reliable.'),
  ('10000000-0000-4000-8000-00000000000a', 'FitKit', 'Scott Lamber', '07539301039', 'scott.lamber@fitkituk.com', array['scott.lamber@fitkituk.com'], '{}', array['install'], null, 'preferred', 'Can be expesive.'),
  ('10000000-0000-4000-8000-00000000000b', 'Gym Logistics', 'Geoff', null, 'info@gymlogistics.co.uk', array['info@gymlogistics.co.uk'], '{}', array['install'], null, 'preferred', null);

revoke all on function ops.subcontractor_insured(uuid, date) from public, anon, authenticated;
revoke all on function ops.subcontractor_json(ops.subcontractors) from public, anon, authenticated;
revoke all on function ops.install_stage(ops.installs) from public, anon, authenticated;
revoke all on function ops.install_span(ops.installs) from public, anon, authenticated;

revoke all on function public.subcontractor_list() from public, anon;
revoke all on function public.subcontractor_save(uuid, jsonb) from public, anon;
revoke all on function public.subcontractor_remove(uuid) from public, anon;
revoke all on function public.subcontractor_attach_insurance(uuid, uuid, date, text) from public, anon;
revoke all on function public.subcontractor_drop_insurance(uuid) from public, anon;
revoke all on function public.subcontractor_open(uuid, date[], jsonb) from public, anon;
revoke all on function public.subcontractor_log_message(uuid, text, text, text, text, text, text, text, numeric) from public, anon;
revoke all on function public.subcontractor_record_reply(text, text, text, text, text, text, numeric) from public, anon;
revoke all on function public.subcontractor_confirm_price(uuid, numeric) from public, anon;
revoke all on function public.subcontractor_award(uuid, uuid, numeric, date) from public, anon;
revoke all on function public.install_subcontractor_board(uuid) from public, anon;
revoke all on function public.install_job_preview(text) from public, anon;

grant execute on function public.subcontractor_list() to authenticated, service_role;
grant execute on function public.subcontractor_save(uuid, jsonb) to authenticated, service_role;
grant execute on function public.subcontractor_remove(uuid) to authenticated, service_role;
grant execute on function public.subcontractor_attach_insurance(uuid, uuid, date, text) to authenticated, service_role;
grant execute on function public.subcontractor_drop_insurance(uuid) to authenticated, service_role;
grant execute on function public.subcontractor_open(uuid, date[], jsonb) to authenticated, service_role;
grant execute on function public.subcontractor_log_message(uuid, text, text, text, text, text, text, text, numeric) to authenticated, service_role;
grant execute on function public.subcontractor_record_reply(text, text, text, text, text, text, numeric) to service_role;
grant execute on function public.subcontractor_confirm_price(uuid, numeric) to authenticated, service_role;
grant execute on function public.subcontractor_award(uuid, uuid, numeric, date) to authenticated, service_role;
grant execute on function public.install_subcontractor_board(uuid) to authenticated, service_role;
grant execute on function public.install_job_preview(text) to service_role;
