-- Suggested SKU rows follow the current category default. Confirmed rows are left alone.
-- Applying this migration also refreshes the rows already synced.

update ops.sku_effort e
set needs_assembly = d.needs_assembly,
    crew = d.crew,
    build_minutes = d.build_minutes,
    updated_at = now()
from ops.cin7_category_defaults d
where e.status = 'suggested'
  and e.cin7_category = d.category;

create or replace function public.orbit_save_cin7_category_defaults(p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ops, core, public
as $$
declare
  v_row jsonb;
  v_category text;
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
    insert into ops.cin7_category_defaults (
      category, needs_assembly, crew, build_minutes, status, notes, updated_by, updated_at
    ) values (
      v_category,
      case
        when v_row->>'needs_assembly' is null or v_row->>'needs_assembly' = '' then null
        else (v_row->>'needs_assembly')::boolean
      end,
      nullif(v_row->>'crew', '')::integer,
      nullif(v_row->>'build_minutes', '')::integer,
      'suggested',
      nullif(v_row->>'notes', ''),
      auth.uid(),
      now()
    )
    on conflict (category) do update
    set needs_assembly = excluded.needs_assembly,
        crew = excluded.crew,
        build_minutes = excluded.build_minutes,
        notes = coalesce(excluded.notes, ops.cin7_category_defaults.notes),
        updated_by = auth.uid(),
        updated_at = now();
  end loop;

  update ops.sku_effort e
  set needs_assembly = d.needs_assembly,
      crew = d.crew,
      build_minutes = d.build_minutes,
      updated_at = now()
  from ops.cin7_category_defaults d
  where e.status = 'suggested'
    and e.cin7_category = d.category
    and e.cin7_category in (
      select nullif(trim(value->>'category'), '')
      from jsonb_array_elements(p_rows)
    );

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
  v_minutes integer;
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
      sku, product_name, cin7_category, cin7_product_id, needs_assembly, crew, build_minutes, status
    ) values (
      v_sku,
      coalesce(nullif(trim(v_row->>'product_name'), ''), v_sku),
      v_category,
      nullif(trim(v_row->>'cin7_product_id'), ''),
      v_assembly,
      v_crew,
      v_minutes,
      'suggested'
    )
    on conflict (sku) do update
    set product_name = excluded.product_name,
        cin7_product_id = excluded.cin7_product_id,
        cin7_category = excluded.cin7_category,
        needs_assembly = excluded.needs_assembly,
        crew = excluded.crew,
        build_minutes = excluded.build_minutes,
        updated_at = now()
    where ops.sku_effort.status <> 'confirmed';
    v_count := v_count + 1;
  end loop;

  update ops.sku_effort e
  set needs_assembly = d.needs_assembly,
      crew = d.crew,
      build_minutes = d.build_minutes,
      updated_at = now()
  from ops.cin7_category_defaults d
  where e.status = 'suggested'
    and e.cin7_category = d.category;

  return v_count;
end;
$$;
