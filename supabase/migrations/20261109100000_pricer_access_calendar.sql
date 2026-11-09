-- Pricer persistence, access-form submit, fixture resources, and fixture booking.
-- No Cin7 network calls. Fixture quote numbers must start with FIXTURE-.

insert into ops.resources (id, resource_type, name, has_licence, insured, status, notes)
values
  ('f3000000-0000-4000-8000-000000000001', 'installer', 'FIXTURE — Lewis', true, false, 'active', 'Planning seed. Licensed driver.'),
  ('f3000000-0000-4000-8000-000000000002', 'installer', 'FIXTURE — Christian', false, false, 'active', 'Planning seed. No van licence.'),
  ('f3000000-0000-4000-8000-000000000003', 'helper', 'FIXTURE — Ben', true, false, 'active', 'Backup driver. Not bookable as a driver until insured.'),
  ('f3000000-0000-4000-8000-000000000004', 'helper', 'FIXTURE — Peter', true, false, 'active', 'Backup driver. Not bookable as a driver until insured.'),
  ('f3000000-0000-4000-8000-000000000005', 'van', 'FIXTURE — Transit-sized van', false, false, 'active', 'About 2.6 m load length. No tail-lift. Payload cap 500 kg until confirmed.'),
  ('f3000000-0000-4000-8000-000000000006', 'van', 'FIXTURE — VW Crafter LWB', false, false, 'active', 'No tail-lift. Payload cap 500 kg until the variant is confirmed.'),
  ('f3000000-0000-4000-8000-000000000007', 'climber', 'FIXTURE — Stanley Sprinter 275', false, false, 'active', '275 kg stair climber. One bookable unit.');

create or replace function public.orbit_record_fixture_quote(
  p_cin7_number text,
  p_customer_name text,
  p_customer_ref text,
  p_segment text,
  p_customer_type text,
  p_postcode text,
  p_mode text,
  p_inputs jsonb,
  p_finality text,
  p_provisional jsonb,
  p_internal_cost numeric,
  p_customer_price numeric,
  p_markup numeric,
  p_lines jsonb,
  p_big_install boolean,
  p_triggers text[]
)
returns jsonb
language plpgsql
security definer
set search_path = ops, core, public
as $$
declare
  v_customer uuid;
  v_site uuid;
  v_job uuid;
  v_quote uuid;
  v_version uuid;
  v_line jsonb;
  v_show_cost boolean;
begin
  if auth.uid() is null then
    raise exception 'app: You need to be signed in.';
  end if;
  if not core.has_ops_role(array['sales', 'install_lead', 'admin_owner']) then
    raise exception 'app: You cannot price a quote.';
  end if;
  if p_cin7_number is null or p_cin7_number not like 'FIXTURE-%' then
    raise exception 'app: Only FIXTURE quotes can be priced until Cin7 is connected.';
  end if;
  if p_mode not in ('A', 'B') then
    raise exception 'app: That pricing mode is not available.';
  end if;
  if p_finality not in ('final', 'provisional') then
    raise exception 'app: That quote status is not valid.';
  end if;

  insert into ops.customers (cin7_id, name, segment, customer_type, owner_rep_id)
  values (
    p_customer_ref,
    p_customer_name,
    nullif(p_segment, '')::ops.customer_segment,
    nullif(p_customer_type, '')::ops.customer_type,
    case when core.has_ops_role(array['sales']) and not core.has_ops_role(array['install_lead', 'admin_owner']) then auth.uid() else null end
  )
  on conflict (cin7_id) do update
    set name = excluded.name,
        segment = excluded.segment,
        customer_type = excluded.customer_type
  where ops.customers.cin7_id like 'FIXTURE-%'
  returning id into v_customer;

  select id into v_site
  from ops.sites
  where customer_id = v_customer and postcode = upper(trim(p_postcode))
  limit 1;
  if v_site is null then
    insert into ops.sites (customer_id, name, postcode)
    values (v_customer, 'FIXTURE site', upper(trim(p_postcode)))
    returning id into v_site;
  end if;

  select id into v_job from ops.install_jobs where cin7_number = p_cin7_number;
  if v_job is null then
    insert into ops.install_jobs (
      cin7_number, cin7_quote_number, customer_id, site_id, owner_rep_id, status,
      big_install, big_install_triggers, pricer_version
    ) values (
      p_cin7_number, p_cin7_number, v_customer, v_site,
      case when core.has_ops_role(array['sales']) and not core.has_ops_role(array['install_lead', 'admin_owner']) then auth.uid() else null end,
      'priced',
      coalesce(p_big_install, false),
      coalesce(p_triggers, '{}'),
      'v2.5'
    )
    returning id into v_job;
  else
    update ops.install_jobs
    set big_install = coalesce(p_big_install, big_install),
        big_install_triggers = coalesce(p_triggers, big_install_triggers),
        pricer_version = 'v2.5',
        site_id = coalesce(site_id, v_site)
    where id = v_job;
  end if;

  delete from ops.job_lines where job_id = v_job;
  for v_line in select value from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb))
  loop
    insert into ops.job_lines (job_id, cin7_sku, description, qty, category, provisional)
    values (
      v_job,
      '',
      v_line->>'productName',
      greatest((v_line->>'qty')::numeric, 0.01),
      v_line->>'category',
      coalesce((v_line->>'provisional')::boolean, false)
    );
  end loop;

  select id into v_version from ops.effort_table_versions where version_label = 'v2.5' limit 1;

  insert into ops.quote_versions (
    job_id, mode, inputs, pricer_version, effort_table_version_id,
    pricing_settings_version, internal_cost, customer_price, markup_applied,
    segment, finality, provisional_items, created_by
  ) values (
    v_job,
    p_mode::ops.quote_mode,
    coalesce(p_inputs, '{}'::jsonb),
    'v2.5',
    v_version,
    (select max(version) from ops.pricing_settings),
    p_internal_cost,
    p_customer_price,
    p_markup,
    nullif(p_segment, '')::ops.customer_segment,
    p_finality,
    coalesce(p_provisional, '[]'::jsonb),
    auth.uid()
  )
  returning id into v_quote;

  if p_internal_cost is not null then
    insert into ops.quote_costs (quote_version_id, cost_breakdown, margin_floor_price)
    values (
      v_quote,
      jsonb_build_object('internal_cost', p_internal_cost),
      null
    );
  end if;

  v_show_cost := core.has_ops_role(array['install_lead', 'admin_owner']);
  return jsonb_build_object(
    'job_id', v_job,
    'quote_id', v_quote,
    'customer_price', p_customer_price,
    'finality', p_finality,
    'internal_cost', case when v_show_cost then p_internal_cost else null end
  );
end;
$$;

create or replace function public.orbit_access_preview(p_token_hash text)
returns jsonb
language plpgsql
security definer
set search_path = ops, core, public
as $$
declare
  v_token jsonb;
  v_job uuid;
  v_terms ops.terms_versions%rowtype;
begin
  if coalesce(auth.role(), '') is distinct from 'service_role' then
    raise exception 'app: You cannot open that form.';
  end if;
  v_token := public.orbit_resolve_token(p_token_hash);
  if v_token is null or v_token->>'purpose' is distinct from 'access_form' then
    return null;
  end if;
  v_job := (v_token->>'entity_id')::uuid;
  select * into v_terms from ops.terms_versions order by created_at desc limit 1;
  return jsonb_build_object(
    'job_id', v_job,
    'customer_name', (
      select c.name from ops.install_jobs j join ops.customers c on c.id = j.customer_id where j.id = v_job
    ),
    'postcode', (
      select s.postcode from ops.install_jobs j left join ops.sites s on s.id = j.site_id where j.id = v_job
    ),
    'terms', case when v_terms.id is null then null else jsonb_build_object(
      'id', v_terms.id,
      'version_label', v_terms.version_label,
      'lines', v_terms.charges_grid->'lines'
    ) end
  );
end;
$$;

create or replace function public.orbit_submit_access_form(
  p_token_hash text,
  p_answers jsonb,
  p_media_ids uuid[],
  p_accepted_name text,
  p_terms_version_id uuid,
  p_user_agent text
)
returns uuid
language plpgsql
security definer
set search_path = ops, core, public
as $$
declare
  v_token jsonb;
  v_job uuid;
  v_id uuid;
begin
  if coalesce(auth.role(), '') is distinct from 'service_role' then
    raise exception 'app: You cannot submit that form.';
  end if;
  v_token := public.orbit_resolve_token(p_token_hash);
  if v_token is null or v_token->>'purpose' is distinct from 'access_form' then
    raise exception 'app: That link is not valid.';
  end if;
  if p_accepted_name is null or char_length(trim(p_accepted_name)) not between 1 and 200 then
    raise exception 'app: Add the name of the person accepting the terms.';
  end if;
  v_job := (v_token->>'entity_id')::uuid;
  insert into ops.access_submissions (
    job_id, answers, media_file_ids, terms_version_id, accepted_at, accepted_by_name, accepted_user_agent, submitted_by
  ) values (
    v_job,
    coalesce(p_answers, '{}'::jsonb),
    coalesce(p_media_ids, '{}'),
    p_terms_version_id,
    now(),
    trim(p_accepted_name),
    left(coalesce(p_user_agent, ''), 400),
    'customer'
  )
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.orbit_list_access_submissions(p_job_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ops, core, public
as $$
begin
  if not core.has_ops_role(array['install_lead', 'admin_owner']) then
    raise exception 'app: Only the install lead can review an access form.';
  end if;
  if not ops.job_visible(p_job_id) then
    return '[]'::jsonb;
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', a.id,
      'answers', a.answers,
      'media_file_ids', a.media_file_ids,
      'accepted_at', a.accepted_at,
      'accepted_by_name', a.accepted_by_name,
      'terms_version_id', a.terms_version_id,
      'created_at', a.created_at
    ) order by a.created_at desc)
    from ops.access_submissions a
    where a.job_id = p_job_id
  ), '[]'::jsonb);
end;
$$;

create or replace function public.orbit_calendar(p_start date, p_end date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ops, core, public
as $$
begin
  if not core.has_ops_role(array['sales', 'install_lead', 'installer', 'hq', 'admin_owner']) then
    raise exception 'app: You cannot open the calendar.';
  end if;
  return jsonb_build_object(
    'resources', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', r.id,
        'resource_type', r.resource_type,
        'name', r.name,
        'has_licence', r.has_licence,
        'insured', r.insured,
        'status', r.status,
        'notes', r.notes
      ) order by r.resource_type, r.name)
      from ops.resources r
      where r.status = 'active'
    ), '[]'::jsonb),
    'reservations', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', rv.id,
        'resource_id', rv.resource_id,
        'job_id', rv.job_id,
        'day', rv.day,
        'kind', rv.kind,
        'cin7_number', j.cin7_number
      ) order by rv.day)
      from ops.reservations rv
      join ops.install_jobs j on j.id = rv.job_id
      where rv.day between p_start and p_end
    ), '[]'::jsonb),
    'unavailability', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', u.id,
        'resource_id', u.resource_id,
        'starts_on', u.starts_on,
        'ends_on', u.ends_on,
        'reason', u.reason
      ))
      from ops.unavailability u
      where u.ends_on >= p_start and u.starts_on <= p_end
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.orbit_add_unavailability(
  p_resource_id uuid,
  p_starts date,
  p_ends date,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = ops, core, public
as $$
declare
  v_id uuid;
begin
  if not core.has_ops_role(array['install_lead', 'admin_owner']) then
    raise exception 'app: Only the install lead can record unavailability.';
  end if;
  if p_reason not in ('leave', 'sickness', 'off_road', 'service', 'mot', 'other') then
    raise exception 'app: That reason is not valid.';
  end if;
  if p_ends < p_starts then
    raise exception 'app: The end date is before the start date.';
  end if;
  insert into ops.unavailability (resource_id, starts_on, ends_on, reason, created_by)
  values (p_resource_id, p_starts, p_ends, p_reason, auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.orbit_book_fixture(
  p_job_id uuid,
  p_resource_id uuid,
  p_day date,
  p_kind text
)
returns jsonb
language plpgsql
security definer
set search_path = ops, core, public
as $$
declare
  v_number text;
  v_status ops.job_status;
begin
  if not core.has_ops_role(array['install_lead', 'admin_owner']) then
    raise exception 'app: Only the install lead can book a fixture job.';
  end if;
  if p_kind not in ('pencil', 'firm') then
    raise exception 'app: Choose pencil or firm.';
  end if;
  select cin7_number, status into v_number, v_status
  from ops.install_jobs where id = p_job_id;
  if v_number is null or v_number not like 'FIXTURE-%' then
    raise exception 'app: Only a FIXTURE job can be booked by hand. Live booking waits on the gates.';
  end if;
  if exists (
    select 1 from ops.unavailability u
    where u.resource_id = p_resource_id and p_day between u.starts_on and u.ends_on
  ) then
    raise exception 'app: That resource is unavailable on that day.';
  end if;
  insert into ops.reservations (resource_id, job_id, day, kind)
  values (p_resource_id, p_job_id, p_day, p_kind::ops.reservation_kind)
  on conflict (resource_id, day, job_id) do update set kind = excluded.kind;

  if p_kind = 'firm' and v_status not in ('closed', 'lost_cancelled') then
    perform set_config('ops.allow_status_change', 'on', true);
    update ops.install_jobs set status = 'booked', booked_date = p_day where id = p_job_id;
    perform set_config('ops.allow_status_change', 'off', true);
  end if;

  return jsonb_build_object('job_id', p_job_id, 'day', p_day, 'kind', p_kind);
end;
$$;

revoke all on function public.orbit_record_fixture_quote(text, text, text, text, text, text, text, jsonb, text, jsonb, numeric, numeric, numeric, jsonb, boolean, text[]) from public, anon;
revoke all on function public.orbit_access_preview(text) from public, anon, authenticated;
revoke all on function public.orbit_submit_access_form(text, jsonb, uuid[], text, uuid, text) from public, anon, authenticated;
revoke all on function public.orbit_list_access_submissions(uuid) from public, anon;
revoke all on function public.orbit_calendar(date, date) from public, anon;
revoke all on function public.orbit_add_unavailability(uuid, date, date, text) from public, anon;
revoke all on function public.orbit_book_fixture(uuid, uuid, date, text) from public, anon;

grant execute on function public.orbit_record_fixture_quote(text, text, text, text, text, text, text, jsonb, text, jsonb, numeric, numeric, numeric, jsonb, boolean, text[]) to authenticated, service_role;
grant execute on function public.orbit_access_preview(text) to service_role;
grant execute on function public.orbit_submit_access_form(text, jsonb, uuid[], text, uuid, text) to service_role;
grant execute on function public.orbit_list_access_submissions(uuid) to authenticated, service_role;
grant execute on function public.orbit_calendar(date, date) to authenticated, service_role;
grant execute on function public.orbit_add_unavailability(uuid, date, date, text) to authenticated, service_role;
grant execute on function public.orbit_book_fixture(uuid, uuid, date, text) to authenticated, service_role;

-- Effort rows from the bundled v2.5 table. SKUs stay blank.
insert into ops.effort_rows (
  table_version_id, cin7_sku, product_name, category, unit_weight_kg, assembled_weight_kg,
  build_minutes, hq_build, review_flag, extras
)
select v.id, null, r.product_name, r.category, r.unit_weight_kg, r.assembled_weight_kg,
  r.build_minutes, r.hq_build, r.review_flag, r.extras
from ops.effort_table_versions v
cross join (
  values
    ('FID Bench', 'bench', null::numeric, null::numeric, 12::numeric, false, true, '{"build_crew":1,"carry_crew":1}'::jsonb),
    ('J75 Cable Rack', 'rack-rig', null, null, 100, false, true, '{"build_crew":3,"carry_crew":1}'::jsonb),
    ('Pilates Reformer Bed', 'pilates', 100, null, 40, false, true, '{"build_crew":1,"carry_crew":3}'::jsonb),
    ('Lifting Platform / Platform Inserts / Ply', 'flooring', null, null, 30, false, true, '{"build_crew":2,"carry_crew":2}'::jsonb),
    ('Vertical Dumbbell Rack', 'storage', null, null, 15, false, true, '{"build_crew":1,"carry_crew":2}'::jsonb),
    ('Horizontal Dumbbell Rack', 'storage', null, null, 20, false, true, '{"build_crew":1,"carry_crew":2}'::jsonb),
    ('2.5kg to 50kg Dumbbell Set', 'weights', null, null, 0, false, true, '{"crate_at_hq":true}'::jsonb),
    ('Helix Power Rack', 'storage', null, null, 100, false, true, '{"build_crew":2,"carry_crew":2}'::jsonb),
    ('Activ Square Puzzle Flooring', 'flooring', null, null, 0, false, true, '{}'::jsonb),
    ('Dual-Adjustable Pulley', 'cable', null, null, 40, false, true, '{"build_crew":2,"carry_crew":2}'::jsonb),
    ('Olympic Flat Bench', 'bench', null, null, 40, false, true, '{"build_crew":2,"carry_crew":2}'::jsonb),
    ('Concept2 SkiErg', 'cardio', null, null, 40, false, true, '{"build_crew":1,"carry_crew":2}'::jsonb),
    ('Concept2 BikeErg', 'cardio', null, null, 40, false, true, '{"build_crew":1,"carry_crew":2}'::jsonb),
    ('Concept2 RowErg', 'cardio', null, null, 20, false, true, '{"build_crew":1,"carry_crew":2}'::jsonb),
    ('400kg Rubber Olympic Bumper Plate Set', 'weights', 400, null, 0, false, true, '{"crate_at_hq":true}'::jsonb),
    ('150kg Rubber Bumper Plate Set', 'weights', 150, null, 0, false, true, '{"crate_at_hq":true}'::jsonb),
    ('Olympic Weight Tree', 'storage', null, null, 20, false, true, '{"build_crew":1,"carry_crew":2}'::jsonb),
    ('Cable Attachment Rack', 'storage', null, null, 20, false, true, '{"build_crew":1,"carry_crew":2}'::jsonb),
    ('Single-sided Freestanding Mat Rack', 'storage', null, null, 15, false, false, '{"build_crew":1,"carry_crew":1}'::jsonb),
    ('Double Sided Freestanding Mat Rack', 'storage', null, null, 15, false, false, '{"build_crew":1,"carry_crew":1}'::jsonb),
    ('Hiit Bench', 'bench', null, null, 5, false, true, '{"build_crew":1,"carry_crew":1}'::jsonb),
    ('Horizontal Kettlebell Rack', 'storage', null, null, 15, false, true, '{"build_crew":1,"carry_crew":2}'::jsonb),
    ('Helix Multistorage Rack', 'rack-rig', null, null, 100, false, true, '{"build_crew":2,"carry_crew":2}'::jsonb),
    ('DHZ selectorised machine — GENERIC PROVISIONAL', 'strength-selectorised', null, 350, null, true, true, '{"hq_build_minutes":180,"hq_build_crew":2,"site_position_minutes":45}'::jsonb),
    ('DHZ plate-loaded machine — GENERIC PROVISIONAL', 'strength-plate-loaded', null, 250, null, true, true, '{"hq_build_minutes":240,"hq_build_crew":2,"site_position_minutes":40}'::jsonb)
) as r(product_name, category, unit_weight_kg, assembled_weight_kg, build_minutes, hq_build, review_flag, extras)
where v.version_label = 'v2.5';

create or replace function public.orbit_job_lines(p_job_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ops, core, public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'productName', description,
    'category', category,
    'qty', qty
  )), '[]'::jsonb)
  from ops.job_lines
  where job_id = p_job_id
    and ops.job_visible(p_job_id);
$$;

revoke all on function public.orbit_job_lines(uuid) from public, anon;
grant execute on function public.orbit_job_lines(uuid) to authenticated, service_role;

create or replace function public.orbit_pricing_snapshot()
returns jsonb
language plpgsql
stable
security definer
set search_path = ops, public
as $$
declare
  v_row ops.pricing_settings%rowtype;
begin
  if coalesce(auth.role(), '') is distinct from 'service_role' then
    raise exception 'app: You cannot read pricing settings.';
  end if;
  select * into v_row from ops.pricing_settings order by version desc limit 1;
  if not found then
    return null;
  end if;
  return jsonb_build_object(
    'version', v_row.version,
    'markup_independent', v_row.markup_independent,
    'markup_franchisee', v_row.markup_franchisee,
    'markup_trade', v_row.markup_trade,
    'markup_big_corporate', v_row.markup_big_corporate,
    'min_job_charge', v_row.min_job_charge,
    'margin_floor_pct', v_row.margin_floor_pct,
    'large_order_threshold', v_row.large_order_threshold,
    'variation_rounding_hours', v_row.variation_rounding_hours
  );
end;
$$;

revoke all on function public.orbit_pricing_snapshot() from public, anon, authenticated;
grant execute on function public.orbit_pricing_snapshot() to service_role;

notify pgrst, 'reload schema';
