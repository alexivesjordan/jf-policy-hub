-- Rolls back 20261128600000_radar_planning_hubspot.sql.
-- Destructive: deletes the HubSpot push log, deal ids, and every planning/extraction column.

drop policy if exists radar_reminders_delete on public.radar_reminders;

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

delete from public.radar_hubspot_intents;
alter table public.radar_hubspot_intents drop constraint if exists radar_hubspot_intents_status_check;
alter table public.radar_hubspot_intents drop column if exists hubspot_deal_id;
alter table public.radar_hubspot_intents drop column if exists error_text;
alter table public.radar_hubspot_intents
  add constraint radar_hubspot_intents_status_check check (status = 'recorded');
alter table public.radar_hubspot_intents
  add constraint radar_hubspot_intents_opportunity unique (opportunity_id);
drop index if exists public.radar_hubspot_intents_opportunity_idx;

alter table public.radar_opportunities drop constraint if exists radar_opportunities_source_check;
alter table public.radar_opportunities drop constraint if exists radar_opportunities_type_check;
alter table public.radar_opportunities
  drop column if exists opportunity_type,
  drop column if exists decision_status,
  drop column if exists decision_date,
  drop column if exists lpa,
  drop column if exists site_address,
  drop column if exists postcode,
  drop column if exists applicant,
  drop column if exists agent,
  drop column if exists scope_summary,
  drop column if exists facility_types,
  drop column if exists contact_name,
  drop column if exists contact_email,
  drop column if exists contact_phone,
  drop column if exists hubspot_deal_id,
  drop column if exists hubspot_deal_url;
alter table public.radar_opportunities
  add constraint radar_opportunities_source_check
  check (source in ('find-a-tender', 'contracts-finder'));

alter table public.radar_settings drop constraint if exists radar_settings_exclusions;
alter table public.radar_settings
  drop column if exists exclusions,
  drop column if exists hubspot_pipeline_id,
  drop column if exists hubspot_stage_id,
  drop column if exists hubspot_owner_id,
  drop column if exists hubspot_portal_id;

drop function if exists public.radar_exclusions_ok(text[]);
