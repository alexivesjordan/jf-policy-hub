-- Jordan Pulse service routes and maintenance plans.
-- ADDITIVE. Includes one ALTER TABLE on svc.visits:
--   add column maintenance_plan_id uuid null (no backfill, no rewrite of existing rows).
-- Creating a plan from a past install is a separate explicit action. Nothing here inserts plans.
-- New file only. Do not apply to production.

create table svc.maintenance_plans (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references svc.sites (id) on delete restrict,
  install_id uuid unique references ops.installs (id) on delete set null,
  order_number text,
  cadence_months integer not null,
  starts_on date not null,
  next_due_on date not null,
  ends_on date,
  status text not null default 'active',
  last_completed_visit_id uuid references svc.visits (id) on delete set null,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (cadence_months in (6, 12)),
  check (status in ('active', 'paused', 'ended')),
  check (order_number is null or char_length(btrim(order_number)) between 1 and 80),
  check (starts_on >= date '2000-01-01' and starts_on <= date '2100-01-01'),
  check (next_due_on >= starts_on and next_due_on <= date '2100-12-31'),
  check (ends_on is null or (ends_on >= starts_on and ends_on <= date '2100-12-31'))
);

comment on table svc.maintenance_plans is
  'Proactive maintenance sold with an install. next_due_on moves forward when its visit is completed.';

comment on column svc.maintenance_plans.last_completed_visit_id is
  'The visit that last moved next_due_on. A retried job sheet for the same visit does not move the date again.';

create index maintenance_plans_site_idx on svc.maintenance_plans (site_id);
create index maintenance_plans_due_idx on svc.maintenance_plans (next_due_on) where status = 'active';
create index maintenance_plans_last_visit_idx
  on svc.maintenance_plans (last_completed_visit_id)
  where last_completed_visit_id is not null;

create trigger maintenance_plans_touch_updated_at
before update on svc.maintenance_plans
for each row execute function public.touch_updated_at();

-- ADDITIVE column on svc.visits. Nullable. Existing visits stay valid.
alter table svc.visits
  add column maintenance_plan_id uuid references svc.maintenance_plans (id) on delete restrict;

comment on column svc.visits.maintenance_plan_id is
  'Set when the visit was opened from a maintenance plan. Null on every other visit.';

create index visits_maintenance_plan_idx
  on svc.visits (maintenance_plan_id)
  where maintenance_plan_id is not null;

alter table svc.maintenance_plans enable row level security;

revoke all on svc.maintenance_plans from public, anon, authenticated;
grant all on svc.maintenance_plans to service_role;

create policy maintenance_plans_select on svc.maintenance_plans
  for select to authenticated
  using ((select svc.office('view')));

create policy maintenance_plans_write on svc.maintenance_plans
  for all to authenticated
  using ((select svc.office('edit')))
  with check ((select svc.office('edit')));

create or replace function svc.add_months(p_day date, p_months integer)
returns date
language sql
immutable
set search_path = ''
as $$
  select (p_day + make_interval(months => p_months))::date;
$$;

revoke all on function svc.add_months(date, integer) from public, anon, authenticated;

create or replace function svc.split_site_address(p_address text)
returns table (line1 text, city text, postcode text)
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_text text := btrim(coalesce(p_address, ''));
  v_compact text;
  v_postcode text;
  v_rest text;
  v_parts text[];
begin
  v_compact := upper(regexp_replace(v_text, '[[:space:]]', '', 'g'));
  if v_compact ~ '[A-Z]{1,2}[0-9][A-Z0-9]?[0-9][A-Z]{2}$' then
    v_postcode := substring(v_compact from '([A-Z]{1,2}[0-9][A-Z0-9]?[0-9][A-Z]{2})$');
    v_postcode := regexp_replace(v_postcode, '([0-9][A-Z]{2})$', ' \1');
    v_rest := btrim(regexp_replace(
      v_text,
      '[A-Za-z]{1,2}[0-9][A-Za-z0-9]?[[:space:]]*[0-9][A-Za-z]{2}[[:space:]]*$',
      ''
    ));
    v_rest := btrim(v_rest, ',');
  end if;
  if v_postcode is null then
    line1 := null;
    city := null;
    postcode := null;
    return next;
    return;
  end if;
  if coalesce(v_rest, '') = '' then
    line1 := 'Site';
    city := null;
    postcode := v_postcode;
    return next;
    return;
  end if;
  v_parts := regexp_split_to_array(v_rest, '[[:space:]]*,[[:space:]]*');
  if cardinality(v_parts) >= 2 then
    city := nullif(left(btrim(v_parts[cardinality(v_parts)]), 80), '');
    line1 := nullif(left(btrim(array_to_string(v_parts[1:cardinality(v_parts) - 1], ', ')), 160), '');
  else
    line1 := nullif(left(btrim(v_rest), 160), '');
    city := null;
  end if;
  if line1 is null then
    line1 := 'Site';
  end if;
  postcode := v_postcode;
  return next;
end;
$$;

revoke all on function svc.split_site_address(text) from public, anon, authenticated;

create or replace function svc.plan_cadence(p_warranty text)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case p_warranty
    when 'twice_yearly' then 6
    when 'twice_yearly_bundle' then 6
    when 'annual' then 12
    when 'annual_bundle' then 12
    else null
  end;
$$;

revoke all on function svc.plan_cadence(text) from public, anon, authenticated;

-- Keeps the overlap warning from 20261128510000 and can attach one active plan.
create or replace function public.service_visit_save(p_id uuid, p_payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = svc, public
as $$
declare
  v_id uuid;
  v_warning text;
  v_plan uuid;
  v_plan_status text;
  v_plan_site uuid;
  v_site uuid;
begin
  if not svc.office('edit') then
    raise exception 'app: You cannot change service visits.';
  end if;
  v_id := public.service_visit_save_body(p_id, p_payload);
  if nullif(btrim(coalesce(p_payload->>'maintenancePlanId', '')), '') is not null then
    begin
      v_plan := (p_payload->>'maintenancePlanId')::uuid;
    exception when invalid_text_representation then
      raise exception 'app: That plan was not found.';
    end;
    select site_id into v_site from svc.visits where id = v_id;
    select status, site_id into v_plan_status, v_plan_site
    from svc.maintenance_plans
    where id = v_plan;
    if v_plan_status is null then
      raise exception 'app: That plan was not found.';
    end if;
    if v_plan_status <> 'active' then
      raise exception 'app: That plan is not active.';
    end if;
    if v_plan_site is distinct from v_site then
      raise exception 'app: That plan is for a different site.';
    end if;
    update svc.visits
    set maintenance_plan_id = v_plan,
        source = 'proactive'
    where id = v_id;
  end if;
  if coalesce(p_payload->>'confirmOverlap', '') is distinct from 'true' then
    v_warning := svc.overlap_warning(v_id);
    if v_warning is not null then
      raise exception '%', v_warning;
    end if;
  end if;
  return v_id;
end;
$$;

create or replace function public.svc_set_route(p_resource uuid, p_day date, p_visits uuid[])
returns void
language plpgsql
security definer
set search_path = svc, public
as $$
declare
  v_have uuid[];
  v_want uuid[];
begin
  if not svc.office('edit') then
    raise exception 'app: You cannot change service visits.';
  end if;
  if p_resource is null or p_day is null then
    raise exception 'app: Choose an engineer and a date.';
  end if;
  if coalesce(cardinality(p_visits), 0) = 0 then
    raise exception 'app: Add a stop.';
  end if;
  if cardinality(p_visits) > 40 then
    raise exception 'app: Too many stops.';
  end if;
  if exists (select 1 from unnest(p_visits) as listed(id) where listed.id is null) then
    raise exception 'app: That route does not match this day.';
  end if;

  perform 1
  from svc.visit_assignees a
  join svc.visits v on v.id = a.visit_id
  where a.resource_id = p_resource
    and v.visit_on = p_day
  for update of a;

  select coalesce(array_agg(a.visit_id order by a.visit_id), '{}')
  into v_have
  from svc.visit_assignees a
  join svc.visits v on v.id = a.visit_id
  where a.resource_id = p_resource
    and v.visit_on = p_day;

  select coalesce(array_agg(listed.id order by listed.id), '{}')
  into v_want
  from unnest(p_visits) as listed(id);

  if v_have is distinct from v_want
     or cardinality(p_visits) is distinct from (
       select count(distinct listed.id)::integer from unnest(p_visits) as listed(id)
     )
  then
    raise exception 'app: That route does not match this day.';
  end if;

  update svc.visit_assignees a
  set stop_order = listed.ordinality::integer
  from unnest(p_visits) with ordinality as listed(visit_id, ordinality)
  where a.visit_id = listed.visit_id
    and a.resource_id = p_resource;
end;
$$;

create or replace function public.svc_route_day(p_resource uuid, p_day date)
returns jsonb
language plpgsql
stable
security definer
set search_path = svc, ops, public
as $$
begin
  if not svc.office('view') then
    raise exception 'app: You cannot see service visits.';
  end if;
  if p_resource is null or p_day is null then
    raise exception 'app: Choose an engineer and a date.';
  end if;
  if not exists (
    select 1 from ops.resources
    where id = p_resource and status = 'active' and resource_type in ('installer', 'helper', 'driver')
  ) then
    raise exception 'app: Choose a person.';
  end if;
  return jsonb_build_object(
    'resourceId', p_resource,
    'day', p_day,
    'stops', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', v.id,
        'siteId', s.id,
        'stopOrder', a.stop_order,
        'customerName', s.customer_name,
        'addressLine1', s.address_line1,
        'addressLine2', s.address_line2,
        'city', s.city,
        'postcode', s.postcode,
        'latitude', s.latitude,
        'longitude', s.longitude,
        'windowStart', to_char(v.window_start, 'HH24:MI'),
        'windowEnd', to_char(v.window_end, 'HH24:MI'),
        'durationMinutes', v.duration_minutes,
        'status', v.status,
        'visitType', v.visit_type
      ) order by a.stop_order, s.customer_name)
      from svc.visit_assignees a
      join svc.visits v on v.id = a.visit_id
      join svc.sites s on s.id = v.site_id
      where a.resource_id = p_resource
        and v.visit_on = p_day
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.svc_set_site_point(p_site uuid, p_lat numeric, p_lng numeric)
returns void
language plpgsql
security definer
set search_path = svc, public
as $$
begin
  if not svc.office('edit') then
    raise exception 'app: You cannot change service visits.';
  end if;
  if p_site is null or p_lat is null or p_lng is null
     or p_lat < -90 or p_lat > 90 or p_lng < -180 or p_lng > 180
  then
    raise exception 'app: That location could not be saved.';
  end if;
  update svc.sites
  set latitude = round(p_lat, 6),
      longitude = round(p_lng, 6)
  where id = p_site
    and latitude is null
    and longitude is null;
  if not exists (select 1 from svc.sites where id = p_site) then
    raise exception 'app: That site was not found.';
  end if;
end;
$$;

create or replace function public.svc_advance_plan(p_visit uuid)
returns date
language plpgsql
security definer
set search_path = svc, public
as $$
declare
  v_visit svc.visits%rowtype;
  v_plan svc.maintenance_plans%rowtype;
  v_next date;
begin
  if p_visit is null then
    return null;
  end if;
  if not (svc.visit_mine(p_visit) or svc.office('edit')) then
    raise exception 'app: You cannot update that visit.';
  end if;
  select * into v_visit from svc.visits where id = p_visit;
  if v_visit.id is null then
    raise exception 'app: That visit was not found.';
  end if;
  if v_visit.status <> 'done'
     or v_visit.source <> 'proactive'
     or v_visit.maintenance_plan_id is null
  then
    return null;
  end if;
  select * into v_plan
  from svc.maintenance_plans
  where id = v_visit.maintenance_plan_id
  for update;
  if v_plan.id is null or v_plan.status = 'ended' then
    return v_plan.next_due_on;
  end if;
  if v_plan.last_completed_visit_id = p_visit then
    return v_plan.next_due_on;
  end if;
  v_next := svc.add_months(v_plan.next_due_on, v_plan.cadence_months);
  update svc.maintenance_plans
  set next_due_on = v_next,
      last_completed_visit_id = p_visit
  where id = v_plan.id;
  return v_next;
end;
$$;

create or replace function public.svc_list_plans()
returns jsonb
language plpgsql
stable
security definer
set search_path = svc, public
as $$
begin
  if not svc.office('view') then
    raise exception 'app: You cannot see service visits.';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', p.id,
      'siteId', p.site_id,
      'customerName', s.customer_name,
      'postcode', s.postcode,
      'city', s.city,
      'orderNumber', p.order_number,
      'cadenceMonths', p.cadence_months,
      'startsOn', p.starts_on,
      'nextDueOn', p.next_due_on,
      'endsOn', p.ends_on,
      'status', p.status,
      'installId', p.install_id
    ) order by p.next_due_on, s.customer_name)
    from svc.maintenance_plans p
    join svc.sites s on s.id = p.site_id
  ), '[]'::jsonb);
end;
$$;

create or replace function public.svc_eligible_installs()
returns jsonb
language plpgsql
stable
security definer
set search_path = svc, ops, public
as $$
begin
  if not svc.office('view') then
    raise exception 'app: You cannot see service visits.';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', i.id,
      'orderNumber', i.order_number,
      'customerName', i.customer_name,
      'siteAddress', i.site_address,
      'warrantyOption', i.warranty_option,
      'cadenceMonths', svc.plan_cadence(i.warranty_option),
      'endOn', i.end_on,
      'status', i.status,
      'postcode', parsed.postcode,
      'ready', parsed.postcode is not null and nullif(btrim(i.customer_name), '') is not null
    ) order by i.end_on desc, i.order_number)
    from ops.installs i
    left join lateral svc.split_site_address(i.site_address) as parsed on true
    where i.status <> 'cancelled'
      and i.archived_at is null
      and svc.plan_cadence(i.warranty_option) is not null
      and not exists (
        select 1 from svc.maintenance_plans p where p.install_id = i.id
      )
  ), '[]'::jsonb);
end;
$$;

create or replace function public.svc_create_plan(p_install uuid, p_starts_on date, p_next_due_on date)
returns uuid
language plpgsql
security definer
set search_path = svc, ops, public
as $$
declare
  v_install ops.installs%rowtype;
  v_cadence integer;
  v_customer text;
  v_line1 text;
  v_city text;
  v_postcode text;
  v_site uuid;
  v_id uuid;
  v_starts date;
  v_due date;
begin
  if not svc.office('edit') then
    raise exception 'app: You cannot change service visits.';
  end if;
  select * into v_install from ops.installs where id = p_install;
  if v_install.id is null or v_install.status = 'cancelled' or v_install.archived_at is not null then
    raise exception 'app: That install has no maintenance plan.';
  end if;
  v_cadence := svc.plan_cadence(v_install.warranty_option);
  if v_cadence is null then
    raise exception 'app: That install has no maintenance plan.';
  end if;
  if exists (select 1 from svc.maintenance_plans where install_id = p_install) then
    raise exception 'app: That install already has a plan.';
  end if;
  v_customer := svc.clean_text(v_install.customer_name, 160);
  if v_customer is null then
    raise exception 'app: That install has no customer.';
  end if;
  select line1, city, postcode into v_line1, v_city, v_postcode
  from svc.split_site_address(v_install.site_address);
  if v_line1 is null or v_postcode is null then
    raise exception 'app: That install has no postcode.';
  end if;
  v_starts := coalesce(p_starts_on, v_install.end_on);
  v_due := coalesce(p_next_due_on, svc.add_months(v_starts, v_cadence));
  if v_starts is null or v_due is null
     or v_starts < date '2000-01-01' or v_starts > date '2100-01-01'
     or v_due < v_starts or v_due > date '2100-12-31'
  then
    raise exception 'app: Check the plan dates.';
  end if;

  select s.id into v_site
  from svc.sites s
  where lower(s.customer_name) = lower(v_customer)
    and lower(s.address_line1) = lower(v_line1)
    and upper(s.postcode) = upper(v_postcode)
  order by s.created_at
  limit 1;

  if v_site is null then
    insert into svc.sites (customer_name, address_line1, city, postcode)
    values (v_customer, v_line1, v_city, v_postcode)
    returning id into v_site;
  end if;

  if nullif(left(btrim(coalesce(v_install.contact_name, '')), 120), '') is not null
     and not exists (select 1 from svc.site_contacts where site_id = v_site and is_primary)
  then
    insert into svc.site_contacts (site_id, name, phone, email, is_primary)
    values (
      v_site,
      left(btrim(v_install.contact_name), 120),
      nullif(left(btrim(coalesce(v_install.contact_phone, '')), 40), ''),
      case
        when btrim(coalesce(v_install.contact_email, '')) ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
          then btrim(v_install.contact_email)
        else null
      end,
      true
    );
  end if;

  begin
    insert into svc.maintenance_plans (
      site_id, install_id, order_number, cadence_months, starts_on, next_due_on, status, created_by
    ) values (
      v_site, p_install, nullif(left(btrim(v_install.order_number), 80), ''), v_cadence, v_starts, v_due, 'active', auth.uid()
    )
    returning id into v_id;
  exception when unique_violation then
    raise exception 'app: That install already has a plan.';
  end;
  return v_id;
end;
$$;

create or replace function public.svc_set_plan_status(p_plan uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = svc, public
as $$
declare
  v_status text := svc.clean_text(p_status, 20);
  v_current text;
begin
  if not svc.office('edit') then
    raise exception 'app: You cannot change service visits.';
  end if;
  if v_status is null or v_status not in ('active', 'paused', 'ended') then
    raise exception 'app: Choose a status.';
  end if;
  select status into v_current from svc.maintenance_plans where id = p_plan for update;
  if v_current is null then
    raise exception 'app: That plan was not found.';
  end if;
  if v_current = 'ended' and v_status <> 'ended' then
    raise exception 'app: That plan has ended.';
  end if;
  update svc.maintenance_plans
  set status = v_status,
      ends_on = case
        when v_status = 'ended' then coalesce(ends_on, (timezone('Europe/London', now()))::date)
        else ends_on
      end
  where id = p_plan;
end;
$$;

create or replace function public.svc_due_plans(p_days integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = svc, public
as $$
declare
  v_today date := (timezone('Europe/London', now()))::date;
begin
  if not svc.office('view') then
    raise exception 'app: You cannot see service visits.';
  end if;
  if p_days is null or p_days not in (30, 60) then
    raise exception 'app: Choose 30 or 60 days.';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', p.id,
      'customerName', s.customer_name,
      'postcode', s.postcode,
      'city', s.city,
      'orderNumber', p.order_number,
      'cadenceMonths', p.cadence_months,
      'nextDueOn', p.next_due_on,
      'status', p.status
    ) order by p.next_due_on, s.customer_name)
    from svc.maintenance_plans p
    join svc.sites s on s.id = p.site_id
    where p.status = 'active'
      and p.next_due_on <= v_today + p_days
  ), '[]'::jsonb);
end;
$$;

create or replace function public.svc_plan_prefill(p_plan uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = svc, public
as $$
declare
  v_row jsonb;
begin
  if not svc.office('view') then
    raise exception 'app: You cannot see service visits.';
  end if;
  select jsonb_build_object(
    'id', p.id,
    'customerName', s.customer_name,
    'addressLine1', s.address_line1,
    'addressLine2', coalesce(s.address_line2, ''),
    'city', coalesce(s.city, ''),
    'postcode', s.postcode,
    'contactName', coalesce(c.name, ''),
    'contactPhone', coalesce(c.phone, ''),
    'contactEmail', coalesce(c.email, ''),
    'nextDueOn', p.next_due_on,
    'orderNumber', coalesce(p.order_number, ''),
    'cadenceMonths', p.cadence_months,
    'status', p.status
  )
  into v_row
  from svc.maintenance_plans p
  join svc.sites s on s.id = p.site_id
  left join svc.site_contacts c on c.site_id = s.id and c.is_primary
  where p.id = p_plan;
  if v_row is null then
    raise exception 'app: That plan was not found.';
  end if;
  return v_row;
end;
$$;

revoke all on function public.svc_set_route(uuid, date, uuid[]) from public, anon;
revoke all on function public.svc_route_day(uuid, date) from public, anon;
revoke all on function public.svc_set_site_point(uuid, numeric, numeric) from public, anon;
revoke all on function public.svc_advance_plan(uuid) from public, anon;
revoke all on function public.svc_list_plans() from public, anon;
revoke all on function public.svc_eligible_installs() from public, anon;
revoke all on function public.svc_create_plan(uuid, date, date) from public, anon;
revoke all on function public.svc_set_plan_status(uuid, text) from public, anon;
revoke all on function public.svc_due_plans(integer) from public, anon;
revoke all on function public.svc_plan_prefill(uuid) from public, anon;

grant execute on function public.svc_set_route(uuid, date, uuid[]) to authenticated, service_role;
grant execute on function public.svc_route_day(uuid, date) to authenticated, service_role;
grant execute on function public.svc_set_site_point(uuid, numeric, numeric) to authenticated, service_role;
grant execute on function public.svc_advance_plan(uuid) to authenticated, service_role;
grant execute on function public.svc_list_plans() to authenticated, service_role;
grant execute on function public.svc_eligible_installs() to authenticated, service_role;
grant execute on function public.svc_create_plan(uuid, date, date) to authenticated, service_role;
grant execute on function public.svc_set_plan_status(uuid, text) to authenticated, service_role;
grant execute on function public.svc_due_plans(integer) to authenticated, service_role;
grant execute on function public.svc_plan_prefill(uuid) to authenticated, service_role;
