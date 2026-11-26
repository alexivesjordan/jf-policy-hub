-- Sales Opportunity Radar. New file only. Do not apply to production.

create or replace function public.radar_keywords_ok(p_keywords text[])
returns boolean
language sql
immutable
set search_path = public
as $$
  select p_keywords is not null
    and cardinality(p_keywords) between 1 and 40
    and not exists (
      select 1
      from unnest(p_keywords) as keyword
      where length(btrim(keyword)) < 2 or length(btrim(keyword)) > 60
    );
$$;

create or replace function public.radar_cpv_ok(p_codes text[])
returns boolean
language sql
immutable
set search_path = public
as $$
  select p_codes is not null
    and cardinality(p_codes) <= 30
    and not exists (
      select 1
      from unnest(p_codes) as code
      where code !~ '^[0-9]{2,8}$'
    );
$$;

create or replace function public.radar_bands_ok(p_bands jsonb)
returns boolean
language plpgsql
immutable
set search_path = public
as $$
declare
  band jsonb;
  min_value numeric;
  max_value numeric;
  points integer;
  label text;
begin
  if p_bands is null or jsonb_typeof(p_bands) <> 'array' or jsonb_array_length(p_bands) > 8 then
    return false;
  end if;
  for band in select value from jsonb_array_elements(p_bands)
  loop
    if jsonb_typeof(band) <> 'object' then return false; end if;
    label := btrim(coalesce(band->>'label', ''));
    if label = '' or length(label) > 40 then return false; end if;
    if coalesce(band->>'points', '') !~ '^[0-9]+$' then return false; end if;
    points := (band->>'points')::integer;
    if points > 40 then return false; end if;
    if band ? 'min' and jsonb_typeof(band->'min') <> 'null' then
      if jsonb_typeof(band->'min') <> 'number' then return false; end if;
      min_value := (band->>'min')::numeric;
      if min_value < 0 then return false; end if;
    else
      min_value := null;
    end if;
    if band ? 'max' and jsonb_typeof(band->'max') <> 'null' then
      if jsonb_typeof(band->'max') <> 'number' then return false; end if;
      max_value := (band->>'max')::numeric;
      if max_value < 0 then return false; end if;
    else
      max_value := null;
    end if;
    if min_value is not null and max_value is not null and min_value > max_value then
      return false;
    end if;
  end loop;
  return true;
end;
$$;

create table public.radar_settings (
  id boolean primary key default true check (id),
  keywords text[] not null,
  cpv_codes text[] not null default '{}',
  value_bands jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id) on delete set null,
  constraint radar_settings_keywords check (public.radar_keywords_ok(keywords)),
  constraint radar_settings_cpv check (public.radar_cpv_ok(cpv_codes)),
  constraint radar_settings_bands check (public.radar_bands_ok(value_bands))
);

create table public.radar_opportunities (
  id uuid primary key default gen_random_uuid(),
  source text not null check (source in ('find-a-tender', 'contracts-finder')),
  notice_id text not null check (length(btrim(notice_id)) > 0),
  ocid text,
  title text not null check (length(btrim(title)) > 0),
  buyer text not null default '',
  value_amount numeric(18, 2),
  value_currency text,
  deadline timestamptz,
  expected_award_date date,
  cpv_codes text[] not null default '{}',
  region text,
  url text not null check (url ~ '^https://'),
  raw_payload jsonb not null default '{}'::jsonb,
  score smallint not null default 0 check (score between 0 and 100),
  match_reasons text[] not null default '{}',
  status text not null default 'new' check (status in ('new', 'worth_pursuing', 'dismissed', 'pushed_to_hubspot')),
  dismiss_reason text,
  owner_id uuid references public.profiles (id) on delete set null,
  published_at timestamptz,
  description text not null default '',
  ingested_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint radar_opportunities_notice unique (source, notice_id),
  constraint radar_opportunities_value check (value_amount is null or value_amount >= 0),
  constraint radar_opportunities_currency check (value_currency is null or value_currency ~ '^[A-Z]{3}$'),
  constraint radar_opportunities_dismiss check (
    status <> 'dismissed'
    or (dismiss_reason is not null and length(btrim(dismiss_reason)) > 0)
  )
);

create table public.radar_hubspot_intents (
  id uuid primary key default gen_random_uuid(),
  opportunity_id uuid not null references public.radar_opportunities (id) on delete cascade,
  requested_by uuid references public.profiles (id) on delete set null,
  requested_at timestamptz not null default now(),
  status text not null default 'recorded' check (status = 'recorded'),
  payload jsonb not null default '{}'::jsonb,
  constraint radar_hubspot_intents_opportunity unique (opportunity_id)
);

create table public.radar_reminders (
  id uuid primary key default gen_random_uuid(),
  opportunity_id uuid not null references public.radar_opportunities (id) on delete cascade,
  kind text not null check (kind in ('deadline_7', 'deadline_2', 'award')),
  notified_user_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint radar_reminders_once unique (opportunity_id, kind)
);

comment on table public.radar_settings is 'Keyword, CPV and value-band scoring for Opportunity Radar.';
comment on table public.radar_opportunities is 'Public tender notices. Review state stays in Pulse. HubSpot owns deals.';
comment on table public.radar_hubspot_intents is 'Intent only. Pulse does not create HubSpot deals.';
comment on table public.radar_reminders is 'In-app deadline and award reminders already sent to the owner.';

create index radar_opportunities_queue_idx on public.radar_opportunities (status, score desc, deadline);
create index radar_opportunities_owner_idx on public.radar_opportunities (owner_id);
create index radar_opportunities_deadline_idx on public.radar_opportunities (deadline) where deadline is not null and status <> 'dismissed';
create index radar_opportunities_award_idx on public.radar_opportunities (expected_award_date) where expected_award_date is not null and status <> 'dismissed';
create index radar_settings_updated_by_idx on public.radar_settings (updated_by);
create index radar_hubspot_intents_requested_by_idx on public.radar_hubspot_intents (requested_by);
create index radar_reminders_user_idx on public.radar_reminders (notified_user_id);

create trigger radar_settings_touch
before update on public.radar_settings
for each row execute function public.touch_updated_at();

create trigger radar_opportunities_touch
before update on public.radar_opportunities
for each row execute function public.touch_updated_at();

create or replace function public.radar_guard_settings()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if not public.radar_keywords_ok(new.keywords) then
    raise exception 'app: Check the keywords.';
  end if;
  if not public.radar_cpv_ok(new.cpv_codes) then
    raise exception 'app: Check the CPV codes.';
  end if;
  if not public.radar_bands_ok(new.value_bands) then
    raise exception 'app: Check the value bands.';
  end if;
  return new;
end;
$$;

create trigger radar_settings_guard
before insert or update on public.radar_settings
for each row execute function public.radar_guard_settings();

create or replace function public.radar_guard_opportunity()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_role text := coalesce(auth.jwt() ->> 'role', '');
begin
  if tg_op = 'UPDATE' and v_role in ('authenticated', 'anon') then
    if new.source is distinct from old.source
      or new.notice_id is distinct from old.notice_id
      or new.ocid is distinct from old.ocid
      or new.title is distinct from old.title
      or new.buyer is distinct from old.buyer
      or new.value_amount is distinct from old.value_amount
      or new.value_currency is distinct from old.value_currency
      or new.deadline is distinct from old.deadline
      or new.expected_award_date is distinct from old.expected_award_date
      or new.cpv_codes is distinct from old.cpv_codes
      or new.region is distinct from old.region
      or new.url is distinct from old.url
      or new.raw_payload is distinct from old.raw_payload
      or new.score is distinct from old.score
      or new.match_reasons is distinct from old.match_reasons
      or new.published_at is distinct from old.published_at
      or new.description is distinct from old.description
      or new.ingested_at is distinct from old.ingested_at
    then
      raise exception 'app: Those fields are set by the tender feed.';
    end if;
  end if;

  if new.status = 'dismissed' and coalesce(btrim(new.dismiss_reason), '') = '' then
    raise exception 'app: A dismissed opportunity needs a reason.';
  end if;
  if new.status is distinct from 'dismissed' then
    new.dismiss_reason := null;
  end if;
  if new.status = 'pushed_to_hubspot' and not exists (
    select 1 from public.radar_hubspot_intents intent where intent.opportunity_id = new.id
  ) then
    raise exception 'app: Record a HubSpot intent before marking this pushed.';
  end if;
  if tg_op = 'UPDATE' and old.status = 'pushed_to_hubspot' and new.status is distinct from 'pushed_to_hubspot' then
    raise exception 'app: A pushed opportunity stays pushed. HubSpot owns the deal.';
  end if;
  if new.owner_id is not null and (tg_op = 'INSERT' or new.owner_id is distinct from old.owner_id) then
    if public.workspace_level(new.owner_id, 'sales') not in ('view', 'edit', 'admin') then
      raise exception 'app: Choose a sales colleague.';
    end if;
  end if;
  return new;
end;
$$;

create trigger radar_opportunities_guard
before insert or update on public.radar_opportunities
for each row execute function public.radar_guard_opportunity();

create or replace function public.radar_owner_choices()
returns table (id uuid, full_name text)
language sql
stable
security invoker
set search_path = public
as $$
  select p.id, coalesce(nullif(btrim(p.full_name), ''), p.email)
  from public.profiles p
  where (select public.workspace_can('sales', 'view'))
    and p.is_active
    and p.access_granted
    and p.deleted_at is null
    and public.workspace_level(p.id, 'sales') in ('view', 'edit', 'admin')
  order by 2;
$$;

alter table public.radar_settings enable row level security;
alter table public.radar_opportunities enable row level security;
alter table public.radar_hubspot_intents enable row level security;
alter table public.radar_reminders enable row level security;

create policy radar_settings_select on public.radar_settings
for select to authenticated
using ((select public.workspace_can('sales', 'view')));

create policy radar_settings_update on public.radar_settings
for update to authenticated
using ((select public.workspace_is_admin()))
with check ((select public.workspace_is_admin()));

create policy radar_opportunities_select on public.radar_opportunities
for select to authenticated
using ((select public.workspace_can('sales', 'view')));

create policy radar_opportunities_update on public.radar_opportunities
for update to authenticated
using ((select public.workspace_can('sales', 'edit')))
with check ((select public.workspace_can('sales', 'edit')));

create policy radar_intents_select on public.radar_hubspot_intents
for select to authenticated
using ((select public.workspace_can('sales', 'view')));

create policy radar_intents_insert on public.radar_hubspot_intents
for insert to authenticated
with check (
  (select public.workspace_can('sales', 'edit'))
  and requested_by = (select auth.uid())
  and exists (
    select 1 from public.radar_opportunities opportunity
    where opportunity.id = opportunity_id
  )
);

create policy radar_reminders_select on public.radar_reminders
for select to authenticated
using (
  (select public.workspace_can('sales', 'view'))
  and notified_user_id = (select auth.uid())
);

revoke all on table public.radar_settings from public, anon, authenticated;
revoke all on table public.radar_opportunities from public, anon, authenticated;
revoke all on table public.radar_hubspot_intents from public, anon, authenticated;
revoke all on table public.radar_reminders from public, anon, authenticated;

grant select on table public.radar_settings to authenticated;
grant update (keywords, cpv_codes, value_bands, updated_by) on table public.radar_settings to authenticated;
grant select on table public.radar_opportunities to authenticated;
grant update (status, dismiss_reason, owner_id) on table public.radar_opportunities to authenticated;
grant select, insert on table public.radar_hubspot_intents to authenticated;
grant select on table public.radar_reminders to authenticated;
grant all on table public.radar_settings to service_role;
grant all on table public.radar_opportunities to service_role;
grant all on table public.radar_hubspot_intents to service_role;
grant all on table public.radar_reminders to service_role;

revoke all on function public.radar_keywords_ok(text[]) from public, anon;
revoke all on function public.radar_cpv_ok(text[]) from public, anon;
revoke all on function public.radar_bands_ok(jsonb) from public, anon;
revoke all on function public.radar_guard_settings() from public, anon;
revoke all on function public.radar_guard_opportunity() from public, anon;
revoke all on function public.radar_owner_choices() from public, anon;
grant execute on function public.radar_keywords_ok(text[]) to authenticated, service_role;
grant execute on function public.radar_cpv_ok(text[]) to authenticated, service_role;
grant execute on function public.radar_bands_ok(jsonb) to authenticated, service_role;
grant execute on function public.radar_guard_settings() to authenticated, service_role;
grant execute on function public.radar_guard_opportunity() to authenticated, service_role;
grant execute on function public.radar_owner_choices() to authenticated, service_role;

insert into public.radar_settings (id, keywords, cpv_codes, value_bands)
values (
  true,
  array[
    'gym', 'gymnasium', 'fitness', 'leisure centre', 'leisure center', 'sports centre', 'sports center',
    'sports hall', 'exercise equipment', 'strength equipment', 'cardio', 'free weights', 'treadmill',
    'fitness suite', 'gym equipment', 'sports equipment', 'fitness equipment', 'weight training'
  ],
  array['3742', '3744'],
  '[
    {"label":"Small supply","min":5000,"max":25000,"points":8},
    {"label":"Core supply","min":25000,"max":150000,"points":15},
    {"label":"Major fit-out","min":150000,"max":1000000,"points":12}
  ]'::jsonb
);

alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications
  add constraint notifications_kind_check
  check (kind in ('proposal', 'auto_applied', 'decision', 'hr', 'radar'));
