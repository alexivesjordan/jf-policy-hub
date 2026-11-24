-- Read effort_class and rack_family on the effort table, and filter Needs review.
-- Release order: 20261124160000, then this file, then the app. Not applied to production.
-- 20261124160000 adds the columns. This file only replaces the read functions.

create or replace function public.orbit_sku_effort_for_pricing(p_skus text[])
returns jsonb
language plpgsql
stable
security definer
set search_path = ops, core, public
as $$
begin
  if coalesce(auth.role(), '') is distinct from 'service_role' and not ops.can_price() then
    raise exception 'app: You cannot read the effort table.';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'sku', sku,
      'product_name', product_name,
      'cin7_category', cin7_category,
      'needs_assembly', needs_assembly,
      'crew', crew,
      'build_minutes', build_minutes,
      'build_location', build_location,
      'hq_build_minutes', hq_build_minutes,
      'hq_build_crew', hq_build_crew,
      'site_position_minutes', site_position_minutes,
      'effort_unit', effort_unit,
      'suggestion_rule', suggestion_rule,
      'status', status,
      'effort_class', effort_class,
      'rack_family', rack_family
    ))
    from ops.sku_effort
    where sku = any(p_skus)
  ), '[]'::jsonb);
end;
$$;

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
  if not (
    core.is_ops_owner()
    or public.workspace_is_admin()
    or public.workspace_can('operations', 'edit')
  ) then
    raise exception 'app: You cannot open the effort table.';
  end if;
  return jsonb_build_object(
    'review_count', (
      select count(*) from ops.sku_effort
      where status = 'suggested'
        or cin7_category = 'Other'
        or suggestion_rule is not null
        or (effort_class in ('rack', 'unsure') and needs_assembly is null)
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
          or (p_status = 'needs-review' and e.effort_class in ('rack', 'unsure') and e.needs_assembly is null)
          or (p_status = 'no-build-time' and e.effort_class in ('rack', 'needs_build', 'unsure') and (e.needs_assembly is null or e.build_minutes is null))
          or (p_status not in ('name-rule', 'needs-review', 'no-build-time') and e.status = p_status)
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
               status, notes, suggestion_rule, effort_class, rack_family
        from ops.sku_effort e
        where (v_search is null or e.sku ilike '%' || v_search || '%' or e.product_name ilike '%' || v_search || '%')
          and (coalesce(p_category, '') = '' or e.cin7_category = p_category)
          and (
            coalesce(p_status, '') = ''
            or (p_status = 'name-rule' and e.suggestion_rule is not null)
            or (p_status = 'needs-review' and e.effort_class in ('rack', 'unsure') and e.needs_assembly is null)
            or (p_status = 'no-build-time' and e.effort_class in ('rack', 'needs_build', 'unsure') and (e.needs_assembly is null or e.build_minutes is null))
            or (p_status not in ('name-rule', 'needs-review', 'no-build-time') and e.status = p_status)
          )
          and (coalesce(p_needs_assembly, '') = '' or (p_needs_assembly = 'yes' and e.needs_assembly is true) or (p_needs_assembly = 'no' and e.needs_assembly is false) or (p_needs_assembly = 'unknown' and e.needs_assembly is null))
        order by e.effort_class nulls last, e.rack_family nulls last, e.sku
        limit v_limit offset v_offset
      ) hit
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.orbit_update_sku_effort(
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
  if not (
    core.is_ops_owner()
    or public.workspace_is_admin()
    or public.workspace_can('operations', 'edit')
  ) then
    raise exception 'app: You cannot edit the effort table.';
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
