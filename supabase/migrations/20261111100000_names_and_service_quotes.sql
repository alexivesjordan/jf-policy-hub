-- First and last names, plus warranties and servicing quotes.
-- full_name stays as a generated display value. Email-only rows stay blank.

alter table public.profiles
  add column if not exists first_name text not null default '',
  add column if not exists last_name text not null default '';

update public.profiles
set first_name = case
      when nullif(btrim(coalesce(full_name, '')), '') is null then ''
      when position(' ' in btrim(full_name)) = 0 then btrim(full_name)
      else btrim(split_part(btrim(full_name), ' ', 1))
    end,
    last_name = case
      when nullif(btrim(coalesce(full_name, '')), '') is null then ''
      when position(' ' in btrim(full_name)) = 0 then ''
      else btrim(substring(btrim(full_name) from position(' ' in btrim(full_name)) + 1))
    end;

alter table public.profiles drop column full_name;
alter table public.profiles
  add column full_name text generated always as (nullif(btrim(first_name || ' ' || last_name), '')) stored;

comment on column public.profiles.full_name is
  'Derived from first_name and last_name for display. Do not write it.';

alter table public.access_grants
  add column if not exists first_name text not null default '',
  add column if not exists last_name text not null default '';

update public.access_grants
set first_name = case
      when nullif(btrim(coalesce(full_name, '')), '') is null then ''
      when position(' ' in btrim(full_name)) = 0 then btrim(full_name)
      else btrim(split_part(btrim(full_name), ' ', 1))
    end,
    last_name = case
      when nullif(btrim(coalesce(full_name, '')), '') is null then ''
      when position(' ' in btrim(full_name)) = 0 then ''
      else btrim(substring(btrim(full_name) from position(' ' in btrim(full_name)) + 1))
    end;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  cleaned_email text := lower(trim(coalesce(new.email, '')));
  assigned_role text := 'staff';
  granted boolean := false;
  people_on boolean := false;
  v_first text := nullif(btrim(coalesce(new.raw_user_meta_data->>'first_name', '')), '');
  v_last text := nullif(btrim(coalesce(new.raw_user_meta_data->>'last_name', '')), '');
  display_name text := nullif(btrim(coalesce(new.raw_user_meta_data->>'full_name', '')), '');
  grant_row public.access_grants%rowtype;
begin
  if v_first is null and display_name is not null then
    if position(' ' in display_name) = 0 then
      v_first := display_name;
    else
      v_first := btrim(split_part(display_name, ' ', 1));
      v_last := coalesce(v_last, btrim(substring(display_name from position(' ' in display_name) + 1)));
    end if;
  end if;

  if cleaned_email = 'alex.ives@jordanfitness.com' then
    assigned_role := 'admin';
    granted := true;
    people_on := true;
    v_first := coalesce(v_first, 'Alex');
    v_last := coalesce(v_last, 'Ives');
  elsif cleaned_email ~ '^[^@[:space:]]+@jordanfitness\.com$' then
    select * into grant_row from public.access_grants where email = cleaned_email;
    if found then
      assigned_role := grant_row.role;
      granted := true;
      people_on := grant_row.people_enabled;
      v_first := coalesce(v_first, nullif(grant_row.first_name, ''));
      v_last := coalesce(v_last, nullif(grant_row.last_name, ''));
    end if;
  end if;

  insert into public.profiles (id, email, first_name, last_name, role, is_active, access_granted, last_sign_in_at)
  values (new.id, cleaned_email, coalesce(v_first, ''), coalesce(v_last, ''), assigned_role, true, granted, new.last_sign_in_at)
  on conflict (id) do nothing;

  perform private.seed_module_access(new.id, people_on);
  return new;
end;
$$;

create or replace function public.workspace_directory()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.workspace_is_admin() then
    raise exception 'app: Only a workspace owner or admin can open this.';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', p.id,
      'email', p.email,
      'first_name', p.first_name,
      'last_name', p.last_name,
      'full_name', p.full_name,
      'role', p.role,
      'workspace_role', p.workspace_role,
      'access_mode', p.access_mode,
      'is_active', p.is_active,
      'teams', coalesce((
        select jsonb_agg(t.name order by t.name)
        from public.workspace_team_members m
        join public.workspace_teams t on t.id = m.team_id
        where m.profile_id = p.id
      ), '[]'::jsonb),
      'effective', jsonb_build_object(
        'people', public.workspace_level(p.id, 'people'),
        'service', public.workspace_level(p.id, 'service'),
        'supply', public.workspace_level(p.id, 'supply'),
        'operations', public.workspace_level(p.id, 'operations'),
        'sales', public.workspace_level(p.id, 'sales'),
        'finance', public.workspace_level(p.id, 'finance')
      )
    ) order by p.last_name, p.first_name, p.email)
    from public.profiles p
  ), '[]'::jsonb);
end;
$$;

drop function if exists public.workspace_prepare_invite(text, text, text);

create or replace function public.workspace_prepare_invite(
  p_email text,
  p_first_name text,
  p_last_name text,
  p_workspace_role text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := lower(trim(coalesce(p_email, '')));
  v_first text := nullif(btrim(coalesce(p_first_name, '')), '');
  v_last text := nullif(btrim(coalesce(p_last_name, '')), '');
  v_workspace text := p_workspace_role;
  v_role text;
  v_user_id uuid;
  v_existing boolean := false;
  v_full text;
begin
  if not public.workspace_is_admin() then
    raise exception 'app: Only a workspace owner or admin can invite someone.';
  end if;
  if v_email !~ '^[^@[:space:]]+@jordanfitness\.com$' then
    raise exception 'app: Use a @jordanfitness.com email address.';
  end if;
  if v_first is null or v_last is null or char_length(v_first) > 80 or char_length(v_last) > 80 then
    raise exception 'app: Enter a first and last name.';
  end if;
  if v_workspace not in ('owner', 'admin', 'manager', 'member', 'viewer') then
    raise exception 'app: Choose a workspace role.';
  end if;
  v_role := case
    when v_workspace in ('owner', 'admin') then 'admin'
    when v_workspace = 'manager' then 'approver'
    else 'staff'
  end;
  v_full := v_first || ' ' || v_last;

  insert into public.access_grants (email, full_name, first_name, last_name, role, people_enabled, invited_by)
  values (v_email, v_full, v_first, v_last, v_role, true, auth.uid())
  on conflict (email) do update
    set full_name = excluded.full_name,
        first_name = excluded.first_name,
        last_name = excluded.last_name,
        role = excluded.role,
        people_enabled = true,
        invited_by = excluded.invited_by,
        updated_at = now();

  select id into v_user_id from auth.users where lower(email) = v_email limit 1;
  if v_user_id is not null then
    v_existing := true;
    update public.profiles
    set first_name = v_first,
        last_name = v_last,
        role = v_role,
        workspace_role = v_workspace,
        access_mode = 'follow',
        is_active = true,
        access_granted = true
    where id = v_user_id;
    perform private.seed_module_access(v_user_id, true);
  end if;

  perform public.write_access_audit(
    'user.invited', 'profile', v_user_id, null,
    jsonb_build_object('email', v_email, 'first_name', v_first, 'last_name', v_last, 'workspace_role', v_workspace, 'already_registered', v_existing)
  );

  return jsonb_build_object('email', v_email, 'role', v_role, 'already_registered', v_existing, 'user_id', v_user_id);
end;
$$;

revoke all on function public.workspace_prepare_invite(text, text, text, text) from public, anon;
grant execute on function public.workspace_prepare_invite(text, text, text, text) to authenticated, service_role;

create or replace function public.save_person_name(p_profile uuid, p_first_name text, p_last_name text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_first text := nullif(btrim(coalesce(p_first_name, '')), '');
  v_last text := nullif(btrim(coalesce(p_last_name, '')), '');
  v_before jsonb;
  v_after jsonb;
begin
  if auth.uid() is null then
    raise exception 'app: You need to be signed in.';
  end if;
  if p_profile is distinct from auth.uid() and not public.workspace_is_admin() then
    raise exception 'app: You can only change your own name.';
  end if;
  if v_first is null or v_last is null or char_length(v_first) > 80 or char_length(v_last) > 80 then
    raise exception 'app: Enter a first and last name.';
  end if;
  select jsonb_build_object('first_name', first_name, 'last_name', last_name) into v_before
  from public.profiles where id = p_profile;
  if v_before is null then
    raise exception 'app: That person could not be found.';
  end if;
  update public.profiles set first_name = v_first, last_name = v_last where id = p_profile;
  v_after := jsonb_build_object('first_name', v_first, 'last_name', v_last);
  perform public.write_access_audit('user.name_changed', 'profile', p_profile, v_before, v_after);
end;
$$;

revoke all on function public.save_person_name(uuid, text, text) from public, anon;
grant execute on function public.save_person_name(uuid, text, text) to authenticated, service_role;

-- Warranties and servicing. Rates are versioned. Reps do not edit them.
create table ops.service_rate_versions (
  id uuid primary key default gen_random_uuid(),
  version integer not null unique,
  effective_on date not null,
  callout_gbp numeric(12,2) not null,
  per_machine_gbp numeric(12,2) not null,
  uplift numeric(8,4) not null,
  twice_yearly_factor numeric(8,4) not null,
  cardio_rate numeric(8,4) not null,
  strength_rate numeric(8,4) not null,
  rack_rate numeric(8,4) not null,
  extension_factor numeric(8,4) not null,
  per_site_gbp numeric(12,2) not null,
  bundle_incentive_gbp numeric(12,2) not null,
  portfolio_factor numeric(8,4) not null default 0.90,
  label text not null,
  change_reason text,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

insert into ops.service_rate_versions (
  version, effective_on, callout_gbp, per_machine_gbp, uplift, twice_yearly_factor,
  cardio_rate, strength_rate, rack_rate, extension_factor, per_site_gbp, bundle_incentive_gbp,
  portfolio_factor, label, change_reason
) values (
  1, date '2026-11-11', 99, 59, 1.08, 0.92,
  0.05, 0.03, 0.02, 1.30, 150, 195,
  0.90, '2026-11-11-standalone-v1', 'November 2026 drafting baseline'
);

create table ops.service_classification_rules (
  id uuid primary key default gen_random_uuid(),
  match_kind text not null check (match_kind in ('sku', 'description_contains', 'category_name')),
  match_value text not null,
  category text not null,
  priority integer not null default 100,
  note text,
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now(),
  unique (match_kind, match_value)
);

create table ops.quote_ingest_cache (
  id uuid primary key default gen_random_uuid(),
  source text not null check (source in ('cin7', 'pdf', 'fixture')),
  cache_key text not null unique,
  quote_number text,
  payload jsonb not null,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create table ops.service_quotes (
  id uuid primary key default gen_random_uuid(),
  ingest_id uuid references ops.quote_ingest_cache (id) on delete set null,
  rate_version_id uuid not null references ops.service_rate_versions (id),
  quote_number text not null,
  customer_name text not null,
  prices jsonb not null,
  audit jsonb not null,
  created_by uuid references public.profiles (id) on delete set null,
  proposal_path text,
  created_at timestamptz not null default now()
);

alter table ops.service_rate_versions enable row level security;
alter table ops.service_classification_rules enable row level security;
alter table ops.quote_ingest_cache enable row level security;
alter table ops.service_quotes enable row level security;

revoke all on ops.service_rate_versions, ops.service_classification_rules, ops.quote_ingest_cache, ops.service_quotes from public, anon, authenticated;
grant select on ops.service_rate_versions, ops.service_classification_rules, ops.service_quotes to authenticated;
grant all on ops.service_rate_versions, ops.service_classification_rules, ops.quote_ingest_cache, ops.service_quotes to service_role;

create policy "Owners and admins read service rates"
on ops.service_rate_versions for select to authenticated
using (public.workspace_is_admin());

create policy "Owners and admins read classification rules"
on ops.service_classification_rules for select to authenticated
using (public.workspace_is_admin());

create policy "Owners admins and operations edit read service quotes"
on ops.service_quotes for select to authenticated
using (public.workspace_is_admin() or public.workspace_can('operations', 'edit'));

insert into storage.buckets (id, name, public, file_size_limit)
values ('service-proposals', 'service-proposals', false, 20971520)
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit;

create or replace function public.service_can_see_flags()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.workspace_is_admin() or public.workspace_can('operations', 'edit');
$$;

create or replace function public.service_can_price()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.workspace_can('sales', 'view')
      or public.workspace_can('operations', 'view')
      or public.workspace_is_admin();
$$;

create or replace function public.service_current_rates()
returns jsonb
language plpgsql
stable
security definer
set search_path = ops, public
as $$
begin
  if not public.service_can_price() then
    raise exception 'app: You cannot open service pricing.';
  end if;
  return (
    select to_jsonb(r) from ops.service_rate_versions r
    order by effective_on desc, version desc
    limit 1
  );
end;
$$;

create or replace function public.service_list_rules()
returns jsonb
language plpgsql
stable
security definer
set search_path = ops, public
as $$
begin
  if not public.service_can_price() then
    raise exception 'app: You cannot open service pricing.';
  end if;
  return coalesce((
    select jsonb_agg(to_jsonb(r) order by r.priority, r.match_value)
    from ops.service_classification_rules r
  ), '[]'::jsonb);
end;
$$;

create or replace function public.service_save_rates(
  p_effective_on date,
  p_callout numeric,
  p_per_machine numeric,
  p_uplift numeric,
  p_twice numeric,
  p_cardio numeric,
  p_strength numeric,
  p_rack numeric,
  p_extension numeric,
  p_per_site numeric,
  p_bundle numeric,
  p_portfolio numeric,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ops, public
as $$
declare
  v_version integer;
  v_id uuid;
begin
  if not public.workspace_is_admin() then
    raise exception 'app: Only an owner or admin can change service rates.';
  end if;
  if p_effective_on is null or nullif(btrim(coalesce(p_reason, '')), '') is null then
    raise exception 'app: Give the rate card a date and a reason.';
  end if;
  select coalesce(max(version), 0) + 1 into v_version from ops.service_rate_versions;
  insert into ops.service_rate_versions (
    version, effective_on, callout_gbp, per_machine_gbp, uplift, twice_yearly_factor,
    cardio_rate, strength_rate, rack_rate, extension_factor, per_site_gbp, bundle_incentive_gbp,
    portfolio_factor, label, change_reason, created_by
  ) values (
    v_version, p_effective_on, p_callout, p_per_machine, p_uplift, p_twice,
    p_cardio, p_strength, p_rack, p_extension, p_per_site, p_bundle,
    p_portfolio, 'v' || v_version::text || '-' || p_effective_on::text, btrim(p_reason), auth.uid()
  ) returning id into v_id;
  return jsonb_build_object('id', v_id, 'version', v_version);
end;
$$;

create or replace function public.service_upsert_rule(
  p_match_kind text,
  p_match_value text,
  p_category text,
  p_priority integer,
  p_note text
)
returns uuid
language plpgsql
security definer
set search_path = ops, public
as $$
declare
  v_id uuid;
  v_value text := nullif(btrim(coalesce(p_match_value, '')), '');
begin
  if not public.workspace_is_admin() then
    raise exception 'app: Only an owner or admin can change classification.';
  end if;
  if p_match_kind not in ('sku', 'description_contains', 'category_name') or v_value is null then
    raise exception 'app: Choose what the rule matches.';
  end if;
  if p_category not in (
    'jordan_cardio', 'jordan_cardio_unverified', 'concept2_cardio', 'other_cardio_unverified',
    'strength_machine', 'cable_or_power_rack', 'adjustable_bench', 'unresolved_dhz',
    'storage_rack', 'loose_accessory', 'flooring', 'delivery_install', 'unknown_product'
  ) then
    raise exception 'app: That category is not on the service list.';
  end if;
  insert into ops.service_classification_rules (match_kind, match_value, category, priority, note, updated_by)
  values (p_match_kind, v_value, p_category, coalesce(p_priority, 100), nullif(btrim(coalesce(p_note, '')), ''), auth.uid())
  on conflict (match_kind, match_value) do update
    set category = excluded.category,
        priority = excluded.priority,
        note = excluded.note,
        updated_by = auth.uid(),
        updated_at = now()
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.service_get_ingest(p_key text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ops, public
as $$
declare
  v_payload jsonb;
begin
  if not public.service_can_price() then
    raise exception 'app: You cannot read a quote.';
  end if;
  select payload into v_payload from ops.quote_ingest_cache where cache_key = p_key;
  return v_payload;
end;
$$;

create or replace function public.service_put_ingest(
  p_source text,
  p_key text,
  p_quote_number text,
  p_payload jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ops, public
as $$
declare
  v_id uuid;
begin
  if not (public.workspace_can('sales', 'view') or public.workspace_can('operations', 'view')) then
    raise exception 'app: You cannot read a quote.';
  end if;
  insert into ops.quote_ingest_cache (source, cache_key, quote_number, payload, created_by)
  values (p_source, p_key, p_quote_number, p_payload, auth.uid())
  on conflict (cache_key) do update set quote_number = excluded.quote_number
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.service_save_quote(
  p_ingest_id uuid,
  p_rate_version_id uuid,
  p_quote_number text,
  p_customer_name text,
  p_prices jsonb,
  p_audit jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ops, public
as $$
declare
  v_id uuid;
begin
  if not (public.workspace_can('sales', 'edit') or public.workspace_can('operations', 'edit')) then
    raise exception 'app: You cannot save a service quote.';
  end if;
  insert into ops.service_quotes (ingest_id, rate_version_id, quote_number, customer_name, prices, audit, created_by)
  values (p_ingest_id, p_rate_version_id, p_quote_number, p_customer_name, p_prices, p_audit, auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.service_read_quote(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ops, public
as $$
declare
  v_row ops.service_quotes%rowtype;
begin
  select * into v_row from ops.service_quotes where id = p_id;
  if v_row.id is null then
    return null;
  end if;
  if v_row.created_by is distinct from auth.uid()
     and not public.workspace_is_admin()
     and not public.workspace_can('operations', 'edit') then
    raise exception 'app: That quote was not found.';
  end if;
  return jsonb_build_object(
    'id', v_row.id,
    'quote_number', v_row.quote_number,
    'customer_name', v_row.customer_name,
    'prices', v_row.prices,
    'proposal_path', v_row.proposal_path,
    'audit', case when public.service_can_see_flags() then v_row.audit else null end
  );
end;
$$;

create or replace function public.service_set_proposal_path(p_quote_id uuid, p_path text)
returns void
language plpgsql
security definer
set search_path = ops, public
as $$
begin
  if not (public.workspace_can('sales', 'edit') or public.workspace_can('operations', 'edit')) then
    raise exception 'app: You cannot store that proposal.';
  end if;
  update ops.service_quotes
  set proposal_path = p_path
  where id = p_quote_id
    and (created_by = auth.uid() or public.workspace_is_admin());
  if not found then
    raise exception 'app: That quote was not found.';
  end if;
end;
$$;

revoke all on function public.service_can_price() from public, anon;
revoke all on function public.service_can_see_flags() from public, anon;
revoke all on function public.service_current_rates() from public, anon;
revoke all on function public.service_list_rules() from public, anon;
revoke all on function public.service_save_rates(date, numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric, text) from public, anon;
revoke all on function public.service_upsert_rule(text, text, text, integer, text) from public, anon;
revoke all on function public.service_get_ingest(text) from public, anon;
revoke all on function public.service_put_ingest(text, text, text, jsonb) from public, anon;
revoke all on function public.service_save_quote(uuid, uuid, text, text, jsonb, jsonb) from public, anon;
revoke all on function public.service_read_quote(uuid) from public, anon;
revoke all on function public.service_set_proposal_path(uuid, text) from public, anon;

grant execute on function public.service_can_price() to authenticated, service_role;
grant execute on function public.service_can_see_flags() to authenticated, service_role;
grant execute on function public.service_current_rates() to authenticated, service_role;
grant execute on function public.service_list_rules() to authenticated, service_role;
grant execute on function public.service_save_rates(date, numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric, text) to authenticated, service_role;
grant execute on function public.service_upsert_rule(text, text, text, integer, text) to authenticated, service_role;
grant execute on function public.service_get_ingest(text) to authenticated, service_role;
grant execute on function public.service_put_ingest(text, text, text, jsonb) to authenticated, service_role;
grant execute on function public.service_save_quote(uuid, uuid, text, text, jsonb, jsonb) to authenticated, service_role;
grant execute on function public.service_read_quote(uuid) to authenticated, service_role;
grant execute on function public.service_set_proposal_path(uuid, text) to authenticated, service_role;

create or replace function public.admin_prepare_invite(
  p_email text,
  p_full_name text,
  p_role text,
  p_people_enabled boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := lower(trim(coalesce(p_email, '')));
  v_name text := nullif(btrim(coalesce(p_full_name, '')), '');
  v_first text;
  v_last text;
  v_role text := p_role;
  v_people boolean := coalesce(p_people_enabled, true);
  v_user_id uuid;
  v_existing boolean := false;
begin
  if not public.is_admin() then
    raise exception 'app: Only an administrator can invite someone.';
  end if;
  if v_email !~ '^[^@[:space:]]+@jordanfitness\.com$' then
    raise exception 'app: Use a @jordanfitness.com email address.';
  end if;
  if v_role not in ('admin', 'approver', 'staff') then
    raise exception 'app: Choose a role.';
  end if;
  if v_name is null or position(' ' in v_name) = 0 then
    raise exception 'app: Enter a first and last name.';
  end if;
  v_first := btrim(split_part(v_name, ' ', 1));
  v_last := btrim(substring(v_name from position(' ' in v_name) + 1));
  if v_email = 'alex.ives@jordanfitness.com' then
    v_role := 'admin';
    v_people := true;
  end if;

  insert into public.access_grants (email, full_name, first_name, last_name, role, people_enabled, invited_by)
  values (v_email, v_first || ' ' || v_last, v_first, v_last, v_role, v_people, auth.uid())
  on conflict (email) do update
    set full_name = excluded.full_name,
        first_name = excluded.first_name,
        last_name = excluded.last_name,
        role = excluded.role,
        people_enabled = excluded.people_enabled,
        invited_by = excluded.invited_by,
        updated_at = now();

  select id into v_user_id from auth.users where lower(email) = v_email limit 1;
  if v_user_id is not null then
    v_existing := true;
    update public.profiles
    set first_name = v_first,
        last_name = v_last,
        role = v_role,
        is_active = true,
        access_granted = true
    where id = v_user_id;
    perform private.seed_module_access(v_user_id, v_people);
  end if;

  perform public.write_access_audit(
    'user.invited', 'profile', v_user_id, null,
    jsonb_build_object('email', v_email, 'first_name', v_first, 'last_name', v_last, 'role', v_role, 'people_enabled', v_people, 'already_registered', v_existing)
  );

  return jsonb_build_object('email', v_email, 'role', v_role, 'already_registered', v_existing, 'user_id', v_user_id);
end;
$$;
