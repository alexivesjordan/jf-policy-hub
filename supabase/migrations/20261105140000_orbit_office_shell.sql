-- Office shell reads and owner writes for Release 1A.
-- Uses the M0 tables. No Cin7 calls. Pricing and terms edits append a new
-- version; they do not update the current row.

create or replace function public.orbit_office_context()
returns jsonb
language plpgsql
stable
security definer
set search_path = core, public
as $$
declare
  v_role text;
begin
  if auth.uid() is null then
    raise exception 'app: You need to be signed in.';
  end if;

  select ops_role into v_role
  from core.ops_roles
  where profile_id = auth.uid();

  return jsonb_build_object(
    'has_module', exists (
      select 1
      from public.module_access m
      join public.profiles p on p.id = m.profile_id
      where m.profile_id = auth.uid()
        and m.module_id = 'operations'
        and m.enabled
        and p.is_active
        and p.access_granted
    ),
    'ops_role', v_role,
    'is_owner', core.is_ops_owner()
  );
end;
$$;

create or replace function public.orbit_list_jobs()
returns jsonb
language plpgsql
stable
security definer
set search_path = ops, core, public
as $$
declare
  v_rows jsonb;
begin
  if auth.uid() is null then
    raise exception 'app: You need to be signed in.';
  end if;

  if not exists (
    select 1
    from public.module_access m
    join public.profiles p on p.id = m.profile_id
    where m.profile_id = auth.uid()
      and m.module_id = 'operations'
      and m.enabled
      and p.is_active
      and p.access_granted
  ) and not core.is_ops_owner() then
    raise exception 'app: You do not have the Operations module.';
  end if;

  select coalesce(jsonb_agg(row_data order by created_at desc), '[]'::jsonb)
  into v_rows
  from (
    select
      jsonb_build_object(
        'id', j.id,
        'status', j.status,
        'status_label', coalesce(ws.label, j.status::text),
        'job_type', j.job_type,
        'cin7_number', j.cin7_number,
        'fixture', coalesce(j.cin7_number, '') like 'FIXTURE-%',
        'customer_name', c.name,
        'customer_segment', c.segment,
        'customer_type', c.customer_type,
        'postcode', s.postcode,
        'city', s.city,
        'big_install', j.big_install,
        'hold_reason', j.hold_reason,
        'booked_date', j.booked_date,
        'created_at', j.created_at
      ) as row_data,
      j.created_at
    from ops.install_jobs j
    join ops.customers c on c.id = j.customer_id
    left join ops.sites s on s.id = j.site_id
    left join core.workflow_states ws
      on ws.code = j.status::text
     and ws.workflow_id = (
       select d.id
       from core.workflow_definitions d
       where d.module_id = 'operations'
         and d.name = 'install_job'
     )
    where ops.job_visible(j.id)
    order by j.created_at desc
    limit 100
  ) listed;

  return v_rows;
end;
$$;

create or replace function public.orbit_get_job(p_job_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ops, core, public
as $$
declare
  v_job ops.install_jobs%rowtype;
  v_customer ops.customers%rowtype;
  v_site ops.sites%rowtype;
  v_label text;
  v_quotes jsonb;
  v_show_price boolean;
begin
  if auth.uid() is null then
    raise exception 'app: You need to be signed in.';
  end if;

  if not ops.job_visible(p_job_id) then
    return null;
  end if;

  select * into v_job from ops.install_jobs where id = p_job_id;
  select * into v_customer from ops.customers where id = v_job.customer_id;
  if v_job.site_id is not null then
    select * into v_site from ops.sites where id = v_job.site_id;
  end if;

  select ws.label into v_label
  from core.workflow_states ws
  join core.workflow_definitions d on d.id = ws.workflow_id
  where d.module_id = 'operations'
    and d.name = 'install_job'
    and ws.code = v_job.status::text;

  v_show_price := ops.money_visible(p_job_id) or ops.sales_job_visible(p_job_id);

  if v_show_price then
    select coalesce(jsonb_agg(
      jsonb_build_object(
        'id', q.id,
        'mode', q.mode,
        'finality', q.finality,
        'customer_price', case when ops.sales_job_visible(p_job_id) or ops.money_visible(p_job_id) then q.customer_price else null end,
        'internal_cost', case when ops.money_visible(p_job_id) then q.internal_cost else null end,
        'created_at', q.created_at
      )
      order by q.created_at desc
    ), '[]'::jsonb)
    into v_quotes
    from ops.quote_versions q
    where q.job_id = p_job_id;
  else
    v_quotes := '[]'::jsonb;
  end if;

  return jsonb_build_object(
    'id', v_job.id,
    'status', v_job.status,
    'status_label', coalesce(v_label, v_job.status::text),
    'job_type', v_job.job_type,
    'cin7_number', v_job.cin7_number,
    'cin7_quote_number', v_job.cin7_quote_number,
    'cin7_order_number', v_job.cin7_order_number,
    'fixture', coalesce(v_job.cin7_number, '') like 'FIXTURE-%',
    'delivered_by', v_job.delivered_by,
    'big_install', v_job.big_install,
    'big_install_triggers', v_job.big_install_triggers,
    'requested_date', v_job.requested_date,
    'booked_date', v_job.booked_date,
    'arrival_window', v_job.arrival_window,
    'hold_reason', v_job.hold_reason,
    'hold_review_date', v_job.hold_review_date,
    'lost_reason', v_job.lost_reason,
    'created_at', v_job.created_at,
    'customer', jsonb_build_object(
      'id', v_customer.id,
      'name', v_customer.name,
      'segment', v_customer.segment,
      'customer_type', v_customer.customer_type,
      'cin7_id', v_customer.cin7_id
    ),
    'site', case
      when v_site.id is null then null
      else jsonb_build_object(
        'id', v_site.id,
        'name', v_site.name,
        'address_line1', v_site.address_line1,
        'city', v_site.city,
        'postcode', v_site.postcode
      )
    end,
    'quote_versions', v_quotes
  );
end;
$$;

create or replace function public.orbit_list_gate_overrides()
returns jsonb
language plpgsql
stable
security definer
set search_path = core, ops, public
as $$
declare
  v_rows jsonb;
begin
  if not core.is_ops_owner() then
    raise exception 'app: Only the owner can read gate overrides.';
  end if;

  select coalesce(jsonb_agg(row_data order by created_at desc), '[]'::jsonb)
  into v_rows
  from (
    select
      jsonb_build_object(
        'id', g.id,
        'gate', g.gate,
        'reason', g.reason,
        'entity_schema', g.entity_schema,
        'entity_table', g.entity_table,
        'entity_id', g.entity_id,
        'created_at', g.created_at,
        'job_label', case
          when g.entity_table = 'install_jobs' then (
            select c.name
            from ops.install_jobs j
            join ops.customers c on c.id = j.customer_id
            where j.id = g.entity_id
          )
          else null
        end,
        'cin7_number', case
          when g.entity_table = 'install_jobs' then (
            select j.cin7_number from ops.install_jobs j where j.id = g.entity_id
          )
          else null
        end
      ) as row_data,
      g.created_at
    from core.gate_overrides g
    order by g.created_at desc
    limit 100
  ) listed;

  return v_rows;
end;
$$;

create or replace function public.orbit_read_terms()
returns jsonb
language plpgsql
stable
security definer
set search_path = ops, core, public
as $$
declare
  v_row ops.terms_versions%rowtype;
begin
  if not core.is_ops_owner()
     and not core.has_ops_role(array['install_lead', 'admin_owner'])
  then
    raise exception 'app: Only the owner can read these settings.';
  end if;

  select * into v_row
  from ops.terms_versions
  order by created_at desc
  limit 1;

  if not found then
    return null;
  end if;

  return jsonb_build_object(
    'id', v_row.id,
    'version_label', v_row.version_label,
    'is_live', v_row.is_live,
    'charges_grid', v_row.charges_grid,
    'cancellation_schedule', v_row.cancellation_schedule,
    'created_at', v_row.created_at
  );
end;
$$;

create or replace function public.orbit_save_pricing(
  p_markup_independent numeric,
  p_markup_franchisee numeric,
  p_markup_trade numeric,
  p_markup_big_corporate numeric,
  p_min_job_charge numeric,
  p_margin_floor_pct numeric,
  p_custom_deposit_fraction numeric,
  p_large_order_threshold numeric,
  p_variation_rounding_hours numeric,
  p_change_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ops, core, public
as $$
declare
  v_version integer;
begin
  if not core.is_ops_owner() then
    raise exception 'app: Only the owner can change pricing.';
  end if;

  if p_change_reason is null or char_length(trim(p_change_reason)) not between 1 and 500 then
    raise exception 'app: Add a short reason for this pricing change.';
  end if;

  if p_markup_independent is null or p_markup_independent < 0 or p_markup_independent > 5
     or p_markup_franchisee is null or p_markup_franchisee < 0 or p_markup_franchisee > 5
     or p_markup_trade is null or p_markup_trade < 0 or p_markup_trade > 5
     or p_markup_big_corporate is null or p_markup_big_corporate < 0 or p_markup_big_corporate > 5
  then
    raise exception 'app: Enter each markup as a percentage from 0 to 500.';
  end if;

  if p_min_job_charge is not null and p_min_job_charge < 0 then
    raise exception 'app: The minimum job charge cannot be negative.';
  end if;

  if p_margin_floor_pct is not null and (p_margin_floor_pct < 0 or p_margin_floor_pct > 5) then
    raise exception 'app: Enter the margin floor as a percentage from 0 to 500.';
  end if;

  if p_custom_deposit_fraction is null or p_custom_deposit_fraction < 0 or p_custom_deposit_fraction > 1 then
    raise exception 'app: The custom deposit fraction must be between 0 and 1.';
  end if;

  if p_large_order_threshold is null or p_large_order_threshold < 0 then
    raise exception 'app: The large-order threshold cannot be negative.';
  end if;

  if p_variation_rounding_hours is null or p_variation_rounding_hours <= 0 or p_variation_rounding_hours > 24 then
    raise exception 'app: The variation rounding must be between 0 and 24 hours.';
  end if;

  select coalesce(max(version), 0) + 1 into v_version from ops.pricing_settings;

  insert into ops.pricing_settings (
    version,
    markup_independent,
    markup_franchisee,
    markup_trade,
    markup_big_corporate,
    min_job_charge,
    margin_floor_pct,
    custom_deposit_fraction,
    large_order_threshold,
    variation_rounding_hours,
    changed_by,
    change_reason
  ) values (
    v_version,
    p_markup_independent,
    p_markup_franchisee,
    p_markup_trade,
    p_markup_big_corporate,
    p_min_job_charge,
    p_margin_floor_pct,
    p_custom_deposit_fraction,
    p_large_order_threshold,
    p_variation_rounding_hours,
    auth.uid(),
    trim(p_change_reason)
  );

  return public.orbit_read_settings();
end;
$$;

create or replace function public.orbit_save_terms(p_lines jsonb, p_change_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ops, core, public
as $$
declare
  v_current ops.terms_versions%rowtype;
  v_existing jsonb;
  v_input jsonb;
  v_line jsonb;
  v_new_lines jsonb := '[]'::jsonb;
  v_label text;
  v_id uuid;
  v_version text;
  v_grid jsonb;
begin
  if not core.is_ops_owner() then
    raise exception 'app: Only the owner can change the charges grid.';
  end if;

  if p_change_reason is null or char_length(trim(p_change_reason)) not between 1 and 500 then
    raise exception 'app: Add a short reason for this charges change.';
  end if;

  if jsonb_typeof(p_lines) is distinct from 'array' then
    raise exception 'app: The charges grid is not valid.';
  end if;

  select * into v_current
  from ops.terms_versions
  order by created_at desc
  limit 1;

  if not found then
    raise exception 'app: There is no charges grid to edit.';
  end if;

  if (
    select count(*) from jsonb_array_elements(p_lines)
  ) is distinct from (
    select count(*) from jsonb_array_elements(v_current.charges_grid -> 'lines')
  ) then
    raise exception 'app: Keep every line on the current charges grid.';
  end if;

  for v_existing in
    select value from jsonb_array_elements(v_current.charges_grid -> 'lines')
  loop
    v_label := v_existing ->> 'label';
    select value into v_input
    from jsonb_array_elements(p_lines) as input_line(value)
    where input_line.value ->> 'label' = v_label;

    if v_input is null then
      raise exception 'app: Keep every line on the current charges grid.';
    end if;

    v_line := v_existing;

    if nullif(v_input ->> 'rate', '') is not null then
      if v_input ->> 'rate' !~ '^[0-9]+(\.[0-9]+)?$' then
        raise exception 'app: Enter each rate as a number.';
      end if;
      v_line := v_line || jsonb_build_object('rate', (v_input ->> 'rate')::numeric);
    end if;

    if nullif(v_input ->> 'mileage', '') is not null then
      if v_input ->> 'mileage' !~ '^[0-9]+(\.[0-9]+)?$' then
        raise exception 'app: Enter mileage as a number.';
      end if;
      v_line := v_line || jsonb_build_object('mileage', (v_input ->> 'mileage')::numeric);
    end if;

    v_new_lines := v_new_lines || jsonb_build_array(v_line);
  end loop;

  v_version := 'office-' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISSMS');
  v_grid := v_current.charges_grid || jsonb_build_object('lines', v_new_lines);

  insert into ops.terms_versions (
    version_label, charges_grid, cancellation_schedule, is_live
  ) values (
    v_version, v_grid, v_current.cancellation_schedule, false
  )
  returning id into v_id;

  insert into core.audit_log (
    actor_id, module_id, entity_schema, entity_table, entity_id,
    action, field_name, old_value, new_value, details
  ) values (
    auth.uid(),
    'operations',
    'ops',
    'terms_versions',
    v_id,
    'update',
    'charges_grid',
    v_current.charges_grid,
    v_grid,
    jsonb_build_object('reason', trim(p_change_reason), 'version_label', v_version, 'is_live', false)
  );

  return public.orbit_read_terms();
end;
$$;

revoke all on function public.orbit_office_context() from public, anon;
revoke all on function public.orbit_list_jobs() from public, anon;
revoke all on function public.orbit_get_job(uuid) from public, anon;
revoke all on function public.orbit_list_gate_overrides() from public, anon;
revoke all on function public.orbit_read_terms() from public, anon;
revoke all on function public.orbit_save_pricing(numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric, text) from public, anon;
revoke all on function public.orbit_save_terms(jsonb, text) from public, anon;

grant execute on function public.orbit_office_context() to authenticated, service_role;
grant execute on function public.orbit_list_jobs() to authenticated, service_role;
grant execute on function public.orbit_get_job(uuid) to authenticated, service_role;
grant execute on function public.orbit_list_gate_overrides() to authenticated, service_role;
grant execute on function public.orbit_read_terms() to authenticated, service_role;
grant execute on function public.orbit_save_pricing(numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric, text) to authenticated, service_role;
grant execute on function public.orbit_save_terms(jsonb, text) to authenticated, service_role;

notify pgrst, 'reload schema';
