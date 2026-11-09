-- Flooring is priced per tile. Sled tracks are a suggested on-site profile and run after the floor.

alter table ops.cin7_category_defaults
  add column if not exists effort_unit text not null default 'each' check (effort_unit in ('each', 'tile', 'm2'));

alter table ops.sku_effort
  add column if not exists effort_unit text not null default 'each' check (effort_unit in ('each', 'tile', 'm2')),
  add column if not exists cin7_uom text;

alter table ops.cin7_category_defaults
  alter column build_minutes type numeric(8,2);

alter table ops.sku_effort
  alter column build_minutes type numeric(8,2);

update ops.cin7_category_defaults
set needs_assembly = true,
    crew = 2,
    build_minutes = 2.4,
    effort_unit = 'tile',
    build_location = 'site',
    notes = 'A 2-man crew lays about 200 tiles in an 8-hour day: 2.4 minutes per tile.',
    updated_at = now()
where category = 'Gym Flooring';

insert into ops.cin7_category_defaults (
  category, needs_assembly, crew, build_minutes, effort_unit, build_location, status, notes
) values (
  'Gym Flooring', true, 2, 2.4, 'tile', 'site', 'suggested',
  'A 2-man crew lays about 200 tiles in an 8-hour day: 2.4 minutes per tile.'
)
on conflict (category) do nothing;

create or replace function ops.sled_track_suggestion(p_name text)
returns boolean
language sql
immutable
as $$
  select coalesce(p_name, '') ~* 'sled track';
$$;

revoke all on function ops.sled_track_suggestion(text) from public, anon, authenticated;

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
    and not ops.sled_track_suggestion(e.product_name);

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
    and not ops.sled_track_suggestion(e.product_name);

  update ops.sku_effort e
  set needs_assembly = true,
      crew = 2,
      build_minutes = 180,
      effort_unit = 'each',
      build_location = 'site',
      hq_build_minutes = null,
      hq_build_crew = null,
      site_position_minutes = null,
      suggestion_rule = 'sled-track',
      updated_at = now()
  where e.status = 'suggested'
    and ops.sled_track_suggestion(e.product_name);
end;
$$;

select ops.apply_suggested_profiles();

create or replace function public.orbit_job_workings(p_job_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ops, core, public
as $$
begin
  if not (
    core.is_ops_owner()
    or core.has_ops_role(array['install_lead', 'admin_owner', 'ops_manager'])
  ) then
    return null;
  end if;
  return (
    select q.inputs -> 'workings'
    from ops.quote_versions q
    where q.job_id = p_job_id
      and q.inputs ? 'workings'
    order by q.created_at desc
    limit 1
  );
end;
$$;

revoke all on function public.orbit_job_workings(uuid) from public, anon;
grant execute on function public.orbit_job_workings(uuid) to authenticated, service_role;

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
      'status', status
    ))
    from ops.sku_effort
    where sku = any(p_skus)
  ), '[]'::jsonb);
end;
$$;
