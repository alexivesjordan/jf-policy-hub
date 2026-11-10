-- More suggested Cin7 category defaults, and a way to add a default for a category that has none.
-- Does not change a default Alex has already saved: new rows insert only when the category is absent.

insert into ops.cin7_category_defaults (category, needs_assembly, crew, build_minutes, status, notes)
values
  ('Strength Machines', true, 2, 120, 'suggested', 'Each machine: 2-man, 2-hour build.'),
  ('Stair Climbers', true, 2, 120, 'suggested', 'Each machine: 2-man, 2-hour build.'),
  ('Gym Flooring', false, 1, 0, 'suggested', 'No assembly. Handling and carry only.'),
  ('Weight Plates', false, 1, 0, 'suggested', 'No assembly. Handling and carry only.'),
  ('Mats', false, 1, 0, 'suggested', 'No assembly. Handling and carry only.'),
  ('Cable Attachments', false, 1, 0, 'suggested', 'No assembly. Handling and carry only.'),
  ('Boxing Gloves & Pads', false, 1, 0, 'suggested', 'No assembly. Handling and carry only.'),
  ('Weightlifting Accessories', false, 1, 0, 'suggested', 'No assembly. Handling and carry only.'),
  ('Plyo Boxes', false, 1, 0, 'suggested', 'No assembly. Handling and carry only.'),
  ('Training Balls', false, 1, 0, 'suggested', 'No assembly. Handling and carry only.'),
  ('Studio Barbells', false, 1, 0, 'suggested', 'No assembly. Handling and carry only.'),
  ('Suspension Training', false, 1, 0, 'suggested', 'No assembly. Handling and carry only.')
on conflict (category) do nothing;

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
  return public.orbit_cin7_category_defaults();
end;
$$;

create or replace function public.orbit_categories_without_default()
returns jsonb
language plpgsql
stable
security definer
set search_path = ops, core, public
as $$
begin
  if not core.is_ops_owner() then
    raise exception 'app: Only the owner can read category gaps.';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'category', cin7_category,
      'sku_count', sku_count
    ) order by sku_count desc, cin7_category)
    from (
      select e.cin7_category, count(*)::integer as sku_count
      from ops.sku_effort e
      left join ops.cin7_category_defaults d on d.category = e.cin7_category
      where e.cin7_category is not null
        and d.category is null
      group by e.cin7_category
    ) gaps
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.orbit_categories_without_default() from public, anon;
grant execute on function public.orbit_categories_without_default() to authenticated, service_role;
