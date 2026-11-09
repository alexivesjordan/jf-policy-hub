-- Sled track time is 180 minutes for the first 10 m, then 6 minutes per extra metre.
-- Width lives on pricing settings. A blank width means the setting is unset.

alter table ops.pricing_settings
  add column if not exists sled_track_width_m numeric(8,3),
  add column if not exists sled_base_minutes numeric(8,2) not null default 180,
  add column if not exists sled_base_length_m numeric(8,2) not null default 10,
  add column if not exists sled_extra_minutes_per_m numeric(8,2) not null default 6;

comment on column ops.pricing_settings.sled_track_width_m is
  'Metres. Null until the owner sets it. Cin7 product Width is used first when that field is filled.';

drop function if exists ops.sled_track_suggestion(text);

create function ops.sled_track_suggestion(p_name text, p_sku text)
returns boolean
language sql
immutable
as $$
  select coalesce(p_name, '') ~* 'sled track'
    or upper(coalesce(p_sku, '')) in (
      'JF-TT-BST', 'JF-TT-CFST', 'JF-TT-CGST', 'JF-TT-CST', 'JF-TT-SST'
    );
$$;

revoke all on function ops.sled_track_suggestion(text, text) from public, anon, authenticated;

create or replace function ops.apply_suggested_profiles()
returns void
language plpgsql
as $$
begin
  update ops.sku_effort e
  set needs_assembly = d.needs_assembly,
      crew = d.crew,
      build_minutes = d.build_minutes,
      effort_unit = d.effort_unit,
      build_location = d.build_location,
      hq_build_minutes = d.hq_build_minutes,
      hq_build_crew = d.hq_build_crew,
      site_position_minutes = d.site_position_minutes,
      suggestion_rule = null,
      updated_at = now()
  from ops.cin7_category_defaults d
  where e.status = 'suggested'
    and e.cin7_category = d.category
    and not ops.pin_loaded_suggestion(e.sku, e.product_name)
    and not ops.sled_track_suggestion(e.product_name, e.sku);

  update ops.sku_effort e
  set needs_assembly = s.needs_assembly,
      crew = s.crew,
      build_minutes = s.build_minutes,
      effort_unit = s.effort_unit,
      build_location = s.build_location,
      hq_build_minutes = s.hq_build_minutes,
      hq_build_crew = s.hq_build_crew,
      site_position_minutes = s.site_position_minutes,
      suggestion_rule = 'pin-loaded',
      updated_at = now()
  from ops.cin7_category_defaults s
  where s.category = 'Strength Machines'
    and e.status = 'suggested'
    and ops.pin_loaded_suggestion(e.sku, e.product_name)
    and not ops.sled_track_suggestion(e.product_name, e.sku);

  update ops.sku_effort e
  set needs_assembly = true,
      crew = 2,
      build_minutes = 180,
      effort_unit = 'm2',
      build_location = 'site',
      hq_build_minutes = null,
      hq_build_crew = null,
      site_position_minutes = null,
      suggestion_rule = 'sled-track',
      updated_at = now()
  where e.status = 'suggested'
    and ops.sled_track_suggestion(e.product_name, e.sku);
end;
$$;

select ops.apply_suggested_profiles();

create or replace function public.orbit_read_settings()
returns jsonb
language plpgsql
stable
security definer
set search_path = core, ops, public
as $$
declare
  v_settings jsonb;
  v_pricing jsonb;
begin
  if not core.is_ops_owner() then
    raise exception 'app: Only the owner can read these settings.';
  end if;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'key', s.key,
      'module_id', s.module_id,
      'value', s.value,
      'version', s.version,
      'changed_by', s.changed_by,
      'change_reason', s.change_reason,
      'created_at', s.created_at
    )
    order by s.key
  ), '[]'::jsonb)
  into v_settings
  from core.settings_current s;

  select jsonb_build_object(
    'version', p.version,
    'markup_independent', p.markup_independent,
    'markup_franchisee', p.markup_franchisee,
    'markup_trade', p.markup_trade,
    'markup_big_corporate', p.markup_big_corporate,
    'min_job_charge', p.min_job_charge,
    'margin_floor_pct', p.margin_floor_pct,
    'custom_deposit_fraction', p.custom_deposit_fraction,
    'large_order_threshold', p.large_order_threshold,
    'variation_rounding_hours', p.variation_rounding_hours,
    'sled_track_width_m', p.sled_track_width_m,
    'sled_base_minutes', p.sled_base_minutes,
    'sled_base_length_m', p.sled_base_length_m,
    'sled_extra_minutes_per_m', p.sled_extra_minutes_per_m,
    'change_reason', p.change_reason,
    'created_at', p.created_at
  )
  into v_pricing
  from ops.pricing_settings p
  order by p.version desc
  limit 1;

  return jsonb_build_object(
    'settings', coalesce(v_settings, '[]'::jsonb),
    'pricing_settings', v_pricing
  );
end;
$$;

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
    'variation_rounding_hours', v_row.variation_rounding_hours,
    'sled_track_width_m', v_row.sled_track_width_m,
    'sled_base_minutes', v_row.sled_base_minutes,
    'sled_base_length_m', v_row.sled_base_length_m,
    'sled_extra_minutes_per_m', v_row.sled_extra_minutes_per_m
  );
end;
$$;

drop function if exists public.orbit_save_pricing(numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric, text);

create function public.orbit_save_pricing(
  p_markup_independent numeric,
  p_markup_franchisee numeric,
  p_markup_trade numeric,
  p_markup_big_corporate numeric,
  p_min_job_charge numeric,
  p_margin_floor_pct numeric,
  p_custom_deposit_fraction numeric,
  p_large_order_threshold numeric,
  p_variation_rounding_hours numeric,
  p_change_reason text,
  p_sled_track_width_m numeric default null,
  p_sled_base_minutes numeric default 180,
  p_sled_base_length_m numeric default 10,
  p_sled_extra_minutes_per_m numeric default 6
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

  if p_sled_track_width_m is not null and p_sled_track_width_m <= 0 then
    raise exception 'app: Sled track width must be above zero.';
  end if;

  if p_sled_base_minutes is null or p_sled_base_minutes <= 0 then
    raise exception 'app: Sled track base minutes must be above zero.';
  end if;

  if p_sled_base_length_m is null or p_sled_base_length_m <= 0 then
    raise exception 'app: Sled track base length must be above zero.';
  end if;

  if p_sled_extra_minutes_per_m is null or p_sled_extra_minutes_per_m < 0 then
    raise exception 'app: Extra minutes per metre cannot be negative.';
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
    sled_track_width_m,
    sled_base_minutes,
    sled_base_length_m,
    sled_extra_minutes_per_m,
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
    p_sled_track_width_m,
    p_sled_base_minutes,
    p_sled_base_length_m,
    p_sled_extra_minutes_per_m,
    auth.uid(),
    trim(p_change_reason)
  );

  return public.orbit_read_settings();
end;
$$;

revoke all on function public.orbit_save_pricing(numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric, text, numeric, numeric, numeric, numeric) from public, anon;
grant execute on function public.orbit_save_pricing(numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric, text, numeric, numeric, numeric, numeric) to authenticated, service_role;
