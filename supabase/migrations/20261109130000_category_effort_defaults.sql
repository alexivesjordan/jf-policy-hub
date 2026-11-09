-- Per-category build assumption. Append a version; do not edit a row in place.
-- The seeded note is the SO-00490 assumption: each machine is a 2-man, 2-hour build.
-- Weights and flooring are omitted; they are not tagged machines.

create table ops.category_effort_defaults (
  id uuid primary key default gen_random_uuid(),
  version integer not null check (version > 0),
  category text not null check (char_length(trim(category)) between 1 and 80),
  build_crew integer not null check (build_crew between 1 and 6),
  build_minutes integer not null check (build_minutes between 0 and 480),
  note text not null,
  changed_by uuid references public.profiles (id) on delete set null,
  change_reason text,
  created_at timestamptz not null default now(),
  unique (version, category)
);

comment on table ops.category_effort_defaults is
  'Owner-edited effort used when a quote line has no exact product row. Current rows are the highest version.';

alter table ops.category_effort_defaults enable row level security;
revoke all on table ops.category_effort_defaults from public, anon, authenticated;
grant select on table ops.category_effort_defaults to service_role;

create or replace function public.orbit_category_effort_defaults()
returns jsonb
language plpgsql
stable
security definer
set search_path = ops, core, public
as $$
declare
  v_version integer;
begin
  if coalesce(auth.role(), '') is distinct from 'service_role'
     and not core.has_ops_role(array['sales', 'install_lead', 'admin_owner', 'ops_manager', 'hq'])
     and not core.is_ops_owner() then
    raise exception 'app: You cannot read effort defaults.';
  end if;
  select coalesce(max(version), 0) into v_version from ops.category_effort_defaults;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'version', d.version,
      'category', d.category,
      'build_crew', d.build_crew,
      'build_minutes', d.build_minutes,
      'note', d.note
    ) order by d.category)
    from ops.category_effort_defaults d
    where d.version = v_version
  ), '[]'::jsonb);
end;
$$;

create or replace function public.orbit_save_category_effort_defaults(
  p_rows jsonb,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ops, core, public
as $$
declare
  v_version integer;
  v_row jsonb;
begin
  if not core.is_ops_owner() then
    raise exception 'app: Only the owner can change category effort defaults.';
  end if;
  if p_reason is null or char_length(trim(p_reason)) < 3 then
    raise exception 'app: Add a short reason.';
  end if;
  if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception 'app: Add at least one category.';
  end if;
  select coalesce(max(version), 0) + 1 into v_version from ops.category_effort_defaults;
  for v_row in select value from jsonb_array_elements(p_rows)
  loop
    insert into ops.category_effort_defaults (
      version, category, build_crew, build_minutes, note, changed_by, change_reason
    ) values (
      v_version,
      trim(v_row->>'category'),
      (v_row->>'build_crew')::integer,
      (v_row->>'build_minutes')::integer,
      coalesce(nullif(trim(v_row->>'note'), ''), 'Category build default'),
      auth.uid(),
      trim(p_reason)
    );
  end loop;
  return public.orbit_category_effort_defaults();
end;
$$;

revoke all on function public.orbit_category_effort_defaults() from public, anon;
revoke all on function public.orbit_save_category_effort_defaults(jsonb, text) from public, anon;
grant execute on function public.orbit_category_effort_defaults() to authenticated, service_role;
grant execute on function public.orbit_save_category_effort_defaults(jsonb, text) to authenticated, service_role;

insert into ops.category_effort_defaults (version, category, build_crew, build_minutes, note, change_reason)
select
  1,
  category,
  2,
  120,
  'Each machine: 2-man, 2-hour build.',
  'Seed from the SO-00490 worked example. Not a product-specific effort row.'
from (
  values
    ('bench'),
    ('cable'),
    ('cardio'),
    ('pilates'),
    ('rack-rig'),
    ('storage'),
    ('strength-plate-loaded'),
    ('strength-selectorised')
) as seeded(category);
