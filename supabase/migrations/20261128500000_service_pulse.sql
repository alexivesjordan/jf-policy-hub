-- Pulse Service. Visits live in svc. People, leave, and install bookings stay in ops.
-- A person cannot be on an install and a service visit the same day.
-- New file only. Do not apply this to production.

create schema if not exists svc;

revoke all on schema svc from public, anon;
grant usage on schema svc to service_role;

comment on schema svc is
  'Pulse Service. Sites, assets, and visits. Crew time still comes from ops.resources.';

update core.pulses
set name = 'Service', status = 'active'
where id = 'service';

-- ---------------------------------------------------------------------------
-- Sites, assets, visits. Assets carry a future external id and are not a
-- product catalogue. Visits stack on a day; installs remain full-day bookings.
-- ---------------------------------------------------------------------------

create table svc.sites (
  id uuid primary key default gen_random_uuid(),
  customer_name text not null,
  address_line1 text not null,
  address_line2 text,
  city text,
  postcode text not null,
  country text not null default 'GB',
  latitude numeric(9, 6),
  longitude numeric(9, 6),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (char_length(btrim(customer_name)) between 1 and 160),
  check (char_length(btrim(address_line1)) between 1 and 160),
  check (address_line2 is null or char_length(address_line2) <= 160),
  check (city is null or char_length(city) <= 80),
  check (char_length(btrim(postcode)) between 3 and 12),
  check (country ~ '^[A-Z]{2}$'),
  check (latitude is null or latitude between -90 and 90),
  check (longitude is null or longitude between -180 and 180),
  check ((latitude is null) = (longitude is null))
);

create index sites_match_idx on svc.sites (lower(customer_name), upper(postcode));

create trigger sites_touch_updated_at
before update on svc.sites
for each row execute function public.touch_updated_at();

create table svc.site_contacts (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references svc.sites (id) on delete cascade,
  name text not null,
  phone text,
  email text,
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  check (char_length(btrim(name)) between 1 and 120),
  check (phone is null or char_length(phone) <= 40),
  check (email is null or email ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$')
);

create index site_contacts_site_idx on svc.site_contacts (site_id);
create unique index site_contacts_one_primary_idx
  on svc.site_contacts (site_id) where is_primary;

create table svc.assets (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references svc.sites (id) on delete restrict,
  make text,
  model text,
  serial text,
  external_ref text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (make is null or char_length(make) <= 80),
  check (model is null or char_length(model) <= 80),
  check (serial is null or char_length(serial) <= 80),
  check (external_ref is null or char_length(external_ref) <= 80),
  check (make is not null or model is not null or serial is not null or external_ref is not null)
);

comment on column svc.assets.external_ref is
  'Optional id from the future asset system of record. Unused by this release.';

create index assets_site_idx on svc.assets (site_id);
create unique index assets_site_serial_uidx
  on svc.assets (site_id, lower(serial))
  where serial is not null and btrim(serial) <> '';
create unique index assets_external_ref_uidx
  on svc.assets (external_ref)
  where external_ref is not null;

create trigger assets_touch_updated_at
before update on svc.assets
for each row execute function public.touch_updated_at();

create table svc.visits (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references svc.sites (id) on delete restrict,
  visit_type text not null,
  source text not null default 'manual',
  notes text,
  cin7_order_number text,
  hubspot_ticket text,
  visit_on date not null,
  scheduled_for timestamptz,
  window_start time,
  window_end time,
  duration_minutes integer not null,
  reported_at timestamptz not null default now(),
  arrived_at timestamptz,
  completed_at timestamptz,
  status text not null default 'scheduled',
  incomplete_reason text,
  completion_note text,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (visit_type in ('repair', 'swap', 'service', 'collection', 'other')),
  check (source in ('manual', 'ticket', 'proactive', 'external')),
  check (status in ('scheduled', 'en_route', 'on_site', 'done', 'incomplete')),
  check (duration_minutes between 15 and 480),
  check (notes is null or char_length(notes) <= 4000),
  check (cin7_order_number is null or cin7_order_number ~ '^[A-Za-z0-9-]{1,40}$'),
  check (hubspot_ticket is null or char_length(hubspot_ticket) <= 80),
  check (incomplete_reason is null or char_length(incomplete_reason) <= 500),
  check (completion_note is null or char_length(completion_note) <= 2000),
  check (status <> 'incomplete' or nullif(btrim(incomplete_reason), '') is not null),
  check (window_end is null or window_start is null or window_end > window_start)
);

create index visits_day_idx on svc.visits (visit_on);
create index visits_site_idx on svc.visits (site_id);
create index visits_open_idx on svc.visits (visit_on) where status not in ('done', 'incomplete');

create trigger visits_touch_updated_at
before update on svc.visits
for each row execute function public.touch_updated_at();

create table svc.visit_lines (
  id uuid primary key default gen_random_uuid(),
  visit_id uuid not null references svc.visits (id) on delete cascade,
  kind text not null,
  sku text,
  serial text,
  fault text,
  parts text,
  description text,
  sort_order integer not null default 0,
  check (kind in ('work', 'swap_out', 'swap_back')),
  check (sku is null or char_length(sku) <= 80),
  check (serial is null or char_length(serial) <= 80),
  check (fault is null or char_length(fault) <= 500),
  check (parts is null or char_length(parts) <= 500),
  check (description is null or char_length(description) <= 200),
  check (
    nullif(btrim(coalesce(sku, '')), '') is not null
    or nullif(btrim(coalesce(serial, '')), '') is not null
    or nullif(btrim(coalesce(fault, '')), '') is not null
    or nullif(btrim(coalesce(parts, '')), '') is not null
    or nullif(btrim(coalesce(description, '')), '') is not null
  )
);

create index visit_lines_visit_idx on svc.visit_lines (visit_id, sort_order);

create table svc.visit_assets (
  visit_id uuid not null references svc.visits (id) on delete cascade,
  asset_id uuid not null references svc.assets (id) on delete restrict,
  primary key (visit_id, asset_id)
);

create index visit_assets_asset_idx on svc.visit_assets (asset_id);

create table svc.visit_assignees (
  visit_id uuid not null references svc.visits (id) on delete cascade,
  resource_id uuid not null references ops.resources (id) on delete restrict,
  stop_order integer not null,
  primary key (visit_id, resource_id),
  check (stop_order > 0)
);

create index visit_assignees_resource_idx on svc.visit_assignees (resource_id);

create table svc.visit_photos (
  id uuid primary key default gen_random_uuid(),
  visit_id uuid not null references svc.visits (id) on delete cascade,
  file_id uuid not null unique references core.files (id) on delete restrict,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create index visit_photos_visit_idx on svc.visit_photos (visit_id);

-- ---------------------------------------------------------------------------
-- Access helpers. Office uses the service module. Assignees see their visits.
-- ---------------------------------------------------------------------------

create or replace function svc.office(p_need text)
returns boolean
language sql
stable
security definer
set search_path = ops, public
as $$
  select auth.uid() is not null
    and not ops.is_field_engineer()
    and (
      public.workspace_can('service', p_need)
      or public.workspace_is_admin()
    );
$$;

create or replace function svc.visit_mine(p_visit uuid)
returns boolean
language sql
stable
security definer
set search_path = svc, ops, public
as $$
  select auth.uid() is not null and exists (
    select 1
    from svc.visit_assignees a
    join ops.resources r on r.id = a.resource_id
    where a.visit_id = p_visit
      and r.profile_id = auth.uid()
      and r.status = 'active'
  );
$$;

revoke all on function svc.office(text) from public, anon;
revoke all on function svc.visit_mine(uuid) from public, anon;
grant execute on function svc.office(text) to authenticated, service_role;
grant execute on function svc.visit_mine(uuid) to authenticated, service_role;

alter table svc.sites enable row level security;
alter table svc.site_contacts enable row level security;
alter table svc.assets enable row level security;
alter table svc.visits enable row level security;
alter table svc.visit_lines enable row level security;
alter table svc.visit_assets enable row level security;
alter table svc.visit_assignees enable row level security;
alter table svc.visit_photos enable row level security;

revoke all on svc.sites, svc.site_contacts, svc.assets, svc.visits,
  svc.visit_lines, svc.visit_assets, svc.visit_assignees, svc.visit_photos
  from public, anon, authenticated;
grant all on svc.sites, svc.site_contacts, svc.assets, svc.visits,
  svc.visit_lines, svc.visit_assets, svc.visit_assignees, svc.visit_photos
  to service_role;

create policy sites_select on svc.sites
  for select to authenticated
  using (
    (select svc.office('view'))
    or exists (
      select 1 from svc.visits v
      where v.site_id = sites.id and (select svc.visit_mine(v.id))
    )
  );

create policy sites_write on svc.sites
  for all to authenticated
  using ((select svc.office('edit')))
  with check ((select svc.office('edit')));

create policy site_contacts_select on svc.site_contacts
  for select to authenticated
  using (
    (select svc.office('view'))
    or exists (
      select 1 from svc.visits v
      where v.site_id = site_contacts.site_id and (select svc.visit_mine(v.id))
    )
  );

create policy site_contacts_write on svc.site_contacts
  for all to authenticated
  using ((select svc.office('edit')))
  with check ((select svc.office('edit')));

create policy assets_select on svc.assets
  for select to authenticated
  using (
    (select svc.office('view'))
    or exists (
      select 1
      from svc.visit_assets link
      join svc.visits v on v.id = link.visit_id
      where link.asset_id = assets.id and (select svc.visit_mine(v.id))
    )
  );

create policy assets_write on svc.assets
  for all to authenticated
  using ((select svc.office('edit')))
  with check ((select svc.office('edit')));

create policy visits_select on svc.visits
  for select to authenticated
  using ((select svc.office('view')) or (select svc.visit_mine(id)));

create policy visits_insert on svc.visits
  for insert to authenticated
  with check ((select svc.office('edit')));

create policy visits_update on svc.visits
  for update to authenticated
  using ((select svc.office('edit')))
  with check ((select svc.office('edit')));

create policy visits_delete on svc.visits
  for delete to authenticated
  using ((select svc.office('edit')));

create policy visit_lines_select on svc.visit_lines
  for select to authenticated
  using (
    (select svc.office('view'))
    or (select svc.visit_mine(visit_id))
  );

create policy visit_lines_write on svc.visit_lines
  for all to authenticated
  using ((select svc.office('edit')))
  with check ((select svc.office('edit')));

create policy visit_assets_select on svc.visit_assets
  for select to authenticated
  using (
    (select svc.office('view'))
    or (select svc.visit_mine(visit_id))
  );

create policy visit_assets_write on svc.visit_assets
  for all to authenticated
  using ((select svc.office('edit')))
  with check ((select svc.office('edit')));

create policy visit_assignees_select on svc.visit_assignees
  for select to authenticated
  using (
    (select svc.office('view'))
    or (select svc.visit_mine(visit_id))
    or exists (
      select 1 from ops.resources r
      where r.id = visit_assignees.resource_id and r.profile_id = (select auth.uid())
    )
  );

create policy visit_assignees_write on svc.visit_assignees
  for all to authenticated
  using ((select svc.office('edit')))
  with check ((select svc.office('edit')));

create policy visit_photos_select on svc.visit_photos
  for select to authenticated
  using (
    (select svc.office('view'))
    or (select svc.visit_mine(visit_id))
  );

create policy visit_photos_write on svc.visit_photos
  for all to authenticated
  using ((select svc.office('edit')) or (select svc.visit_mine(visit_id)))
  with check ((select svc.office('edit')) or (select svc.visit_mine(visit_id)));

-- ---------------------------------------------------------------------------
-- One conflict list for installs, leave, and service.
-- Install booking treats every row as a full day. Service visits may stack
-- with each other, and reject install and leave only.
-- ---------------------------------------------------------------------------

create or replace function ops.person_day_conflicts(p_resource uuid, p_day date, p_except uuid default null)
returns table (kind text, label text, href text)
language sql
stable
set search_path = ops, svc, public
as $$
  select 'install'::text, i.order_number::text, ('/operations/installs/' || i.id)::text
  from ops.install_reservations ir
  join ops.installs i on i.id = ir.install_id
  where ir.resource_id = p_resource
    and ir.day = p_day
    and i.status <> 'cancelled'
    and i.archived_at is null
  union all
  select 'install'::text,
    coalesce(j.cin7_order_number, j.cin7_number, 'Install')::text,
    ('/operations/jobs/' || j.id)::text
  from ops.reservations rv
  join ops.install_jobs j on j.id = rv.job_id
  where rv.resource_id = p_resource
    and rv.day = p_day
    and j.status::text <> 'lost_cancelled'
  union all
  select 'leave'::text, u.reason::text, null::text
  from ops.unavailability u
  where u.resource_id = p_resource
    and p_day between u.starts_on and u.ends_on
  union all
  select 'leave'::text, e.entry_type::text, null::text
  from public.calendar_entries e
  join ops.resources r on r.profile_id = e.profile_id
  where r.id = p_resource
    and e.request_status = 'confirmed'
    and e.entry_type in ('annual_leave', 'sick', 'other_absence')
    and p_day between e.starts_on and e.ends_on
  union all
  select 'service'::text, s.customer_name::text, ('/service/visits/' || v.id)::text
  from svc.visit_assignees a
  join svc.visits v on v.id = a.visit_id
  join svc.sites s on s.id = v.site_id
  where a.resource_id = p_resource
    and v.visit_on = p_day
    and v.id is distinct from p_except;
$$;

revoke all on function ops.person_day_conflicts(uuid, date, uuid) from public, anon, authenticated;

create or replace function ops.resource_free_for_days(p_resource uuid, p_days date[])
returns boolean
language sql
stable
set search_path = ops, public
as $$
  select not exists (
    select 1
    from unnest(p_days) as needed(day)
    where exists (
      select 1 from ops.person_day_conflicts(p_resource, needed.day, null)
    )
  );
$$;

revoke all on function ops.resource_free_for_days(uuid, date[]) from public, anon, authenticated;

create or replace function svc.block_message(p_resource uuid, p_day date, p_except uuid)
returns text
language plpgsql
stable
set search_path = ops, public
as $$
declare
  v_kind text;
  v_label text;
begin
  select c.kind, c.label into v_kind, v_label
  from ops.person_day_conflicts(p_resource, p_day, p_except) c
  where c.kind in ('install', 'leave')
  limit 1;
  if v_kind is null then
    return null;
  end if;
  if v_kind = 'install' then
    return format('That person is on an install that day (%s).', coalesce(v_label, 'Install'));
  end if;
  return 'That person is away that day.';
end;
$$;

revoke all on function svc.block_message(uuid, date, uuid) from public, anon, authenticated;

create or replace function svc.renumber_stops(p_resource uuid, p_day date, p_focus uuid default null, p_index integer default null)
returns void
language plpgsql
set search_path = svc, public
as $$
declare
  v_ids uuid[];
  v_index integer;
  v_id uuid;
  v_n integer := 0;
begin
  select coalesce(array_agg(a.visit_id order by a.stop_order, v.created_at), '{}')
  into v_ids
  from svc.visit_assignees a
  join svc.visits v on v.id = a.visit_id
  where a.resource_id = p_resource
    and v.visit_on = p_day
    and a.visit_id is distinct from p_focus;

  if p_focus is not null then
    v_index := least(greatest(coalesce(p_index, cardinality(v_ids) + 1), 1), cardinality(v_ids) + 1);
    if v_index <= 1 then
      v_ids := array[p_focus] || v_ids;
    elsif v_index > cardinality(v_ids) then
      v_ids := v_ids || array[p_focus];
    else
      v_ids := v_ids[1:v_index - 1] || array[p_focus] || v_ids[v_index:cardinality(v_ids)];
    end if;
  end if;

  if v_ids is null then
    return;
  end if;
  foreach v_id in array v_ids loop
    v_n := v_n + 1;
    update svc.visit_assignees
    set stop_order = v_n
    where visit_id = v_id and resource_id = p_resource;
  end loop;
end;
$$;

revoke all on function svc.renumber_stops(uuid, date, uuid, integer) from public, anon, authenticated;

create or replace function svc.scheduled_at(p_day date, p_window time)
returns timestamptz
language sql
immutable
as $$
  select (p_day::timestamp + coalesce(p_window, time '00:00')) at time zone 'Europe/London';
$$;

revoke all on function svc.scheduled_at(date, time) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Reads and writes. The API is these functions. Tables stay closed.
-- ---------------------------------------------------------------------------

create or replace function public.service_people()
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
    select jsonb_agg(jsonb_build_object('id', r.id, 'name', r.name) order by r.name)
    from ops.resources r
    where r.status = 'active'
      and r.resource_type in ('installer', 'helper', 'driver')
  ), '[]'::jsonb);
end;
$$;

create or replace function public.service_board(p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = svc, ops, public
as $$
declare
  v_people jsonb;
  v_conflicts jsonb;
  v_stops jsonb;
begin
  if not svc.office('view') then
    raise exception 'app: You cannot see service visits.';
  end if;
  if p_from is null or p_to is null or p_to < p_from or p_to > p_from + 13 then
    raise exception 'app: Choose a week.';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name) order by name), '[]'::jsonb)
  into v_people
  from (
    select r.id, r.name
    from ops.resources r
    where r.status = 'active' and r.resource_type in ('installer', 'helper', 'driver')
    union
    select r.id, r.name
    from svc.visit_assignees a
    join svc.visits v on v.id = a.visit_id
    join ops.resources r on r.id = a.resource_id
    where v.visit_on between p_from and p_to
  ) people;

  select coalesce(jsonb_agg(jsonb_build_object(
    'resourceId', c.resource_id,
    'day', c.day,
    'kind', c.kind,
    'label', c.label,
    'href', c.href
  )), '[]'::jsonb)
  into v_conflicts
  from (
    select r.id as resource_id, d::date as day, hit.kind, hit.label, hit.href
    from ops.resources r
    cross join generate_series(p_from, p_to, interval '1 day') d
    cross join lateral (
      select kind, label, href
      from ops.person_day_conflicts(r.id, d::date, null)
      where kind in ('install', 'leave')
    ) hit
    where r.resource_type in ('installer', 'helper', 'driver')
  ) c;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', v.id,
    'resourceId', a.resource_id,
    'day', v.visit_on,
    'stopOrder', coalesce(a.stop_order, 0),
    'customerName', s.customer_name,
    'postcode', s.postcode,
    'city', s.city,
    'visitType', v.visit_type,
    'status', v.status,
    'durationMinutes', v.duration_minutes,
    'windowStart', to_char(v.window_start, 'HH24:MI'),
    'windowEnd', to_char(v.window_end, 'HH24:MI'),
    'assigneeCount', (select count(*) from svc.visit_assignees counted where counted.visit_id = v.id)
  ) order by v.visit_on, a.stop_order nulls last, s.customer_name), '[]'::jsonb)
  into v_stops
  from svc.visits v
  join svc.sites s on s.id = v.site_id
  left join svc.visit_assignees a on a.visit_id = v.id
  where v.visit_on between p_from and p_to;

  return jsonb_build_object(
    'from', p_from,
    'to', p_to,
    'canEdit', svc.office('edit'),
    'people', v_people,
    'conflicts', v_conflicts,
    'stops', v_stops
  );
end;
$$;

create or replace function svc.visit_json(p_visit uuid)
returns jsonb
language plpgsql
stable
set search_path = svc, ops, public
as $$
declare
  v_row svc.visits%rowtype;
  v_site svc.sites%rowtype;
  v_contact svc.site_contacts%rowtype;
begin
  select * into v_row from svc.visits where id = p_visit;
  if v_row.id is null then
    return null;
  end if;
  select * into v_site from svc.sites where id = v_row.site_id;
  select * into v_contact
  from svc.site_contacts
  where site_id = v_site.id and is_primary
  order by created_at
  limit 1;
  return jsonb_build_object(
    'id', v_row.id,
    'siteId', v_site.id,
    'customerName', v_site.customer_name,
    'addressLine1', v_site.address_line1,
    'addressLine2', v_site.address_line2,
    'city', v_site.city,
    'postcode', v_site.postcode,
    'latitude', v_site.latitude,
    'longitude', v_site.longitude,
    'contactName', v_contact.name,
    'contactPhone', v_contact.phone,
    'contactEmail', v_contact.email,
    'visitType', v_row.visit_type,
    'source', v_row.source,
    'notes', v_row.notes,
    'cin7OrderNumber', v_row.cin7_order_number,
    'hubspotTicket', v_row.hubspot_ticket,
    'visitOn', v_row.visit_on,
    'scheduledFor', v_row.scheduled_for,
    'windowStart', to_char(v_row.window_start, 'HH24:MI'),
    'windowEnd', to_char(v_row.window_end, 'HH24:MI'),
    'durationMinutes', v_row.duration_minutes,
    'reportedAt', v_row.reported_at,
    'arrivedAt', v_row.arrived_at,
    'completedAt', v_row.completed_at,
    'status', v_row.status,
    'incompleteReason', v_row.incomplete_reason,
    'completionNote', v_row.completion_note,
    'assignees', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', r.id, 'name', r.name, 'stopOrder', a.stop_order
      ) order by a.stop_order, r.name)
      from svc.visit_assignees a
      join ops.resources r on r.id = a.resource_id
      where a.visit_id = v_row.id
    ), '[]'::jsonb),
    'lines', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', l.id, 'kind', l.kind, 'sku', l.sku, 'serial', l.serial,
        'fault', l.fault, 'parts', l.parts, 'description', l.description
      ) order by l.sort_order, l.id)
      from svc.visit_lines l
      where l.visit_id = v_row.id
    ), '[]'::jsonb),
    'assets', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', asset.id, 'make', asset.make, 'model', asset.model, 'serial', asset.serial
      ) order by asset.make, asset.model, asset.serial)
      from svc.visit_assets link
      join svc.assets asset on asset.id = link.asset_id
      where link.visit_id = v_row.id
    ), '[]'::jsonb),
    'photos', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id, 'fileId', f.id, 'bucket', f.bucket, 'path', f.storage_path
      ) order by p.created_at)
      from svc.visit_photos p
      join core.files f on f.id = p.file_id
      where p.visit_id = v_row.id
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function svc.visit_json(uuid) from public, anon, authenticated;

create or replace function public.service_visit_open(p_visit uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = svc, public
as $$
begin
  if p_visit is null or not (svc.office('view') or svc.visit_mine(p_visit)) then
    raise exception 'app: That visit was not found.';
  end if;
  if not exists (select 1 from svc.visits where id = p_visit) then
    raise exception 'app: That visit was not found.';
  end if;
  return svc.visit_json(p_visit);
end;
$$;

create or replace function public.service_visit_day()
returns jsonb
language plpgsql
stable
security definer
set search_path = svc, ops, public
as $$
declare
  v_today date := (timezone('Europe/London', now()))::date;
begin
  if auth.uid() is null then
    raise exception 'app: Sign in first.';
  end if;
  return jsonb_build_object(
    'day', v_today,
    'stops', coalesce((
      select jsonb_agg(svc.visit_json(v.id) order by a.stop_order, s.customer_name)
      from svc.visit_assignees a
      join svc.visits v on v.id = a.visit_id
      join svc.sites s on s.id = v.site_id
      join ops.resources r on r.id = a.resource_id
      where r.profile_id = auth.uid()
        and r.status = 'active'
        and v.visit_on = v_today
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function svc.clean_text(p_value text, p_max integer)
returns text
language sql
immutable
as $$
  select nullif(left(btrim(coalesce(p_value, '')), p_max), '');
$$;

revoke all on function svc.clean_text(text, integer) from public, anon, authenticated;

create or replace function public.service_visit_save(p_id uuid, p_payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = svc, ops, public
as $$
declare
  v_customer text;
  v_line1 text;
  v_line2 text;
  v_city text;
  v_postcode text;
  v_phone text;
  v_email text;
  v_contact text;
  v_type text;
  v_notes text;
  v_cin7 text;
  v_ticket text;
  v_day date;
  v_window_start time;
  v_window_end time;
  v_duration integer;
  v_lat numeric;
  v_lng numeric;
  v_source text;
  v_site uuid;
  v_existing svc.visits%rowtype;
  v_old_day date;
  v_shared boolean := false;
  v_address_changed boolean := false;
  v_ids uuid[] := '{}';
  v_old_ids uuid[] := '{}';
  v_resource uuid;
  v_line jsonb;
  v_asset jsonb;
  v_kind text;
  v_sku text;
  v_serial text;
  v_make text;
  v_model text;
  v_asset_id uuid;
  v_touch uuid[] := '{}';
  v_n integer := 0;
  v_block text;
  v_raw text;
begin
  if not svc.office('edit') then
    raise exception 'app: You cannot change service visits.';
  end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'app: That visit could not be saved.';
  end if;

  v_customer := svc.clean_text(p_payload->>'customerName', 160);
  v_line1 := svc.clean_text(p_payload->>'addressLine1', 160);
  v_line2 := svc.clean_text(p_payload->>'addressLine2', 160);
  v_city := svc.clean_text(p_payload->>'city', 80);
  v_postcode := upper(regexp_replace(coalesce(svc.clean_text(p_payload->>'postcode', 16), ''), '[[:space:]]', '', 'g'));
  if v_postcode = '' then
    v_postcode := null;
  end if;
  v_phone := svc.clean_text(p_payload->>'contactPhone', 40);
  v_email := svc.clean_text(p_payload->>'contactEmail', 160);
  v_contact := svc.clean_text(p_payload->>'contactName', 120);
  v_type := svc.clean_text(p_payload->>'visitType', 20);
  v_notes := svc.clean_text(p_payload->>'notes', 4000);
  v_cin7 := svc.clean_text(p_payload->>'cin7OrderNumber', 40);
  v_ticket := svc.clean_text(p_payload->>'hubspotTicket', 80);
  v_raw := svc.clean_text(p_payload->>'windowStart', 5);
  if v_raw is not null then
    if v_raw !~ '^\d{2}:\d{2}$' then
      raise exception 'app: Enter a start time.';
    end if;
    v_window_start := v_raw::time;
  end if;
  v_raw := svc.clean_text(p_payload->>'windowEnd', 5);
  if v_raw is not null then
    if v_raw !~ '^\d{2}:\d{2}$' then
      raise exception 'app: Enter an end time.';
    end if;
    v_window_end := v_raw::time;
  end if;

  if v_customer is null then
    raise exception 'app: Enter the customer.';
  end if;
  if v_line1 is null then
    raise exception 'app: Enter the address.';
  end if;
  if v_postcode is null then
    raise exception 'app: Enter the postcode.';
  end if;
  if v_postcode ~ '^[A-Z]{1,2}[0-9][A-Z0-9]?[0-9][A-Z]{2}$' then
    v_postcode := regexp_replace(v_postcode, '([0-9][A-Z]{2})$', ' \1');
  end if;
  if char_length(v_postcode) > 12 then
    raise exception 'app: Enter the postcode.';
  end if;
  if v_type is null or v_type not in ('repair', 'swap', 'service', 'collection', 'other') then
    raise exception 'app: Choose a visit type.';
  end if;
  if v_email is not null and v_email !~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'app: Enter a contact email.';
  end if;
  if v_cin7 is not null and v_cin7 !~ '^[A-Za-z0-9-]{1,40}$' then
    raise exception 'app: Enter the Cin7 order number.';
  end if;
  if (v_window_start is null) <> (v_window_end is null) then
    raise exception 'app: Enter both times, or leave the window blank.';
  end if;
  if v_window_start is not null and v_window_end <= v_window_start then
    raise exception 'app: The window end must be after the start.';
  end if;
  begin
    v_day := (p_payload->>'visitOn')::date;
    v_duration := (p_payload->>'durationMinutes')::integer;
    if nullif(p_payload->>'latitude', '') is not null then
      v_lat := round((p_payload->>'latitude')::numeric, 6);
      v_lng := round((p_payload->>'longitude')::numeric, 6);
    end if;
  exception when others then
    raise exception 'app: Check the date, duration, and location.';
  end;
  if v_day is null then
    raise exception 'app: Choose a date.';
  end if;
  if v_duration is null or v_duration < 15 or v_duration > 480 then
    raise exception 'app: Enter a duration between 15 and 480 minutes.';
  end if;
  if v_lat is not null and (v_lat < -90 or v_lat > 90 or v_lng is null or v_lng < -180 or v_lng > 180) then
    v_lat := null;
    v_lng := null;
  end if;

  begin
    select coalesce(array_agg(distinct value::uuid), '{}')
    into v_ids
    from jsonb_array_elements_text(coalesce(p_payload->'assigneeIds', '[]'::jsonb)) as listed(value)
    where btrim(value) <> '';
  exception when invalid_text_representation then
    raise exception 'app: Choose a person.';
  end;
  if cardinality(v_ids) > 8 then
    raise exception 'app: Choose fewer people.';
  end if;
  if exists (
    select 1
    from unnest(v_ids) as wanted(id)
    where not exists (
      select 1 from ops.resources r
      where r.id = wanted.id
        and r.status = 'active'
        and r.resource_type in ('installer', 'helper', 'driver')
    )
  ) then
    raise exception 'app: Choose a person.';
  end if;

  if p_id is not null then
    select * into v_existing from svc.visits where id = p_id for update;
    if v_existing.id is null then
      raise exception 'app: That visit was not found.';
    end if;
    v_old_day := v_existing.visit_on;
    v_site := v_existing.site_id;
    select coalesce(array_agg(resource_id), '{}') into v_old_ids
    from svc.visit_assignees where visit_id = p_id;
    select exists (select 1 from svc.visits other where other.site_id = v_site and other.id <> p_id)
    into v_shared;
    select
      s.customer_name is distinct from v_customer
      or s.address_line1 is distinct from v_line1
      or s.address_line2 is distinct from v_line2
      or s.city is distinct from v_city
      or s.postcode is distinct from v_postcode
    into v_address_changed
    from svc.sites s where s.id = v_site;
    if v_shared and v_address_changed then
      v_site := null;
    end if;
    if v_existing.source in ('proactive', 'external') then
      v_source := v_existing.source;
    elsif v_ticket is not null then
      v_source := 'ticket';
    else
      v_source := 'manual';
    end if;
  else
    v_source := case when v_ticket is not null then 'ticket' else 'manual' end;
  end if;

  if v_site is null then
    select s.id into v_site
    from svc.sites s
    where lower(s.customer_name) = lower(v_customer)
      and lower(s.address_line1) = lower(v_line1)
      and upper(s.postcode) = upper(v_postcode)
    order by s.created_at
    limit 1;
  end if;

  if v_site is null then
    insert into svc.sites (
      customer_name, address_line1, address_line2, city, postcode, latitude, longitude
    ) values (
      v_customer, v_line1, v_line2, v_city, v_postcode, v_lat, v_lng
    ) returning id into v_site;
  else
    update svc.sites
    set customer_name = v_customer,
        address_line1 = v_line1,
        address_line2 = v_line2,
        city = v_city,
        postcode = v_postcode,
        latitude = coalesce(v_lat, latitude),
        longitude = coalesce(v_lng, longitude)
    where id = v_site;
  end if;

  if v_contact is null and (v_phone is not null or v_email is not null) then
    raise exception 'app: Enter the contact name.';
  end if;
  if v_contact is null then
    delete from svc.site_contacts where site_id = v_site and is_primary;
  else
    delete from svc.site_contacts where site_id = v_site and is_primary;
    insert into svc.site_contacts (site_id, name, phone, email, is_primary)
    values (v_site, v_contact, v_phone, v_email, true);
  end if;

  if p_id is null then
    insert into svc.visits (
      site_id, visit_type, source, notes, cin7_order_number, hubspot_ticket,
      visit_on, scheduled_for, window_start, window_end, duration_minutes, created_by
    ) values (
      v_site, v_type, v_source, v_notes, v_cin7, v_ticket,
      v_day, svc.scheduled_at(v_day, v_window_start), v_window_start, v_window_end,
      v_duration, auth.uid()
    ) returning id into p_id;
    v_old_day := v_day;
  else
    update svc.visits
    set site_id = v_site,
        visit_type = v_type,
        source = v_source,
        notes = v_notes,
        cin7_order_number = v_cin7,
        hubspot_ticket = v_ticket,
        visit_on = v_day,
        scheduled_for = svc.scheduled_at(v_day, v_window_start),
        window_start = v_window_start,
        window_end = v_window_end,
        duration_minutes = v_duration
    where id = p_id;
  end if;

  delete from svc.visit_lines where visit_id = p_id;
  for v_line in
    select value from jsonb_array_elements(coalesce(p_payload->'lines', '[]'::jsonb))
  loop
    v_n := v_n + 1;
    if v_n > 40 then
      raise exception 'app: Too many lines.';
    end if;
    v_kind := svc.clean_text(v_line->>'kind', 20);
    if v_kind is null then
      continue;
    end if;
    if v_type <> 'swap' and v_kind in ('swap_out', 'swap_back') then
      raise exception 'app: Swap kit is only for an equipment swap.';
    end if;
    if v_kind not in ('work', 'swap_out', 'swap_back') then
      raise exception 'app: Check the lines.';
    end if;
    v_sku := svc.clean_text(v_line->>'sku', 80);
    if v_sku is null
      and svc.clean_text(v_line->>'serial', 80) is null
      and svc.clean_text(v_line->>'fault', 500) is null
      and svc.clean_text(v_line->>'parts', 500) is null
      and svc.clean_text(v_line->>'description', 200) is null
    then
      continue;
    end if;
    insert into svc.visit_lines (visit_id, kind, sku, serial, fault, parts, description, sort_order)
    values (
      p_id, v_kind, v_sku,
      svc.clean_text(v_line->>'serial', 80),
      svc.clean_text(v_line->>'fault', 500),
      svc.clean_text(v_line->>'parts', 500),
      svc.clean_text(v_line->>'description', 200),
      v_n
    );
  end loop;

  delete from svc.visit_assets where visit_id = p_id;
  v_n := 0;
  for v_asset in
    select value from jsonb_array_elements(coalesce(p_payload->'assets', '[]'::jsonb))
  loop
    v_n := v_n + 1;
    if v_n > 40 then
      raise exception 'app: Too many pieces of equipment.';
    end if;
    v_make := svc.clean_text(v_asset->>'make', 80);
    v_model := svc.clean_text(v_asset->>'model', 80);
    v_serial := svc.clean_text(v_asset->>'serial', 80);
    if v_make is null and v_model is null and v_serial is null then
      continue;
    end if;
    v_asset_id := null;
    if v_serial is not null then
      select id into v_asset_id
      from svc.assets
      where site_id = v_site and lower(serial) = lower(v_serial)
      limit 1;
    else
      select id into v_asset_id
      from svc.assets
      where site_id = v_site
        and serial is null
        and lower(coalesce(make, '')) = lower(coalesce(v_make, ''))
        and lower(coalesce(model, '')) = lower(coalesce(v_model, ''))
      limit 1;
    end if;
    if v_asset_id is null then
      insert into svc.assets (site_id, make, model, serial)
      values (v_site, v_make, v_model, v_serial)
      returning id into v_asset_id;
    else
      update svc.assets
      set make = coalesce(v_make, make),
          model = coalesce(v_model, model)
      where id = v_asset_id;
    end if;
    insert into svc.visit_assets (visit_id, asset_id)
    values (p_id, v_asset_id)
    on conflict do nothing;
  end loop;

  foreach v_resource in array v_ids loop
    v_block := svc.block_message(v_resource, v_day, p_id);
    if v_block is not null then
      raise exception 'app: %', v_block;
    end if;
  end loop;

  delete from svc.visit_assignees
  where visit_id = p_id and not (resource_id = any(v_ids));

  foreach v_resource in array v_ids loop
    insert into svc.visit_assignees (visit_id, resource_id, stop_order)
    values (p_id, v_resource, 999)
    on conflict (visit_id, resource_id) do nothing;
  end loop;

  select coalesce(array_agg(distinct listed.id), '{}') into v_touch
  from unnest(v_old_ids || v_ids) as listed(id);
  foreach v_resource in array v_touch loop
    perform svc.renumber_stops(v_resource, v_old_day, null, null);
    if v_day is distinct from v_old_day then
      perform svc.renumber_stops(v_resource, v_day, null, null);
    end if;
  end loop;

  return p_id;
end;
$$;

create or replace function public.service_visit_arrange(
  p_visit uuid,
  p_from uuid,
  p_to uuid,
  p_day date,
  p_index integer
)
returns void
language plpgsql
security definer
set search_path = svc, ops, public
as $$
declare
  v_row svc.visits%rowtype;
  v_count integer;
  v_block text;
  v_day date;
begin
  if not svc.office('edit') then
    raise exception 'app: You cannot change service visits.';
  end if;
  select * into v_row from svc.visits where id = p_visit for update;
  if v_row.id is null then
    raise exception 'app: That visit was not found.';
  end if;
  if p_from is not null and not exists (
    select 1 from svc.visit_assignees where visit_id = p_visit and resource_id = p_from
  ) then
    raise exception 'app: That visit was not found.';
  end if;
  if p_from is null and exists (
    select 1 from svc.visit_assignees where visit_id = p_visit
  ) then
    raise exception 'app: That visit was not found.';
  end if;
  if p_to is not null and not exists (
    select 1 from ops.resources
    where id = p_to and status = 'active' and resource_type in ('installer', 'helper', 'driver')
  ) then
    raise exception 'app: Choose a person.';
  end if;

  v_day := coalesce(p_day, v_row.visit_on);
  select count(*) into v_count from svc.visit_assignees where visit_id = p_visit;
  if v_day is distinct from v_row.visit_on and v_count > 1 then
    raise exception 'app: Change the date on the visit.';
  end if;

  if p_to is not null and (p_to is distinct from p_from or v_day is distinct from v_row.visit_on) then
    v_block := svc.block_message(p_to, v_day, p_visit);
    if v_block is not null then
      raise exception 'app: %', v_block;
    end if;
  end if;

  if v_day is distinct from v_row.visit_on then
    update svc.visits
    set visit_on = v_day,
        scheduled_for = svc.scheduled_at(v_day, window_start)
    where id = p_visit;
  end if;

  if p_from is not null and p_from is distinct from p_to then
    delete from svc.visit_assignees where visit_id = p_visit and resource_id = p_from;
    perform svc.renumber_stops(p_from, v_row.visit_on, null, null);
  elsif p_from is not null and v_day is distinct from v_row.visit_on then
    perform svc.renumber_stops(p_from, v_row.visit_on, null, null);
  end if;

  if p_to is not null then
    insert into svc.visit_assignees (visit_id, resource_id, stop_order)
    values (p_visit, p_to, 999)
    on conflict (visit_id, resource_id) do nothing;
    perform svc.renumber_stops(p_to, v_day, p_visit, p_index);
  end if;
end;
$$;

create or replace function public.service_visit_delete(p_visit uuid)
returns void
language plpgsql
security definer
set search_path = svc, public
as $$
declare
  v_day date;
  v_resource uuid;
begin
  if not svc.office('edit') then
    raise exception 'app: You cannot change service visits.';
  end if;
  select visit_on into v_day from svc.visits where id = p_visit for update;
  if v_day is null then
    raise exception 'app: That visit was not found.';
  end if;
  for v_resource in
    select resource_id from svc.visit_assignees where visit_id = p_visit
  loop
    delete from svc.visit_assignees where visit_id = p_visit and resource_id = v_resource;
    perform svc.renumber_stops(v_resource, v_day, null, null);
  end loop;
  delete from svc.visits where id = p_visit;
end;
$$;

create or replace function public.service_visit_set_progress(
  p_visit uuid,
  p_status text,
  p_note text,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = svc, public
as $$
declare
  v_status text := svc.clean_text(p_status, 20);
  v_note text := svc.clean_text(p_note, 2000);
  v_reason text := svc.clean_text(p_reason, 500);
begin
  if not (svc.visit_mine(p_visit) or svc.office('edit')) then
    raise exception 'app: You cannot update that visit.';
  end if;
  if v_status is null or v_status not in ('scheduled', 'en_route', 'on_site', 'done', 'incomplete') then
    raise exception 'app: Choose a status.';
  end if;
  if v_status = 'incomplete' and v_reason is null then
    raise exception 'app: Add a reason.';
  end if;
  update svc.visits
  set status = v_status,
      completion_note = v_note,
      incomplete_reason = case when v_status = 'incomplete' then v_reason else null end,
      arrived_at = case
        when v_status = 'on_site' then coalesce(arrived_at, now())
        else arrived_at
      end,
      completed_at = case
        when v_status in ('done', 'incomplete') then coalesce(completed_at, now())
        when v_status in ('scheduled', 'en_route') then null
        else completed_at
      end
  where id = p_visit;
  if not found then
    raise exception 'app: That visit was not found.';
  end if;
end;
$$;

create or replace function public.service_visit_photo_allowed(p_visit uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = svc, public
as $$
begin
  if auth.uid() is null then
    return false;
  end if;
  return exists (select 1 from svc.visits where id = p_visit)
    and (svc.visit_mine(p_visit) or svc.office('edit'));
end;
$$;

create or replace function public.service_visit_add_photo(p_visit uuid, p_file uuid)
returns uuid
language plpgsql
security definer
set search_path = svc, core, public
as $$
declare
  v_id uuid;
begin
  if not public.service_visit_photo_allowed(p_visit) then
    raise exception 'app: You cannot add a photo to that visit.';
  end if;
  if (select count(*) from svc.visit_photos where visit_id = p_visit) >= 8 then
    raise exception 'app: That visit already has 8 photos.';
  end if;
  if not exists (
    select 1 from core.files
    where id = p_file
      and bucket = 'job-sheets'
      and entity_schema = 'ops'
      and entity_table = 'service_visits'
      and entity_id = p_visit
      and kind = 'service_photo'
  ) then
    raise exception 'app: That photo could not be stored.';
  end if;
  insert into svc.visit_photos (visit_id, file_id, created_by)
  values (p_visit, p_file, auth.uid())
  on conflict (file_id) do update set visit_id = excluded.visit_id
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.service_people() from public, anon;
revoke all on function public.service_board(date, date) from public, anon;
revoke all on function public.service_visit_open(uuid) from public, anon;
revoke all on function public.service_visit_day() from public, anon;
revoke all on function public.service_visit_save(uuid, jsonb) from public, anon;
revoke all on function public.service_visit_arrange(uuid, uuid, uuid, date, integer) from public, anon;
revoke all on function public.service_visit_delete(uuid) from public, anon;
revoke all on function public.service_visit_set_progress(uuid, text, text, text) from public, anon;
revoke all on function public.service_visit_photo_allowed(uuid) from public, anon;
revoke all on function public.service_visit_add_photo(uuid, uuid) from public, anon;

grant execute on function public.service_people() to authenticated, service_role;
grant execute on function public.service_board(date, date) to authenticated, service_role;
grant execute on function public.service_visit_open(uuid) to authenticated, service_role;
grant execute on function public.service_visit_day() to authenticated, service_role;
grant execute on function public.service_visit_save(uuid, jsonb) to authenticated, service_role;
grant execute on function public.service_visit_arrange(uuid, uuid, uuid, date, integer) to authenticated, service_role;
grant execute on function public.service_visit_delete(uuid) to authenticated, service_role;
grant execute on function public.service_visit_set_progress(uuid, text, text, text) to authenticated, service_role;
grant execute on function public.service_visit_photo_allowed(uuid) to authenticated, service_role;
grant execute on function public.service_visit_add_photo(uuid, uuid) to authenticated, service_role;
