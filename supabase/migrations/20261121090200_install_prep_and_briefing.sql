-- Install preparation: one HQ build task, one vehicle check, the engineer
-- briefing, and the Start gate. New file only. Do not apply this to production.
-- Weekends are never due dates and never a day a job can be started.

alter table ops.installs
  add column if not exists started_at timestamptz;

comment on column ops.installs.started_at is
  'Set when an engineer starts the job. Risk and job-sheet saves stay closed until then. Token visits are exempt.';

update ops.installs i
set started_at = coalesce(i.updated_at, i.created_at, now())
where i.started_at is null
  and (
    i.status in ('in_progress', 'completed')
    or exists (select 1 from ops.risk_assessments r where r.install_id = i.id)
    or exists (select 1 from ops.visit_sheets s where s.install_id = i.id)
  );

create table ops.install_prep_tasks (
  id uuid primary key default gen_random_uuid(),
  install_id uuid not null references ops.installs (id) on delete cascade,
  kind text not null check (kind in ('hq_build', 'vehicle_check')),
  title text not null,
  body text,
  status text not null default 'open' check (status in ('open', 'done', 'cancelled')),
  due_on date,
  items jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  completed_by uuid references public.profiles (id) on delete set null,
  unique (install_id, kind)
);

create table ops.install_prep_assignees (
  task_id uuid not null references ops.install_prep_tasks (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  primary key (task_id, profile_id)
);

create table ops.install_hq_photos (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references ops.install_prep_tasks (id) on delete cascade,
  install_id uuid not null references ops.installs (id) on delete cascade,
  item_key text not null,
  file_id uuid not null references core.files (id) on delete restrict,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (task_id, file_id)
);

create table ops.vehicle_checks (
  id uuid primary key default gen_random_uuid(),
  install_id uuid not null unique references ops.installs (id) on delete cascade,
  task_id uuid not null references ops.install_prep_tasks (id) on delete restrict,
  driver_id uuid not null references public.profiles (id) on delete restrict,
  van_id uuid not null references ops.vans (id) on delete restrict,
  lights boolean not null,
  indicators boolean not null,
  mirrors boolean not null,
  brakes boolean not null,
  fueled boolean not null,
  tyre_pressure numeric(8,2) not null,
  tread_depth numeric(8,2) not null,
  no_warning_lights boolean not null,
  new_damage boolean not null,
  damage_note text,
  fit_to_drive boolean not null,
  confirmed boolean not null,
  submitted_by uuid references public.profiles (id) on delete set null,
  submitted_at timestamptz not null default now(),
  check (confirmed),
  check (tyre_pressure >= 0 and tyre_pressure <= 200),
  check (tread_depth >= 0 and tread_depth <= 30),
  check (new_damage = false or nullif(btrim(damage_note), '') is not null)
);

create table ops.vehicle_check_files (
  check_id uuid not null references ops.vehicle_checks (id) on delete cascade,
  file_id uuid not null references core.files (id) on delete restrict,
  primary key (check_id, file_id)
);

create table ops.vehicle_flags (
  id uuid primary key default gen_random_uuid(),
  install_id uuid not null references ops.installs (id) on delete cascade,
  van_id uuid not null references ops.vans (id) on delete restrict,
  check_id uuid not null references ops.vehicle_checks (id) on delete cascade,
  reason text not null check (reason in ('damage', 'unfit')),
  note text,
  status text not null default 'open' check (status in ('open', 'resolved')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references public.profiles (id) on delete set null,
  unique (check_id, reason)
);

create index install_prep_tasks_due_idx on ops.install_prep_tasks (status, due_on);
create index vehicle_flags_open_idx on ops.vehicle_flags (van_id, status);

alter table ops.install_prep_tasks enable row level security;
alter table ops.install_prep_assignees enable row level security;
alter table ops.install_hq_photos enable row level security;
alter table ops.vehicle_checks enable row level security;
alter table ops.vehicle_check_files enable row level security;
alter table ops.vehicle_flags enable row level security;

revoke all on ops.install_prep_tasks, ops.install_prep_assignees, ops.install_hq_photos,
  ops.vehicle_checks, ops.vehicle_check_files, ops.vehicle_flags
  from public, anon, authenticated;
grant all on ops.install_prep_tasks, ops.install_prep_assignees, ops.install_hq_photos,
  ops.vehicle_checks, ops.vehicle_check_files, ops.vehicle_flags
  to service_role;

comment on table ops.install_prep_tasks is
  'One HQ build task and one vehicle check per install. The unique key stops a second copy.';
comment on table ops.vehicle_flags is
  'Open when a vehicle check reports new damage or a vehicle that is not fit to drive.';

create or replace function ops.prep_due_on(p_start date, p_count integer)
returns date
language plpgsql
immutable
as $$
declare
  v_day date := p_start;
  v_left integer := greatest(coalesce(p_count, 0), 0);
begin
  if p_start is null then
    return null;
  end if;
  while v_left > 0 loop
    v_day := v_day - 1;
    if extract(isodow from v_day) < 6 then
      v_left := v_left - 1;
    end if;
  end loop;
  return v_day;
end;
$$;

create or replace function ops.install_day_open(p_start date, p_end date, p_today date)
returns boolean
language sql
immutable
as $$
  select p_start is not null
    and p_end is not null
    and p_today is not null
    and extract(isodow from p_today) < 6
    and p_today between p_start and p_end;
$$;

revoke all on function ops.prep_due_on(date, integer) from public, anon, authenticated;
revoke all on function ops.install_day_open(date, date, date) from public, anon, authenticated;

create or replace function ops.install_default_van(p_install uuid)
returns uuid
language sql
stable
security definer
set search_path = ops, public
as $$
  with reserved as (
    select distinct regexp_replace(upper(named.name), '[[:space:]]', '', 'g') as key
    from (
      select r.name
      from ops.install_reservations ir
      join ops.resources r on r.id = ir.resource_id
      where ir.install_id = p_install and r.resource_type = 'van'
      union
      select r.name
      from ops.installs i
      cross join lateral jsonb_array_elements(case when jsonb_typeof(i.resources) = 'array' then i.resources else '[]'::jsonb end) elem
      join ops.resources r on r.id::text = elem->>'id'
      where i.id = p_install and r.resource_type = 'van'
    ) named
  ),
  ranked as (
    select v.id,
      case
        when exists (
          select 1 from reserved k
          where k.key = regexp_replace(upper(v.registration), '[[:space:]]', '', 'g')
        ) then 0
        when nullif(regexp_replace(upper(coalesce(v.name, '')), '[[:space:]]', '', 'g'), '') is not null
          and exists (
            select 1 from reserved k
            where k.key = regexp_replace(upper(v.name), '[[:space:]]', '', 'g')
          ) then 1
        when length(regexp_replace(upper(v.registration), '[[:space:]]', '', 'g')) >= 4
          and exists (
            select 1 from reserved k
            where position(regexp_replace(upper(v.registration), '[[:space:]]', '', 'g') in k.key) > 0
          ) then 2
        else null
      end as rank
    from ops.vans v
    where v.active
  ),
  best as (
    select id
    from ranked
    where rank is not null
      and rank = (select min(rank) from ranked where rank is not null)
  )
  select id from best where (select count(*) from best) = 1;
$$;

revoke all on function ops.install_default_van(uuid) from public, anon, authenticated;

create or replace function ops.cancel_install_prep(p_install uuid)
returns void
language plpgsql
security definer
set search_path = ops, public
as $$
begin
  update ops.install_prep_tasks
  set status = 'cancelled', updated_at = now()
  where install_id = p_install
    and status = 'open';
end;
$$;

revoke all on function ops.cancel_install_prep(uuid) from public, anon, authenticated;

create or replace function ops.sync_install_prep(p_install uuid)
returns void
language plpgsql
security definer
set search_path = ops, public
as $$
declare
  v_row ops.installs%rowtype;
  v_items jsonb := '[]'::jsonb;
  v_body text;
  v_people uuid[] := '{}';
  v_hq_due date;
  v_van_due date;
begin
  select * into v_row from ops.installs where id = p_install for update;
  if v_row.id is null then
    return;
  end if;
  if v_row.status in ('cancelled', 'quoting') then
    perform ops.cancel_install_prep(p_install);
    return;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'key', md5(lower(btrim(coalesce(item->>'productName', ''))) || '|' || ordinality::text),
    'name', coalesce(nullif(btrim(item->>'productName'), ''), 'Item'),
    'qty', case when coalesce(item->>'qty', '') ~ '^[0-9]+(\.[0-9]+)?$' then (item->>'qty')::numeric else 1 end,
    'sku', coalesce(
      nullif(btrim(item->>'sku'), ''),
      (
        select line->>'sku'
        from jsonb_array_elements(case when jsonb_typeof(v_row.lines) = 'array' then v_row.lines else '[]'::jsonb end) line
        where lower(btrim(coalesce(line->>'description', ''))) = lower(btrim(coalesce(item->>'productName', '')))
          and nullif(btrim(coalesce(line->>'sku', '')), '') is not null
        limit 1
      ),
      ''
    )
  ) order by ordinality), '[]'::jsonb)
  into v_items
  from jsonb_array_elements(
    case when jsonb_typeof(v_row.hq_build->'lines') = 'array' then v_row.hq_build->'lines' else '[]'::jsonb end
  ) with ordinality as listed(item, ordinality);

  select coalesce(array_agg(distinct r.profile_id), '{}')
  into v_people
  from ops.install_reservations ir
  join ops.resources r on r.id = ir.resource_id
  where ir.install_id = p_install
    and r.resource_type in ('installer', 'helper')
    and r.profile_id is not null;

  v_hq_due := ops.prep_due_on(v_row.start_on, 2);
  v_van_due := case
    when v_row.start_on is null then null
    when extract(isodow from v_row.start_on) < 6 then v_row.start_on
    else ops.prep_due_on(v_row.start_on, 1)
  end;

  if jsonb_array_length(v_items) = 0 then
    update ops.install_prep_tasks
    set status = 'cancelled', updated_at = now()
    where install_id = p_install and kind = 'hq_build' and status = 'open';
  else
    select string_agg(
      trim(to_char(coalesce(nullif(item->>'qty', '')::numeric, 1), 'FM999990.##'))
        || ' x '
        || coalesce(nullif(item->>'name', ''), 'Item'),
      E'\n' order by ordinality
    )
    into v_body
    from jsonb_array_elements(v_items) with ordinality as listed(item, ordinality);

    insert into ops.install_prep_tasks (install_id, kind, title, body, status, due_on, items)
    values (p_install, 'hq_build', 'HQ build and photograph', v_body, 'open', v_hq_due, v_items)
    on conflict (install_id, kind) do update
    set due_on = excluded.due_on,
        title = excluded.title,
        body = case when ops.install_prep_tasks.status = 'done' then ops.install_prep_tasks.body else excluded.body end,
        items = case when ops.install_prep_tasks.status = 'done' then ops.install_prep_tasks.items else excluded.items end,
        status = case when ops.install_prep_tasks.status = 'done' then 'done' else 'open' end,
        completed_at = case when ops.install_prep_tasks.status = 'done' then ops.install_prep_tasks.completed_at else null end,
        completed_by = case when ops.install_prep_tasks.status = 'done' then ops.install_prep_tasks.completed_by else null end,
        updated_at = now();
  end if;

  insert into ops.install_prep_tasks (install_id, kind, title, body, status, due_on, items)
  values (p_install, 'vehicle_check', 'Vehicle check', null, 'open', v_van_due, '[]'::jsonb)
  on conflict (install_id, kind) do update
  set due_on = excluded.due_on,
      title = excluded.title,
      status = case when ops.install_prep_tasks.status = 'done' then 'done' else 'open' end,
      completed_at = case when ops.install_prep_tasks.status = 'done' then ops.install_prep_tasks.completed_at else null end,
      completed_by = case when ops.install_prep_tasks.status = 'done' then ops.install_prep_tasks.completed_by else null end,
      updated_at = now();

  delete from ops.install_prep_assignees a
  using ops.install_prep_tasks t
  where a.task_id = t.id
    and t.install_id = p_install
    and t.status = 'open'
    and not (a.profile_id = any (v_people));

  insert into ops.install_prep_assignees (task_id, profile_id)
  select t.id, person_id
  from ops.install_prep_tasks t
  cross join unnest(v_people) as person_id
  where t.install_id = p_install
    and t.status = 'open'
  on conflict do nothing;
end;
$$;

revoke all on function ops.sync_install_prep(uuid) from public, anon, authenticated;

create or replace function ops.assert_visit_started(p_install uuid, p_token_hash text)
returns void
language plpgsql
security definer
set search_path = ops, public
as $$
begin
  if p_token_hash is not null then
    return;
  end if;
  if exists (select 1 from ops.installs where id = p_install and started_at is not null) then
    return;
  end if;
  if exists (select 1 from ops.risk_assessments where install_id = p_install)
     or exists (select 1 from ops.visit_sheets where install_id = p_install) then
    update ops.installs
    set started_at = coalesce(started_at, now())
    where id = p_install and started_at is null;
    return;
  end if;
  raise exception 'app: Start this job before saving.';
end;
$$;

revoke all on function ops.assert_visit_started(uuid, text) from public, anon, authenticated;

create or replace function ops.visit_payload(p_row ops.installs)
returns jsonb
language plpgsql
stable
security definer
set search_path = ops, public
as $$
declare
  v_today date := (timezone('Europe/London', now()))::date;
  v_started boolean;
begin
  v_started := p_row.started_at is not null
    or exists (select 1 from ops.risk_assessments r where r.install_id = p_row.id)
    or exists (select 1 from ops.visit_sheets s where s.install_id = p_row.id);
  return jsonb_build_object(
    'job', jsonb_build_object(
      'id', p_row.id,
      'orderNumber', p_row.order_number,
      'customerName', p_row.customer_name,
      'siteAddress', p_row.site_address,
      'contactName', p_row.contact_name,
      'contactPhone', p_row.contact_phone,
      'contactEmail', p_row.contact_email,
      'startOn', p_row.start_on,
      'endOn', p_row.end_on,
      'status', p_row.status,
      'startedAt', p_row.started_at
    ),
    'lines', ops.order_lines(p_row.lines),
    'risk', (
      select jsonb_build_object('answers', ra.answers, 'concernCount', coalesce(cardinality(ra.concern_file_ids), 0), 'completedAt', ra.completed_at)
      from ops.risk_assessments ra
      where ra.install_id = p_row.id
      order by ra.completed_at desc
      limit 1
    ),
    'submitted', exists (select 1 from ops.visit_sheets vs where vs.install_id = p_row.id and vs.submitted_at is not null),
    'started', v_started,
    'canStart', (not v_started)
      and p_row.status not in ('cancelled', 'completed')
      and ops.install_day_open(p_row.start_on, p_row.end_on, v_today),
    'access', ops.install_access_json(p_row.id),
    'hqBuild', coalesce(p_row.hq_build, '{}'::jsonb),
    'siteInstall', coalesce(p_row.site_install, '{}'::jsonb),
    'crew', p_row.crew,
    'prep', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', t.id,
        'kind', t.kind,
        'title', t.title,
        'body', t.body,
        'status', t.status,
        'dueOn', t.due_on,
        'items', t.items,
        'photos', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', f.id, 'itemKey', ph.item_key, 'bucket', f.bucket, 'path', f.storage_path
          ) order by ph.created_at)
          from ops.install_hq_photos ph
          join core.files f on f.id = ph.file_id
          where ph.task_id = t.id
        ), '[]'::jsonb)
      ) order by t.kind)
      from ops.install_prep_tasks t
      where t.install_id = p_row.id and t.status <> 'cancelled'
    ), '[]'::jsonb),
    'assignees', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id,
        'name', coalesce(nullif(btrim(p.full_name), ''), p.email)
      ) order by coalesce(nullif(btrim(p.full_name), ''), p.email))
      from (
        select distinct r.profile_id
        from ops.install_reservations ir
        join ops.resources r on r.id = ir.resource_id
        where ir.install_id = p_row.id
          and r.resource_type in ('installer', 'helper')
          and r.profile_id is not null
      ) people
      join public.profiles p on p.id = people.profile_id
    ), '[]'::jsonb),
    'vans', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', v.id, 'registration', v.registration, 'name', v.name
      ) order by v.registration)
      from ops.vans v
      where v.active
    ), '[]'::jsonb),
    'defaultVanId', ops.install_default_van(p_row.id),
    'vehicleCheck', (
      select jsonb_build_object(
        'submitted', true,
        'fitToDrive', c.fit_to_drive,
        'newDamage', c.new_damage,
        'damageNote', c.damage_note,
        'driverId', c.driver_id,
        'vanId', c.van_id
      )
      from ops.vehicle_checks c
      where c.install_id = p_row.id
    )
  );
end;
$$;

revoke all on function ops.visit_payload(ops.installs) from public, anon, authenticated;

-- Booking, moving, and cancelling keep the prep tasks in step.

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
    perform ops.sync_install_prep(v_existing.id);
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
  perform ops.sync_install_prep(v_install);
  return public.install_read(v_install);
end;
$$;

create or replace function public.install_move(p_id uuid, p_start date)
returns jsonb
language plpgsql
security definer
set search_path = ops, core, public
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
  perform public.install_claim_engineer();
  if ops.is_field_engineer() and not public.workspace_is_admin() then
    raise exception 'app: You cannot move that install.';
  end if;
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
  select coalesce(array_agg(day order by day), '{}') into v_days from ops.install_working_days(p_start, v_total, v_weekends) as day;
  if coalesce(array_length(v_days, 1), 0) < v_total or v_days[1] is distinct from p_start then
    raise exception 'app: Choose a weekday start date.';
  end if;
  delete from ops.install_reservations where install_id = v_row.id;
  v_requirements := coalesce(v_quote.payload->'requirements', '{}'::jsonb);
  v_ids := ops.pick_install_resources(
    v_days, v_row.crew,
    greatest(coalesce((v_requirements->>'licensedDrivers')::integer, 0), 0),
    v_row.van_size, v_row.van_count,
    coalesce((v_requirements->>'stairClimber')::boolean, false)
  );
  if v_ids is null then
    raise exception 'app: Those engineers or vans are no longer free. Choose another start date.';
  end if;
  v_end := v_days[array_length(v_days, 1)];
  v_resources := ops.hold_install_resources(v_row.id, v_ids, v_days);
  update ops.installs set start_on = p_start, end_on = v_end, resources = v_resources, updated_at = now() where id = v_row.id;
  update core.token_links
  set expires_at = (v_end::timestamp + time '23:59:59') at time zone 'UTC'
  where purpose = 'access_form'
    and entity_schema = 'ops'
    and entity_table = 'installs'
    and entity_id = v_row.id
    and revoked_at is null;
  perform ops.sync_install_prep(v_row.id);
  return public.install_read(v_row.id);
end;
$$;

create or replace function ops.finish_install_cancel(p_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ops, core, public
as $$
declare
  v_status text;
begin
  select status into v_status from ops.installs where id = p_id for update;
  if v_status is null then
    raise exception 'app: That install was not found.';
  end if;
  if v_status is distinct from 'cancelled' then
    if v_status = 'quoting' then
      update ops.install_quotes set install_id = null where install_id = p_id;
    end if;
    update ops.installs
    set status = 'cancelled', updated_at = now()
    where id = p_id;
    insert into core.audit_log (
      actor_id, module_id, entity_schema, entity_table, entity_id,
      action, field_name, old_value, new_value, details
    ) values (
      auth.uid(), 'operations', 'ops', 'installs', p_id,
      'cancel', 'status', to_jsonb(v_status), to_jsonb('cancelled'::text),
      jsonb_build_object('reason', p_reason)
    );
  end if;
  delete from ops.install_reservations where install_id = p_id;
  update core.token_links
  set revoked_at = coalesce(revoked_at, now())
  where entity_schema = 'ops'
    and entity_table = 'installs'
    and entity_id = p_id
    and purpose in ('access_form', 'subcontractor_job')
    and revoked_at is null;
  perform ops.cancel_install_prep(p_id);
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
  perform ops.sync_install_prep(v_row.id);
  return public.install_read(v_row.id);
end;
$$;

create or replace function public.install_save_visit_sheet(p_install uuid, p_sheet jsonb, p_token_hash text default null)
returns uuid
language plpgsql
security definer
set search_path = ops, core, public
as $$
declare
  v_id uuid;
  v_token_id uuid;
  v_user uuid;
  v_type text := coalesce(p_sheet->>'visitType', '');
  v_engineer uuid;
  v_customer uuid;
  v_pdf uuid;
begin
  if p_token_hash is not null then
    v_token_id := ops.assert_job_token(p_install, p_token_hash);
  else
    if not ops.visit_can(p_install) then
      raise exception 'app: You cannot save that job sheet.';
    end if;
    v_user := auth.uid();
  end if;
  perform ops.assert_visit_started(p_install, p_token_hash);
  if not exists (select 1 from ops.installs where id = p_install and status <> 'cancelled') then
    raise exception 'app: That job was not found.';
  end if;
  if exists (select 1 from ops.visit_sheets where install_id = p_install and submitted_at is not null) then
    raise exception 'app: This job sheet is already in.';
  end if;
  if v_type not in ('install', 'service') then
    raise exception 'app: Choose install or service.';
  end if;
  if nullif(btrim(coalesce(p_sheet->>'customerName', '')), '') is null then
    raise exception 'app: Add the customer name.';
  end if;
  if nullif(btrim(coalesce(p_sheet->>'engineerName', '')), '') is null then
    raise exception 'app: Add the engineer name.';
  end if;
  if nullif(btrim(coalesce(p_sheet->>'workCarriedOut', '')), '') is null then
    raise exception 'app: Add the work carried out.';
  end if;
  if nullif(p_sheet->>'engineerSignatureFileId', '') is null
     or nullif(p_sheet->>'customerSignatureFileId', '') is null then
    raise exception 'app: Both signatures are required.';
  end if;
  if nullif(p_sheet->>'pdfFileId', '') is null then
    raise exception 'app: The job sheet PDF is missing.';
  end if;
  v_engineer := nullif(p_sheet->>'engineerSignatureFileId', '')::uuid;
  v_customer := nullif(p_sheet->>'customerSignatureFileId', '')::uuid;
  v_pdf := nullif(p_sheet->>'pdfFileId', '')::uuid;
  if not (
    ops.install_file_ok(p_install, v_engineer, 'job-sheets', array['engineer_signature'])
    or (
      p_token_hash is null
      and exists (
        select 1
        from ops.staff_signatures s
        join core.files f on f.id = s.file_id
        where s.profile_id = auth.uid()
          and s.file_id = v_engineer
          and f.bucket = 'job-sheets'
      )
    )
  ) then
    raise exception 'app: That engineer signature is not on this job.';
  end if;
  if not ops.install_file_ok(p_install, v_customer, 'job-sheets', array['customer_signature']) then
    raise exception 'app: That customer signature is not on this job.';
  end if;
  if not ops.install_file_ok(p_install, v_pdf, 'job-sheets', array['visit_pack'])
     or not exists (select 1 from core.files f where f.id = v_pdf and f.mime_type = 'application/pdf') then
    raise exception 'app: The job sheet PDF is missing.';
  end if;

  insert into ops.visit_sheets (
    install_id, visit_type, contact_name, address, phone, order_no, job_no,
    service_contract, call_out_charge, time_on, time_off, overnight_stay, parking_fee,
    did_service, did_delivery, did_installation, did_warranty, work_carried_out,
    location_ok, fixing_wall, fixing_floor, work_ok, site_ok,
    engineer_name, vehicle_reg, customer_name,
    engineer_signature_file_id, customer_signature_file_id, pdf_file_id,
    completed_by, token_link_id, submitted_at, sheet_on, returned_on, ladder_check
  ) values (
    p_install, v_type,
    p_sheet->>'contactName', p_sheet->>'address', p_sheet->>'phone', p_sheet->>'orderNo', p_sheet->>'jobNo',
    nullif(p_sheet->>'serviceContract', '')::boolean,
    null,
    case when coalesce(p_sheet->>'timeOn', '') ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$' then (p_sheet->>'timeOn')::timestamptz else null end,
    case when coalesce(p_sheet->>'timeOff', '') ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$' then (p_sheet->>'timeOff')::timestamptz else null end,
    null,
    case when coalesce(p_sheet->>'parkingFee', '') ~ '^[0-9]+(\.[0-9]{1,2})?$' then (p_sheet->>'parkingFee')::numeric else null end,
    coalesce(nullif(p_sheet->>'service', '')::boolean, false),
    coalesce(nullif(p_sheet->>'delivery', '')::boolean, false),
    coalesce(nullif(p_sheet->>'installation', '')::boolean, false),
    coalesce(nullif(p_sheet->>'warranty', '')::boolean, false),
    p_sheet->>'workCarriedOut',
    nullif(p_sheet->>'locationOk', '')::boolean,
    null,
    null,
    nullif(p_sheet->>'workOk', '')::boolean,
    nullif(p_sheet->>'siteOk', '')::boolean,
    p_sheet->>'engineerName', p_sheet->>'vehicleReg', p_sheet->>'customerName',
    v_engineer, v_customer, v_pdf,
    v_user, v_token_id, now(),
    case when coalesce(p_sheet->>'sheetOn', '') ~ '^\d{4}-\d{2}-\d{2}$' then (p_sheet->>'sheetOn')::date else null end,
    case when coalesce(p_sheet->>'returnedOn', '') ~ '^\d{4}-\d{2}-\d{2}$' then (p_sheet->>'returnedOn')::date else null end,
    null
  )
  returning id into v_id;

  insert into ops.visit_sheet_lines (visit_sheet_id, position, code, description, reported_job, qty)
  select v_id, ordinality::integer, item->>'code', item->>'description', item->>'reportedJob',
    case when coalesce(item->>'qty', '') ~ '^[0-9]+(\.[0-9]{1,2})?$' and (item->>'qty')::numeric > 0 then (item->>'qty')::numeric else null end
  from jsonb_array_elements(coalesce(p_sheet->'lines', '[]'::jsonb)) with ordinality as listed(item, ordinality);

  insert into ops.visit_sheet_parts (visit_sheet_id, position, code, description, qty)
  select v_id, ordinality::integer, item->>'code', item->>'description',
    case when coalesce(item->>'qty', '') ~ '^[0-9]+(\.[0-9]{1,2})?$' and (item->>'qty')::numeric > 0 then (item->>'qty')::numeric else 1 end
  from jsonb_array_elements(coalesce(p_sheet->'parts', '[]'::jsonb)) with ordinality as listed(item, ordinality);
  return v_id;
end;
$$;

create or replace function public.install_save_visit_risk(p_install uuid, p_answers jsonb, p_concern_file_ids uuid[], p_token_hash text default null)
returns uuid
language plpgsql
security definer
set search_path = ops, public
as $$
declare
  v_id uuid;
  v_answers jsonb := coalesce(p_answers, '{}'::jsonb);
  v_key text;
begin
  if p_token_hash is not null then
    perform ops.assert_job_token(p_install, p_token_hash);
  elsif not ops.visit_can(p_install) then
    raise exception 'app: You cannot save that risk assessment.';
  end if;
  perform ops.assert_visit_started(p_install, p_token_hash);
  if not exists (select 1 from ops.installs where id = p_install and status <> 'cancelled') then
    raise exception 'app: That job was not found.';
  end if;
  if exists (select 1 from ops.visit_sheets where install_id = p_install and submitted_at is not null) then
    raise exception 'app: This job sheet is already in.';
  end if;
  if jsonb_typeof(v_answers) <> 'object' then
    raise exception 'app: The risk assessment could not be read.';
  end if;
  foreach v_key in array ARRAY['accessClear', 'floorSuitable', 'powerSafe', 'handlingPlanned', 'peopleBriefed']
  loop
    if coalesce(v_answers->>v_key, '') not in ('true', 'false') then
      raise exception 'app: Answer every check.';
    end if;
  end loop;
  if exists (
    select 1 from unnest(coalesce(p_concern_file_ids, '{}')) as fid
    where not ops.install_file_ok(p_install, fid, 'job-sheets', array['concern'])
  ) then
    raise exception 'app: That photo is not on this job.';
  end if;
  insert into ops.risk_assessments (install_id, answers, concern_file_ids, completed_by)
  values (p_install, v_answers, coalesce(p_concern_file_ids, '{}'), case when p_token_hash is null then auth.uid() else null end)
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.install_visit_upload_gate(p_install uuid, p_token_hash text, p_kind text)
returns void
language plpgsql
security definer
set search_path = ops, core, public
as $$
begin
  if p_kind is null or p_kind not in ('concern', 'equipment', 'hq_photo', 'vehicle_damage') then
    raise exception 'app: That photo is not allowed.';
  end if;
  if p_kind in ('hq_photo', 'vehicle_damage') then
    if p_token_hash is not null then
      raise exception 'app: That photo is not allowed.';
    end if;
    if not ops.visit_can(p_install) then
      raise exception 'app: You cannot open that job.';
    end if;
    if not exists (select 1 from ops.installs where id = p_install and status <> 'cancelled') then
      raise exception 'app: That job was not found.';
    end if;
    return;
  end if;
  if p_token_hash is not null then
    perform ops.assert_job_token(p_install, p_token_hash);
  elsif not ops.visit_can(p_install) then
    raise exception 'app: You cannot open that job.';
  end if;
  if exists (select 1 from ops.visit_sheets where install_id = p_install and submitted_at is not null) then
    raise exception 'app: This job sheet is already in.';
  end if;
  if (
    select count(*)
    from core.files f
    where f.entity_id = p_install
      and f.bucket = 'job-sheets'
      and f.kind in ('concern', 'equipment')
  ) >= 40 then
    raise exception 'app: That job already has enough photos.';
  end if;
end;
$$;

create or replace function public.install_visit_photos(p_install uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ops, core, public
as $$
begin
  if ops.is_field_engineer() then
    raise exception 'app: Field engineers cannot do that.';
  end if;
  if not (
    public.workspace_can('sales', 'view')
    or public.workspace_can('operations', 'view')
    or public.workspace_is_admin()
  ) then
    raise exception 'app: You cannot see that install.';
  end if;
  if not exists (select 1 from ops.installs where id = p_install) then
    raise exception 'app: That install was not found.';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', listed.id,
      'kind', listed.kind,
      'bucket', listed.bucket,
      'path', listed.storage_path,
      'createdAt', listed.created_at
    ) order by listed.created_at, listed.id)
    from (
      select f.id, f.kind, f.bucket, f.storage_path, f.created_at
      from core.files f
      where f.bucket = 'job-sheets'
        and f.kind in ('concern', 'equipment', 'hq_photo', 'vehicle_damage')
        and (
          f.entity_id = p_install
          or f.id in (select photo.file_id from ops.install_equipment_photos photo where photo.install_id = p_install)
          or f.id in (
            select unnest(risk.concern_file_ids)
            from ops.risk_assessments risk
            where risk.install_id = p_install
          )
          or f.id in (select photo.file_id from ops.install_hq_photos photo where photo.install_id = p_install)
          or f.id in (
            select link.file_id
            from ops.vehicle_check_files link
            join ops.vehicle_checks check_row on check_row.id = link.check_id
            where check_row.install_id = p_install
          )
        )
    ) listed
  ), '[]'::jsonb);
end;
$$;

create or replace function public.orbit_list_tasks()
returns jsonb
language plpgsql
stable
security definer
set search_path = core, public
as $$
declare
  v_rows jsonb;
begin
  if auth.uid() is null then
    raise exception 'app: You need to be signed in.';
  end if;

  select coalesce(jsonb_agg(row_data order by created_at desc), '[]'::jsonb)
  into v_rows
  from (
    select
      jsonb_build_object(
        'id', t.id,
        'module_id', t.module_id,
        'kind', t.kind,
        'title', t.title,
        'body', t.body,
        'status', t.status,
        'priority', t.priority,
        'due_at', t.due_at,
        'entity_schema', t.entity_schema,
        'entity_table', t.entity_table,
        'entity_id', t.entity_id,
        'assignee_id', t.assignee_id,
        'created_by', t.created_by,
        'created_at', t.created_at,
        'completed_at', t.completed_at
      ) as row_data,
      t.created_at
    from core.tasks t
    where t.assignee_id = auth.uid()
       or t.created_by = auth.uid()
       or core.has_ops_role(array['install_lead', 'admin_owner'])
    order by t.created_at desc
    limit 200
  ) listed;

  v_rows := coalesce(v_rows, '[]'::jsonb) || coalesce((
    select jsonb_agg(row_data order by due_on nulls last, created_at desc)
    from (
      select
        jsonb_build_object(
          'id', t.id,
          'module_id', 'operations',
          'kind', t.kind,
          'title', t.title,
          'body', t.body,
          'status', t.status,
          'priority', 'normal',
          'due_at', case when t.due_on is null then null else (t.due_on::timestamp + time '17:00') at time zone 'Europe/London' end,
          'entity_schema', 'ops',
          'entity_table', 'installs',
          'entity_id', t.install_id,
          'assignee_id', a.profile_id,
          'created_by', null,
          'created_at', t.created_at,
          'completed_at', t.completed_at
        ) as row_data,
        t.due_on,
        t.created_at
      from ops.install_prep_tasks t
      left join ops.install_prep_assignees a on a.task_id = t.id
      where t.status <> 'cancelled'
        and (
          a.profile_id = auth.uid()
          or (
            not ops.is_field_engineer()
            and (
              public.workspace_is_admin()
              or public.workspace_can('operations', 'view')
              or core.has_ops_role(array['install_lead', 'admin_owner'])
            )
          )
        )
    ) prep
  ), '[]'::jsonb);

  return v_rows;
end;
$$;

create or replace function public.ops_pulse()
returns jsonb
language plpgsql
stable
security definer
set search_path = ops, core, public
as $$
declare
  v_today date := (timezone('Europe/London', now()))::date;
  v_week_start date := v_today - (extract(isodow from v_today)::integer - 1);
  v_week_end date := v_week_start + 4;
  v_soon date := v_today + 30;
begin
  if ops.is_field_engineer() and not public.workspace_is_admin() then
    raise exception 'app: You cannot see the office.';
  end if;
  if not (public.workspace_can('operations', 'view') or public.workspace_is_admin()) then
    raise exception 'app: You cannot see the office.';
  end if;

  return jsonb_build_object(
    'today', v_today,
    'weekStart', v_week_start,
    'weekEnd', v_week_end,
    'installsToday', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', i.id, 'orderNumber', i.order_number, 'customerName', i.customer_name, 'startOn', i.start_on
      ) order by i.order_number)
      from ops.installs i
      where i.archived_at is null and i.status not in ('cancelled', 'completed')
        and i.start_on is not null and i.end_on is not null
        and i.start_on <= v_today and i.end_on >= v_today
    ), '[]'::jsonb),
    'installsWeek', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', i.id, 'orderNumber', i.order_number, 'customerName', i.customer_name, 'startOn', i.start_on
      ) order by i.start_on, i.order_number)
      from ops.installs i
      where i.archived_at is null and i.status not in ('cancelled', 'completed')
        and i.start_on is not null and i.end_on is not null
        and i.start_on <= v_week_end and i.end_on >= v_week_start
    ), '[]'::jsonb),
    'servicesToday', coalesce((
      select jsonb_agg(item order by item->>'orderNumber')
      from (
        select jsonb_build_object(
          'id', i.id, 'kind', 'install', 'orderNumber', i.order_number, 'customerName', i.customer_name, 'startOn', i.start_on
        ) as item
        from ops.visit_sheets s
        join ops.installs i on i.id = s.install_id
        where s.visit_type = 'service'
          and i.status <> 'cancelled'
          and i.start_on is not null and i.end_on is not null
          and i.start_on <= v_today and i.end_on >= v_today
        union all
        select jsonb_build_object(
          'id', j.id, 'kind', 'job', 'orderNumber', coalesce(j.cin7_order_number, j.cin7_number, 'Service'),
          'customerName', c.name, 'startOn', j.booked_date
        )
        from ops.install_jobs j
        join ops.customers c on c.id = j.customer_id
        where j.job_type = 'service' and j.booked_date = v_today
      ) listed
    ), '[]'::jsonb),
    'servicesWeek', coalesce((
      select jsonb_agg(item order by item->>'startOn', item->>'orderNumber')
      from (
        select jsonb_build_object(
          'id', i.id, 'kind', 'install', 'orderNumber', i.order_number, 'customerName', i.customer_name, 'startOn', i.start_on
        ) as item
        from ops.visit_sheets s
        join ops.installs i on i.id = s.install_id
        where s.visit_type = 'service'
          and i.status <> 'cancelled'
          and i.start_on is not null and i.end_on is not null
          and i.start_on <= v_week_end and i.end_on >= v_week_start
        union all
        select jsonb_build_object(
          'id', j.id, 'kind', 'job', 'orderNumber', coalesce(j.cin7_order_number, j.cin7_number, 'Service'),
          'customerName', c.name, 'startOn', j.booked_date
        )
        from ops.install_jobs j
        join ops.customers c on c.id = j.customer_id
        where j.job_type = 'service'
          and j.booked_date between v_week_start and v_week_end
      ) listed
    ), '[]'::jsonb),
    'off', coalesce((
      select jsonb_agg(jsonb_build_object('name', name, 'label', label, 'startsOn', starts_on, 'endsOn', ends_on) order by name)
      from (
        select r.name, u.reason as label, u.starts_on, u.ends_on
        from ops.unavailability u
        join ops.resources r on r.id = u.resource_id
        where u.ends_on >= v_week_start and u.starts_on <= v_week_end
        union all
        select coalesce(p.full_name, p.email, 'Someone'), e.entry_type, e.starts_on, e.ends_on
        from public.calendar_entries e
        left join public.profiles p on p.id = e.profile_id
        where e.request_status = 'confirmed'
          and e.entry_type in ('annual_leave', 'sick', 'other_absence')
          and e.ends_on >= v_week_start and e.starts_on <= v_week_end
      ) away
    ), '[]'::jsonb),
    'vansOut', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', i.id, 'registration', v.registration, 'orderNumber', i.order_number
      ) order by v.registration)
      from ops.visit_sheets s
      join ops.installs i on i.id = s.install_id
      join ops.vans v
        on v.active
       and regexp_replace(upper(v.registration), '[[:space:]]', '', 'g')
         = regexp_replace(upper(s.vehicle_reg), '[[:space:]]', '', 'g')
      where i.status <> 'cancelled'
        and i.start_on is not null and i.end_on is not null
        and i.start_on <= v_week_end and i.end_on >= v_week_start
    ), '[]'::jsonb),
    'overdue', coalesce((
      select jsonb_agg(item order by item->>'dueAt')
      from (
        select jsonb_build_object(
          'id', t.id, 'title', t.title, 'dueAt', t.due_at, 'assigneeId', t.assignee_id,
          'assignee', coalesce(p.full_name, p.email)
        ) as item
        from core.tasks t
        left join public.profiles p on p.id = t.assignee_id
        where t.status in ('open', 'in_progress')
          and t.due_at is not null
          and t.due_at < timezone('Europe/London', now())
        union all
        select jsonb_build_object(
          'id', t.id,
          'title', t.title,
          'dueAt', (t.due_on::timestamp + time '17:00') at time zone 'Europe/London',
          'assigneeId', null,
          'assignee', (
            select string_agg(coalesce(nullif(btrim(p.full_name), ''), p.email), ', ' order by coalesce(nullif(btrim(p.full_name), ''), p.email))
            from ops.install_prep_assignees a
            join public.profiles p on p.id = a.profile_id
            where a.task_id = t.id
          )
        )
        from ops.install_prep_tasks t
        where t.status = 'open'
          and t.due_on is not null
          and (t.due_on::timestamp + time '17:00') at time zone 'Europe/London' < timezone('Europe/London', now())
      ) listed
    ), '[]'::jsonb),
    'warnings', coalesce((
      select jsonb_agg(item order by item->>'label')
      from (
        select jsonb_build_object(
          'label', s.name, 'detail', 'Insurance ' || doc.expires_on, 'href', '/operations/subcontractors/' || s.id
        ) as item
        from ops.subcontractors s
        join lateral (
          select expires_on from (
            select s.insurance_expires_on as expires_on
            union all
            select max(doc.expires_on) from ops.subcontractor_insurance doc where doc.subcontractor_id = s.id
          ) dates
          where expires_on is not null
          order by expires_on desc
          limit 1
        ) doc on true
        where s.status <> 'inactive' and doc.expires_on <= v_soon
        union all
        select jsonb_build_object(
          'label', v.registration,
          'detail', part.kind || ' ' || part.due_on,
          'href', '/operations/fleet'
        )
        from ops.vans v
        cross join lateral (
          values ('MOT', v.mot_due), ('Tax', v.tax_due), ('Insurance', v.insurance_due), ('Service', v.service_due)
        ) as part(kind, due_on)
        where v.active and part.due_on is not null and part.due_on <= v_soon
        union all
        select jsonb_build_object(
          'label', v.registration,
          'detail', case f.reason
            when 'damage' then 'New damage' || case when coalesce(btrim(f.note), '') = '' then '' else '. ' || f.note end
            else 'Not fit to drive'
          end,
          'href', '/operations/fleet'
        )
        from ops.vehicle_flags f
        join ops.vans v on v.id = f.van_id
        where f.status = 'open'
      ) listed
    ), '[]'::jsonb)
  );
end;
$$;


create or replace function public.install_start_job(p_install uuid)
returns jsonb
language plpgsql
security definer
set search_path = ops, public
as $$
declare
  v_row ops.installs%rowtype;
  v_today date := (timezone('Europe/London', now()))::date;
  v_started timestamptz;
  v_status text;
begin
  if auth.uid() is null then
    raise exception 'app: You need to be signed in.';
  end if;
  if not ops.visit_can(p_install) then
    raise exception 'app: You cannot start that job.';
  end if;
  select * into v_row from ops.installs where id = p_install for update;
  if v_row.id is null or v_row.status = 'cancelled' then
    raise exception 'app: That job was not found.';
  end if;
  if v_row.started_at is not null then
    return jsonb_build_object('startedAt', v_row.started_at, 'status', v_row.status);
  end if;
  if not ops.install_day_open(v_row.start_on, v_row.end_on, v_today) then
    raise exception 'app: Start this job on an install day.';
  end if;
  update ops.installs
  set started_at = now(),
      status = case when status in ('booked', 'scheduled') then 'in_progress' else status end,
      updated_at = now()
  where id = p_install
  returning started_at, status into v_started, v_status;
  return jsonb_build_object('startedAt', v_started, 'status', v_status);
end;
$$;

create or replace function public.install_save_hq_photo(p_install uuid, p_item_key text, p_file uuid)
returns jsonb
language plpgsql
security definer
set search_path = ops, public
as $$
declare
  v_task ops.install_prep_tasks%rowtype;
  v_done boolean := false;
begin
  if auth.uid() is null then
    raise exception 'app: You need to be signed in.';
  end if;
  if not ops.visit_can(p_install) then
    raise exception 'app: You cannot add that photo.';
  end if;
  if nullif(btrim(coalesce(p_item_key, '')), '') is null then
    raise exception 'app: That item is not on this build.';
  end if;
  if not ops.install_file_ok(p_install, p_file, 'job-sheets', array['hq_photo']) then
    raise exception 'app: That photo is not on this job.';
  end if;
  select * into v_task
  from ops.install_prep_tasks
  where install_id = p_install and kind = 'hq_build' and status <> 'cancelled'
  for update;
  if v_task.id is null then
    raise exception 'app: That build task was not found.';
  end if;
  if not exists (
    select 1 from jsonb_array_elements(v_task.items) item
    where item->>'key' = p_item_key
  ) then
    raise exception 'app: That item is not on this build.';
  end if;
  insert into ops.install_hq_photos (task_id, install_id, item_key, file_id, created_by)
  values (v_task.id, p_install, p_item_key, p_file, auth.uid())
  on conflict (task_id, file_id) do nothing;
  if v_task.status = 'open' and not exists (
    select 1
    from jsonb_array_elements(v_task.items) item
    where not exists (
      select 1 from ops.install_hq_photos ph
      where ph.task_id = v_task.id and ph.item_key = item->>'key'
    )
  ) then
    update ops.install_prep_tasks
    set status = 'done', completed_at = now(), completed_by = auth.uid(), updated_at = now()
    where id = v_task.id and status = 'open';
    v_done := true;
  end if;
  return jsonb_build_object('done', v_done or v_task.status = 'done');
end;
$$;

create or replace function public.install_submit_vehicle_check(p_install uuid, p_payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = ops, public
as $$
declare
  v_task ops.install_prep_tasks%rowtype;
  v_driver uuid;
  v_van uuid;
  v_lights boolean;
  v_indicators boolean;
  v_mirrors boolean;
  v_brakes boolean;
  v_fueled boolean;
  v_pressure numeric;
  v_tread numeric;
  v_warnings boolean;
  v_damage boolean;
  v_fit boolean;
  v_note text;
  v_files uuid[] := '{}';
  v_file uuid;
  v_check uuid;
begin
  if auth.uid() is null then
    raise exception 'app: You need to be signed in.';
  end if;
  if not ops.visit_can(p_install) then
    raise exception 'app: You cannot complete that vehicle check.';
  end if;
  if not exists (select 1 from ops.installs where id = p_install and status <> 'cancelled') then
    raise exception 'app: That job was not found.';
  end if;
  select * into v_task
  from ops.install_prep_tasks
  where install_id = p_install and kind = 'vehicle_check' and status = 'open'
  for update;
  if v_task.id is null then
    raise exception 'app: That vehicle check is already in.';
  end if;
  if coalesce(p_payload->>'driverId', '') !~ '^[0-9a-f-]{36}$' then
    raise exception 'app: Choose the driver.';
  end if;
  if coalesce(p_payload->>'vanId', '') !~ '^[0-9a-f-]{36}$' then
    raise exception 'app: Choose the vehicle.';
  end if;
  v_driver := (p_payload->>'driverId')::uuid;
  v_van := (p_payload->>'vanId')::uuid;
  if not exists (
    select 1
    from ops.resources r
    where r.profile_id = v_driver
      and r.resource_type in ('installer', 'helper')
      and r.status = 'active'
      and (
        exists (
          select 1 from ops.install_reservations ir
          where ir.install_id = p_install and ir.resource_id = r.id
        )
        or exists (
          select 1
          from ops.installs i
          cross join lateral jsonb_array_elements(case when jsonb_typeof(i.resources) = 'array' then i.resources else '[]'::jsonb end) elem
          where i.id = p_install and elem->>'id' = r.id::text
        )
      )
  ) then
    raise exception 'app: Choose a driver from this job.';
  end if;
  if not exists (select 1 from ops.vans where id = v_van and active) then
    raise exception 'app: Choose a vehicle from the fleet.';
  end if;
  if jsonb_typeof(p_payload->'lights') <> 'boolean'
     or jsonb_typeof(p_payload->'indicators') <> 'boolean'
     or jsonb_typeof(p_payload->'mirrors') <> 'boolean'
     or jsonb_typeof(p_payload->'brakes') <> 'boolean'
     or jsonb_typeof(p_payload->'fueled') <> 'boolean'
     or jsonb_typeof(p_payload->'noWarningLights') <> 'boolean' then
    raise exception 'app: Answer every check.';
  end if;
  v_lights := (p_payload->>'lights')::boolean;
  v_indicators := (p_payload->>'indicators')::boolean;
  v_mirrors := (p_payload->>'mirrors')::boolean;
  v_brakes := (p_payload->>'brakes')::boolean;
  v_fueled := (p_payload->>'fueled')::boolean;
  v_warnings := (p_payload->>'noWarningLights')::boolean;
  if jsonb_typeof(p_payload->'tyrePressure') <> 'number' then
    raise exception 'app: Enter the tyre pressure.';
  end if;
  if jsonb_typeof(p_payload->'treadDepth') <> 'number' then
    raise exception 'app: Enter the tread depth.';
  end if;
  v_pressure := (p_payload->>'tyrePressure')::numeric;
  v_tread := (p_payload->>'treadDepth')::numeric;
  if v_pressure < 0 or v_pressure > 200 then
    raise exception 'app: Enter the tyre pressure.';
  end if;
  if v_tread < 0 or v_tread > 30 then
    raise exception 'app: Enter the tread depth.';
  end if;
  if jsonb_typeof(p_payload->'newDamage') <> 'boolean' then
    raise exception 'app: Say whether there is new exterior damage.';
  end if;
  if jsonb_typeof(p_payload->'fitToDrive') <> 'boolean' then
    raise exception 'app: Say whether the vehicle is fit to drive.';
  end if;
  v_damage := (p_payload->>'newDamage')::boolean;
  v_fit := (p_payload->>'fitToDrive')::boolean;
  v_note := nullif(btrim(coalesce(p_payload->>'damageNote', '')), '');
  if jsonb_typeof(p_payload->'confirmed') <> 'boolean' or (p_payload->>'confirmed')::boolean is not true then
    raise exception 'app: Confirm the checks have been carried out.';
  end if;
  if v_damage and v_note is null then
    raise exception 'app: Describe the new damage.';
  end if;
  if v_damage and char_length(v_note) > 2000 then
    raise exception 'app: Shorten the damage note.';
  end if;
  if jsonb_typeof(p_payload->'damageFileIds') = 'array' then
    select coalesce(array_agg(distinct value::uuid), '{}')
    into v_files
    from jsonb_array_elements_text(p_payload->'damageFileIds') as listed(value)
    where value ~ '^[0-9a-f-]{36}$';
  end if;
  if v_damage and coalesce(array_length(v_files, 1), 0) < 1 then
    raise exception 'app: Add a photo of the new damage.';
  end if;
  if not v_damage then
    v_note := null;
    v_files := '{}';
  end if;
  foreach v_file in array v_files loop
    if not ops.install_file_ok(p_install, v_file, 'job-sheets', array['vehicle_damage']) then
      raise exception 'app: That photo is not on this job.';
    end if;
  end loop;

  insert into ops.vehicle_checks (
    install_id, task_id, driver_id, van_id,
    lights, indicators, mirrors, brakes, fueled,
    tyre_pressure, tread_depth, no_warning_lights,
    new_damage, damage_note, fit_to_drive, confirmed, submitted_by
  ) values (
    p_install, v_task.id, v_driver, v_van,
    v_lights, v_indicators, v_mirrors, v_brakes, v_fueled,
    v_pressure, v_tread, v_warnings,
    v_damage, v_note, v_fit, true, auth.uid()
  )
  returning id into v_check;

  insert into ops.vehicle_check_files (check_id, file_id)
  select v_check, file_id from unnest(v_files) as file_id;

  if v_damage then
    insert into ops.vehicle_flags (install_id, van_id, check_id, reason, note)
    values (p_install, v_van, v_check, 'damage', v_note);
  end if;
  if not v_fit then
    insert into ops.vehicle_flags (install_id, van_id, check_id, reason, note)
    values (p_install, v_van, v_check, 'unfit', 'Not fit to drive.');
  end if;

  update ops.install_prep_tasks
  set status = 'done', completed_at = now(), completed_by = auth.uid(), updated_at = now()
  where id = v_task.id and status = 'open';
  return v_check;
end;
$$;

create or replace function public.install_list_vehicle_flags()
returns jsonb
language plpgsql
stable
security definer
set search_path = ops, core, public
as $$
begin
  if ops.is_field_engineer() then
    raise exception 'app: You cannot see vehicle flags.';
  end if;
  if not (public.workspace_is_admin() or public.workspace_can('operations', 'view')) then
    raise exception 'app: You cannot see vehicle flags.';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', f.id,
      'installId', f.install_id,
      'orderNumber', i.order_number,
      'vanId', f.van_id,
      'registration', v.registration,
      'reason', f.reason,
      'note', f.note,
      'status', f.status,
      'createdAt', f.created_at,
      'photos', case when f.reason = 'damage' then coalesce((
        select jsonb_agg(jsonb_build_object('id', file.id, 'bucket', file.bucket, 'path', file.storage_path) order by file.created_at)
        from ops.vehicle_check_files link
        join core.files file on file.id = link.file_id
        where link.check_id = f.check_id
      ), '[]'::jsonb) else '[]'::jsonb end
    ) order by f.status, f.created_at desc)
    from ops.vehicle_flags f
    join ops.vans v on v.id = f.van_id
    join ops.installs i on i.id = f.install_id
  ), '[]'::jsonb);
end;
$$;

create or replace function public.install_resolve_vehicle_flag(p_flag uuid)
returns void
language plpgsql
security definer
set search_path = ops, public
as $$
begin
  if ops.is_field_engineer() then
    raise exception 'app: You cannot resolve that flag.';
  end if;
  if not (public.workspace_is_admin() or public.workspace_can('operations', 'edit')) then
    raise exception 'app: You cannot resolve that flag.';
  end if;
  update ops.vehicle_flags
  set status = 'resolved', resolved_at = now(), resolved_by = auth.uid()
  where id = p_flag and status = 'open';
  if not found then
    raise exception 'app: That flag was not found.';
  end if;
end;
$$;

revoke all on function public.install_start_job(uuid) from public, anon;
revoke all on function public.install_save_hq_photo(uuid, text, uuid) from public, anon;
revoke all on function public.install_submit_vehicle_check(uuid, jsonb) from public, anon;
revoke all on function public.install_list_vehicle_flags() from public, anon;
revoke all on function public.install_resolve_vehicle_flag(uuid) from public, anon;
grant execute on function public.install_start_job(uuid) to authenticated, service_role;
grant execute on function public.install_save_hq_photo(uuid, text, uuid) to authenticated, service_role;
grant execute on function public.install_submit_vehicle_check(uuid, jsonb) to authenticated, service_role;
grant execute on function public.install_list_vehicle_flags() to authenticated, service_role;
grant execute on function public.install_resolve_vehicle_flag(uuid) to authenticated, service_role;

do $$
declare
  v_id uuid;
begin
  for v_id in
    select id from ops.installs where status in ('booked', 'scheduled', 'in_progress')
  loop
    perform ops.sync_install_prep(v_id);
  end loop;
end;
$$;
