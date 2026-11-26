-- Forward migration for planning approvals, exclusions, and HubSpot deals.
-- Does not edit 20261128100000_radar.sql. Do not apply to production from this branch.

create or replace function public.radar_exclusions_ok(p_words text[])
returns boolean
language sql
immutable
set search_path = public
as $$
  select p_words is not null
    and cardinality(p_words) <= 40
    and not exists (
      select 1
      from unnest(p_words) as word
      where length(btrim(word)) < 2 or length(btrim(word)) > 60
    );
$$;

alter table public.radar_settings
  add column exclusions text[] not null default '{}',
  add column hubspot_pipeline_id text,
  add column hubspot_stage_id text,
  add column hubspot_owner_id text,
  add column hubspot_portal_id text;

update public.radar_settings
set exclusions = array['flooring', 'roofing', 'cleaning', 'catering', 'lighting', 'householder']
where id;

alter table public.radar_settings
  add constraint radar_settings_exclusions check (public.radar_exclusions_ok(exclusions));

alter table public.radar_opportunities
  add column opportunity_type text not null default 'tender',
  add column decision_status text,
  add column decision_date date,
  add column lpa text,
  add column site_address text,
  add column postcode text,
  add column applicant text,
  add column agent text,
  add column scope_summary text not null default '',
  add column facility_types text[] not null default '{}',
  add column contact_name text,
  add column contact_email text,
  add column contact_phone text,
  add column hubspot_deal_id text,
  add column hubspot_deal_url text;

alter table public.radar_opportunities
  add constraint radar_opportunities_type_check check (opportunity_type in ('tender', 'planning'));

do $$
declare
  r record;
begin
  for r in
    select conname
    from pg_constraint
    where conrelid = 'public.radar_opportunities'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%find-a-tender%'
      and pg_get_constraintdef(oid) not ilike '%planit%'
  loop
    execute format('alter table public.radar_opportunities drop constraint %I', r.conname);
  end loop;
end $$;

alter table public.radar_opportunities
  add constraint radar_opportunities_source_check
  check (source in ('find-a-tender', 'contracts-finder', 'planit'));

alter table public.radar_hubspot_intents drop constraint if exists radar_hubspot_intents_opportunity;
alter table public.radar_hubspot_intents drop constraint if exists radar_hubspot_intents_status_check;
alter table public.radar_hubspot_intents
  add column hubspot_deal_id text,
  add column error_text text;
update public.radar_hubspot_intents set status = 'failed', error_text = 'Recorded before HubSpot deals were connected.' where status = 'recorded';
alter table public.radar_hubspot_intents
  add constraint radar_hubspot_intents_status_check check (status in ('succeeded', 'failed'));
create index radar_hubspot_intents_opportunity_idx on public.radar_hubspot_intents (opportunity_id);

comment on table public.radar_hubspot_intents is 'HubSpot push log. One row per attempt. Pulse does not call HubSpot unless a token is configured.';

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
  if not public.radar_exclusions_ok(new.exclusions) then
    raise exception 'app: Check the exclusion words.';
  end if;
  return new;
end;
$$;

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
      or new.opportunity_type is distinct from old.opportunity_type
      or new.decision_status is distinct from old.decision_status
      or new.decision_date is distinct from old.decision_date
      or new.lpa is distinct from old.lpa
      or new.site_address is distinct from old.site_address
      or new.postcode is distinct from old.postcode
      or new.applicant is distinct from old.applicant
      or new.agent is distinct from old.agent
      or new.scope_summary is distinct from old.scope_summary
      or new.facility_types is distinct from old.facility_types
      or new.contact_name is distinct from old.contact_name
      or new.contact_email is distinct from old.contact_email
      or new.contact_phone is distinct from old.contact_phone
    then
      raise exception 'app: Those fields are set by the feed.';
    end if;
  end if;

  if new.status = 'dismissed' and coalesce(btrim(new.dismiss_reason), '') = '' then
    raise exception 'app: A dismissed opportunity needs a reason.';
  end if;
  if new.status is distinct from 'dismissed' then
    new.dismiss_reason := null;
  end if;
  if new.status = 'pushed_to_hubspot' and (
    coalesce(btrim(new.hubspot_deal_id), '') = ''
    or not exists (
      select 1 from public.radar_hubspot_intents intent
      where intent.opportunity_id = new.id and intent.status = 'succeeded'
    )
  ) then
    raise exception 'app: Create the HubSpot deal before marking this pushed.';
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

create policy radar_reminders_delete on public.radar_reminders
for delete to authenticated
using ((select public.workspace_can('sales', 'edit')));

grant update (exclusions, hubspot_pipeline_id, hubspot_stage_id, hubspot_owner_id, hubspot_portal_id)
  on table public.radar_settings to authenticated;
grant update (hubspot_deal_id, hubspot_deal_url) on table public.radar_opportunities to authenticated;
grant delete on table public.radar_reminders to authenticated;
grant execute on function public.radar_exclusions_ok(text[]) to authenticated, service_role;
revoke all on function public.radar_exclusions_ok(text[]) from public, anon;
