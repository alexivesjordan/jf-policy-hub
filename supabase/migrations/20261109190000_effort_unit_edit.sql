-- Let the owner edit the effort unit, and keep the Cin7 unit of measure on each SKU.

create or replace function public.orbit_list_sku_effort(
  p_search text,
  p_category text,
  p_status text,
  p_needs_assembly text,
  p_limit integer,
  p_offset integer
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ops, core, public
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 5000);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_search text := nullif(trim(coalesce(p_search, '')), '');
begin
  if not core.is_ops_owner() then
    raise exception 'app: Only the owner can open the effort table.';
  end if;
  return jsonb_build_object(
    'review_count', (
      select count(*) from ops.sku_effort
      where status = 'suggested' or cin7_category = 'Other' or suggestion_rule is not null
    ),
    'name_rule_count', (
      select count(*) from ops.sku_effort where suggestion_rule is not null and status = 'suggested'
    ),
    'total', (
      select count(*) from ops.sku_effort e
      where (v_search is null or e.sku ilike '%' || v_search || '%' or e.product_name ilike '%' || v_search || '%')
        and (coalesce(p_category, '') = '' or e.cin7_category = p_category)
        and (
          coalesce(p_status, '') = ''
          or (p_status = 'name-rule' and e.suggestion_rule is not null)
          or (p_status <> 'name-rule' and e.status = p_status)
        )
        and (coalesce(p_needs_assembly, '') = '' or (p_needs_assembly = 'yes' and e.needs_assembly is true) or (p_needs_assembly = 'no' and e.needs_assembly is false) or (p_needs_assembly = 'unknown' and e.needs_assembly is null))
    ),
    'categories', coalesce((
      select jsonb_agg(category order by category)
      from (
        select category from ops.cin7_category_defaults
        union
        select cin7_category from ops.sku_effort where cin7_category is not null
      ) names(category)
    ), '[]'::jsonb),
    'rows', coalesce((
      select jsonb_agg(row_to_json(hit))
      from (
        select sku, product_name, cin7_category, cin7_uom, needs_assembly, crew, build_minutes, effort_unit,
               build_location, hq_build_minutes, hq_build_crew, site_position_minutes,
               status, notes, suggestion_rule
        from ops.sku_effort e
        where (v_search is null or e.sku ilike '%' || v_search || '%' or e.product_name ilike '%' || v_search || '%')
          and (coalesce(p_category, '') = '' or e.cin7_category = p_category)
          and (
            coalesce(p_status, '') = ''
            or (p_status = 'name-rule' and e.suggestion_rule is not null)
            or (p_status <> 'name-rule' and e.status = p_status)
          )
          and (coalesce(p_needs_assembly, '') = '' or (p_needs_assembly = 'yes' and e.needs_assembly is true) or (p_needs_assembly = 'no' and e.needs_assembly is false) or (p_needs_assembly = 'unknown' and e.needs_assembly is null))
        order by e.suggestion_rule nulls last, e.cin7_category nulls last, e.sku
        limit v_limit offset v_offset
      ) hit
    ), '[]'::jsonb)
  );
end;
$$;

drop function if exists public.orbit_update_sku_effort(text[], text, integer, integer, text, text, text, integer, integer, integer);

create function public.orbit_update_sku_effort(
  p_skus text[],
  p_needs_assembly text,
  p_crew integer,
  p_minutes numeric,
  p_status text,
  p_notes text,
  p_build_location text default null,
  p_hq_minutes integer default null,
  p_hq_crew integer default null,
  p_position_minutes integer default null,
  p_effort_unit text default null
)
returns integer
language plpgsql
security definer
set search_path = ops, core, public
as $$
declare
  v_count integer;
begin
  if not core.is_ops_owner() then
    raise exception 'app: Only the owner can edit the effort table.';
  end if;
  if p_status is not null and p_status not in ('suggested', 'confirmed') then
    raise exception 'app: Status must be suggested or confirmed.';
  end if;
  if p_effort_unit is not null and p_effort_unit <> '' and p_effort_unit not in ('each', 'tile', 'm2') then
    raise exception 'app: The effort unit must be each, tile, or m2.';
  end if;
  update ops.sku_effort
  set needs_assembly = case
        when p_needs_assembly is null or p_needs_assembly = '' then needs_assembly
        when p_needs_assembly = 'unknown' then null
        else p_needs_assembly = 'yes'
      end,
      crew = coalesce(p_crew, crew),
      build_minutes = coalesce(p_minutes, build_minutes),
      effort_unit = case when p_effort_unit in ('each', 'tile', 'm2') then p_effort_unit else effort_unit end,
      build_location = case when p_build_location in ('hq', 'site') then p_build_location else build_location end,
      hq_build_minutes = coalesce(p_hq_minutes, hq_build_minutes),
      hq_build_crew = coalesce(p_hq_crew, hq_build_crew),
      site_position_minutes = coalesce(p_position_minutes, site_position_minutes),
      status = coalesce(p_status, status),
      suggestion_rule = case when coalesce(p_status, status) = 'confirmed' then null else suggestion_rule end,
      notes = coalesce(p_notes, notes),
      updated_by = auth.uid(),
      updated_at = now()
  where sku = any(p_skus);
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.orbit_update_sku_effort(text[], text, integer, numeric, text, text, text, integer, integer, integer, text) from public, anon;
grant execute on function public.orbit_update_sku_effort(text[], text, integer, numeric, text, text, text, integer, integer, integer, text) to authenticated, service_role;

create or replace function public.orbit_cin7_category_defaults()
returns jsonb
language plpgsql
stable
security definer
set search_path = ops, core, public
as $$
begin
  if coalesce(auth.role(), '') is distinct from 'service_role' and not ops.can_price() then
    raise exception 'app: You cannot read category defaults.';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'category', category,
      'needs_assembly', needs_assembly,
      'crew', crew,
      'build_minutes', build_minutes,
      'effort_unit', effort_unit,
      'build_location', build_location,
      'hq_build_minutes', hq_build_minutes,
      'hq_build_crew', hq_build_crew,
      'site_position_minutes', site_position_minutes,
      'status', status,
      'notes', notes
    ) order by category)
    from ops.cin7_category_defaults
  ), '[]'::jsonb);
end;
$$;

create or replace function public.orbit_save_cin7_category_defaults(p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ops, core, public
as $$
declare
  v_row jsonb;
  v_category text;
  v_location text;
  v_unit text;
begin
  if not core.is_ops_owner() then
    raise exception 'app: Only the owner can edit category defaults.';
  end if;
  if jsonb_typeof(p_rows) is distinct from 'array' then
    raise exception 'app: Category defaults must be a list.';
  end if;
  for v_row in select value from jsonb_array_elements(p_rows)
  loop
    v_category := nullif(trim(v_row->>'category'), '');
    if v_category is null then
      continue;
    end if;
    v_location := case when v_row->>'build_location' = 'hq' then 'hq' else 'site' end;
    v_unit := case when v_row->>'effort_unit' in ('each', 'tile', 'm2') then v_row->>'effort_unit' else 'each' end;
    insert into ops.cin7_category_defaults (
      category, needs_assembly, crew, build_minutes, effort_unit, build_location,
      hq_build_minutes, hq_build_crew, site_position_minutes, status, notes, updated_by, updated_at
    ) values (
      v_category,
      case
        when v_row->>'needs_assembly' is null or v_row->>'needs_assembly' = '' then null
        else (v_row->>'needs_assembly')::boolean
      end,
      nullif(v_row->>'crew', '')::integer,
      nullif(v_row->>'build_minutes', '')::numeric,
      v_unit,
      v_location,
      nullif(v_row->>'hq_build_minutes', '')::integer,
      nullif(v_row->>'hq_build_crew', '')::integer,
      nullif(v_row->>'site_position_minutes', '')::integer,
      'suggested',
      nullif(v_row->>'notes', ''),
      auth.uid(),
      now()
    )
    on conflict (category) do update
    set needs_assembly = excluded.needs_assembly,
        crew = excluded.crew,
        build_minutes = excluded.build_minutes,
        effort_unit = excluded.effort_unit,
        build_location = excluded.build_location,
        hq_build_minutes = excluded.hq_build_minutes,
        hq_build_crew = excluded.hq_build_crew,
        site_position_minutes = excluded.site_position_minutes,
        notes = coalesce(excluded.notes, ops.cin7_category_defaults.notes),
        updated_by = auth.uid(),
        updated_at = now();
  end loop;
  perform ops.apply_suggested_profiles();
  return public.orbit_cin7_category_defaults();
end;
$$;

create or replace function public.orbit_sync_sku_effort(p_rows jsonb)
returns integer
language plpgsql
security definer
set search_path = ops, core, public
as $$
declare
  v_row jsonb;
  v_count integer := 0;
  v_sku text;
  v_category text;
  v_assembly boolean;
  v_crew integer;
  v_minutes numeric;
begin
  if coalesce(auth.role(), '') is distinct from 'service_role' and not core.is_ops_owner() then
    raise exception 'app: Only the owner can sync products.';
  end if;
  for v_row in select value from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb))
  loop
    v_sku := nullif(trim(v_row->>'sku'), '');
    if v_sku is null then
      continue;
    end if;
    v_category := nullif(trim(v_row->>'cin7_category'), '');
    select needs_assembly, crew, build_minutes
      into v_assembly, v_crew, v_minutes
    from ops.cin7_category_defaults
    where category = v_category;
    insert into ops.sku_effort (
      sku, product_name, cin7_category, cin7_product_id, cin7_uom, needs_assembly, crew, build_minutes, status
    ) values (
      v_sku,
      coalesce(nullif(trim(v_row->>'product_name'), ''), v_sku),
      v_category,
      nullif(trim(v_row->>'cin7_product_id'), ''),
      nullif(trim(v_row->>'cin7_uom'), ''),
      v_assembly,
      v_crew,
      v_minutes,
      'suggested'
    )
    on conflict (sku) do update
    set product_name = excluded.product_name,
        cin7_product_id = excluded.cin7_product_id,
        cin7_category = excluded.cin7_category,
        cin7_uom = excluded.cin7_uom,
        updated_at = now()
    where ops.sku_effort.status <> 'confirmed';
    v_count := v_count + 1;
  end loop;
  perform ops.apply_suggested_profiles();
  return v_count;
end;
$$;

create or replace function public.orbit_import_sku_effort(p_rows jsonb)
returns integer
language plpgsql
security definer
set search_path = ops, core, public
as $$
declare
  v_row jsonb;
  v_count integer := 0;
  v_sku text;
  v_location text;
  v_unit text;
begin
  if not core.is_ops_owner() then
    raise exception 'app: Only the owner can import the effort table.';
  end if;
  for v_row in select value from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb))
  loop
    v_sku := nullif(trim(v_row->>'sku'), '');
    if v_sku is null then
      continue;
    end if;
    v_location := case when v_row->>'build_location' = 'hq' then 'hq' when v_row->>'build_location' = 'site' then 'site' else null end;
    v_unit := case when v_row->>'effort_unit' in ('each', 'tile', 'm2') then v_row->>'effort_unit' else null end;
    insert into ops.sku_effort (
      sku, product_name, cin7_category, needs_assembly, crew, build_minutes, effort_unit,
      build_location, hq_build_minutes, hq_build_crew, site_position_minutes,
      status, notes, updated_by
    ) values (
      v_sku,
      coalesce(nullif(trim(v_row->>'product_name'), ''), v_sku),
      nullif(trim(v_row->>'cin7_category'), ''),
      case
        when v_row->>'needs_assembly' is null or v_row->>'needs_assembly' = '' then null
        else lower(v_row->>'needs_assembly') in ('true', 'yes', '1', 'y')
      end,
      nullif(v_row->>'crew', '')::integer,
      nullif(v_row->>'build_minutes', '')::numeric,
      coalesce(v_unit, 'each'),
      coalesce(v_location, 'site'),
      nullif(v_row->>'hq_build_minutes', '')::integer,
      nullif(v_row->>'hq_build_crew', '')::integer,
      nullif(v_row->>'site_position_minutes', '')::integer,
      case when lower(coalesce(v_row->>'status', '')) = 'confirmed' then 'confirmed' else 'suggested' end,
      v_row->>'notes',
      auth.uid()
    )
    on conflict (sku) do update
    set product_name = coalesce(nullif(trim(excluded.product_name), ''), ops.sku_effort.product_name),
        cin7_category = coalesce(excluded.cin7_category, ops.sku_effort.cin7_category),
        needs_assembly = coalesce(excluded.needs_assembly, ops.sku_effort.needs_assembly),
        crew = coalesce(excluded.crew, ops.sku_effort.crew),
        build_minutes = coalesce(excluded.build_minutes, ops.sku_effort.build_minutes),
        effort_unit = coalesce(v_unit, ops.sku_effort.effort_unit),
        build_location = coalesce(v_location, ops.sku_effort.build_location),
        hq_build_minutes = coalesce(excluded.hq_build_minutes, ops.sku_effort.hq_build_minutes),
        hq_build_crew = coalesce(excluded.hq_build_crew, ops.sku_effort.hq_build_crew),
        site_position_minutes = coalesce(excluded.site_position_minutes, ops.sku_effort.site_position_minutes),
        status = excluded.status,
        suggestion_rule = case when excluded.status = 'confirmed' then null else ops.sku_effort.suggestion_rule end,
        notes = coalesce(excluded.notes, ops.sku_effort.notes),
        updated_by = auth.uid(),
        updated_at = now();
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;
