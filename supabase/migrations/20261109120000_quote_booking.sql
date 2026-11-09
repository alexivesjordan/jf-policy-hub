-- Quote booking: required resources, pencil days, and an ops manager override.
-- No Cin7 calls. Sales can read requirements and cannot write them.

alter table core.ops_roles drop constraint if exists ops_roles_ops_role_check;
alter table core.ops_roles
  add constraint ops_roles_ops_role_check
  check (ops_role in ('sales', 'install_lead', 'installer', 'hq', 'admin_owner', 'ops_manager'));

comment on column core.ops_roles.ops_role is
  'ops_manager is the operations manager (Simon). That role can override required resources. Sales cannot.';

create or replace function ops.job_visible(p_job_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ops, core, public
as $$
  select exists (
    select 1
    from ops.install_jobs j
    where j.id = p_job_id
      and (
        core.has_ops_role(array['install_lead', 'admin_owner', 'ops_manager', 'hq'])
        or (
          core.has_ops_role(array['sales'])
          and j.owner_rep_id = auth.uid()
        )
        or (
          core.has_ops_role(array['installer'])
          and exists (
            select 1
            from ops.reservations r
            join ops.resources res on res.id = r.resource_id
            where r.job_id = j.id
              and res.profile_id = auth.uid()
              and r.day between current_date and current_date + 1
          )
        )
      )
  );
$$;

create or replace function ops.money_visible(p_job_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ops, core, public
as $$
  select core.has_ops_role(array['install_lead', 'admin_owner', 'ops_manager'])
    and exists (select 1 from ops.install_jobs j where j.id = p_job_id);
$$;

create table ops.job_requirements (
  job_id uuid primary key references ops.install_jobs (id) on delete cascade,
  installers integer not null check (installers > 0 and installers <= 20),
  licensed_drivers integer not null check (licensed_drivers >= 0 and licensed_drivers <= 10),
  van_size text not null check (van_size in ('small', 'crafter')),
  van_count integer not null check (van_count > 0 and van_count <= 10),
  stair_climber boolean not null default false,
  overridden boolean not null default false,
  conflict boolean not null default false,
  conflict_detail text,
  updated_at timestamptz not null default now()
);

comment on table ops.job_requirements is
  'Crew, vans, and stair climber required by the pricer. Sales may select the row and may not update it.';

alter table ops.job_requirements enable row level security;

revoke all on table ops.job_requirements from public, anon, authenticated;
grant select on table ops.job_requirements to authenticated;
grant all on table ops.job_requirements to service_role;

create policy job_requirements_select
on ops.job_requirements
for select
to authenticated
using (ops.job_visible(job_id));

create or replace function public.orbit_job_requirements(p_job_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ops, core, public
as $$
declare
  v_row ops.job_requirements%rowtype;
begin
  if auth.uid() is null and coalesce(auth.role(), '') is distinct from 'service_role' then
    raise exception 'app: You need to be signed in.';
  end if;
  if coalesce(auth.role(), '') is distinct from 'service_role' and not ops.job_visible(p_job_id) then
    return null;
  end if;
  select * into v_row from ops.job_requirements where job_id = p_job_id;
  if v_row.job_id is null then
    return null;
  end if;
  return jsonb_build_object(
    'installers', v_row.installers,
    'licensed_drivers', v_row.licensed_drivers,
    'van_size', v_row.van_size,
    'van_count', v_row.van_count,
    'stair_climber', v_row.stair_climber,
    'overridden', v_row.overridden,
    'conflict', v_row.conflict,
    'conflict_detail', v_row.conflict_detail
  );
end;
$$;

create or replace function public.orbit_save_job_requirements(
  p_job_id uuid,
  p_installers integer,
  p_licensed_drivers integer,
  p_van_size text,
  p_van_count integer,
  p_stair_climber boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ops, core, public
as $$
begin
  if coalesce(auth.role(), '') is distinct from 'service_role' then
    raise exception 'app: Required resources are written by the pricer, not from the browser.';
  end if;
  if p_van_size not in ('small', 'crafter') then
    raise exception 'app: That van size is not valid.';
  end if;
  if exists (
    select 1 from ops.job_requirements
    where job_id = p_job_id and overridden
  ) then
    return jsonb_build_object('job_id', p_job_id, 'kept', true);
  end if;
  insert into ops.job_requirements (
    job_id, installers, licensed_drivers, van_size, van_count, stair_climber, overridden, conflict
  ) values (
    p_job_id, p_installers, p_licensed_drivers, p_van_size, p_van_count, p_stair_climber, false, false
  )
  on conflict (job_id) do update
    set installers = excluded.installers,
        licensed_drivers = excluded.licensed_drivers,
        van_size = excluded.van_size,
        van_count = excluded.van_count,
        stair_climber = excluded.stair_climber,
        overridden = false,
        conflict = false,
        conflict_detail = null,
        updated_at = now();
  return jsonb_build_object('job_id', p_job_id, 'kept', false);
end;
$$;

-- Null when the resource ids cover the requirement. Otherwise a short reason.
create or replace function ops.assignment_problem(
  p_installers integer,
  p_drivers integer,
  p_van_size text,
  p_van_count integer,
  p_climber boolean,
  p_ids uuid[],
  p_day date,
  p_ignore_job uuid
)
returns text
language plpgsql
stable
security definer
set search_path = ops, public
as $$
declare
  v_found integer;
  v_installers integer;
  v_drivers integer;
  v_vans integer;
  v_climbers integer;
begin
  if p_ids is null or cardinality(p_ids) = 0 then
    return 'No resources were selected.';
  end if;
  if (select count(distinct id) from unnest(p_ids) as picked(id)) <> cardinality(p_ids) then
    return 'A resource was listed twice.';
  end if;

  select count(*) into v_found
  from ops.resources r
  join unnest(p_ids) as picked(id) on picked.id = r.id
  where r.status = 'active'
    and (
      r.resource_type = 'installer'
      or (r.resource_type = 'climber' and p_climber)
      or (
        r.resource_type = 'van'
        and case when r.name ilike '%crafter%' then 'crafter' else 'small' end = p_van_size
      )
      or (r.resource_type <> 'installer' and r.has_licence and r.insured)
    )
    and not exists (
      select 1 from ops.unavailability u
      where u.resource_id = r.id and p_day between u.starts_on and u.ends_on
    )
    and not exists (
      select 1 from ops.reservations rv
      where rv.resource_id = r.id
        and rv.day = p_day
        and (p_ignore_job is null or rv.job_id <> p_ignore_job)
    );

  if v_found <> cardinality(p_ids) then
    return 'A selected resource is unavailable or cannot fill this job.';
  end if;

  select
    count(*) filter (where r.resource_type = 'installer'),
    count(*) filter (
      where (r.resource_type = 'installer' and r.has_licence)
         or (r.has_licence and r.insured)
    ),
    count(*) filter (
      where r.resource_type = 'van'
        and case when r.name ilike '%crafter%' then 'crafter' else 'small' end = p_van_size
    ),
    count(*) filter (where r.resource_type = 'climber')
  into v_installers, v_drivers, v_vans, v_climbers
  from ops.resources r
  join unnest(p_ids) as picked(id) on picked.id = r.id;

  if v_installers <> p_installers then
    return 'Installer count does not match the job.';
  end if;
  if v_drivers < p_drivers then
    return 'A licensed driver is missing.';
  end if;
  if v_vans <> p_van_count then
    return 'Van count does not match the job.';
  end if;
  if v_climbers <> (case when p_climber then 1 else 0 end) then
    return 'Stair climber does not match the job.';
  end if;
  return null;
end;
$$;

create or replace function public.orbit_pencil_day(
  p_job_id uuid,
  p_day date,
  p_resource_ids uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = ops, core, public
as $$
declare
  v_job ops.install_jobs%rowtype;
  v_need ops.job_requirements%rowtype;
  v_problem text;
begin
  if auth.uid() is null then
    raise exception 'app: You need to be signed in.';
  end if;
  select * into v_job from ops.install_jobs where id = p_job_id;
  if v_job.id is null then
    raise exception 'app: That job was not found.';
  end if;
  if not (
    core.has_ops_role(array['install_lead', 'admin_owner', 'ops_manager'])
    or core.is_ops_owner()
    or (core.has_ops_role(array['sales']) and v_job.owner_rep_id = auth.uid())
  ) then
    raise exception 'app: You cannot pencil that job.';
  end if;
  if coalesce(v_job.cin7_number, '') not like 'FIXTURE-%' then
    raise exception 'app: Only a FIXTURE job can be pencilled until Cin7 is connected.';
  end if;
  select * into v_need from ops.job_requirements where job_id = p_job_id;
  if v_need.job_id is null then
    raise exception 'app: This job has no required resources yet.';
  end if;

  v_problem := ops.assignment_problem(
    v_need.installers,
    v_need.licensed_drivers,
    v_need.van_size,
    v_need.van_count,
    v_need.stair_climber,
    p_resource_ids,
    p_day,
    p_job_id
  );
  if v_problem is not null then
    raise exception 'app: %', v_problem;
  end if;

  delete from ops.reservations
  where job_id = p_job_id and kind = 'pencil' and day = p_day;

  insert into ops.reservations (resource_id, job_id, day, kind)
  select picked.id, p_job_id, p_day, 'pencil'
  from unnest(p_resource_ids) as picked(id);

  update ops.install_jobs
  set requested_date = p_day
  where id = p_job_id;

  update ops.job_requirements
  set conflict = false, conflict_detail = null, updated_at = now()
  where job_id = p_job_id;

  return jsonb_build_object('job_id', p_job_id, 'day', p_day, 'kind', 'pencil');
end;
$$;

create or replace function public.orbit_override_requirements(
  p_job_id uuid,
  p_installers integer,
  p_licensed_drivers integer,
  p_van_size text,
  p_van_count integer,
  p_stair_climber boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ops, core, public
as $$
declare
  v_old ops.job_requirements%rowtype;
  v_rep uuid;
  v_day date;
  v_ids uuid[];
  v_problem text;
  v_conflicts text[] := '{}';
begin
  if not (
    core.is_ops_owner()
    or core.has_ops_role(array['admin_owner', 'ops_manager'])
  ) then
    raise exception 'app: A sales rep cannot change required resources.';
  end if;
  if p_van_size not in ('small', 'crafter') then
    raise exception 'app: That van size is not valid.';
  end if;
  if p_installers < 1 or p_van_count < 1 or p_licensed_drivers < 0 then
    raise exception 'app: Those resource numbers are not valid.';
  end if;

  select * into v_old from ops.job_requirements where job_id = p_job_id;
  if v_old.job_id is null then
    raise exception 'app: This job has no required resources yet.';
  end if;

  update ops.job_requirements
  set installers = p_installers,
      licensed_drivers = p_licensed_drivers,
      van_size = p_van_size,
      van_count = p_van_count,
      stair_climber = p_stair_climber,
      overridden = true,
      updated_at = now()
  where job_id = p_job_id;

  insert into core.audit_log (
    actor_id, module_id, entity_schema, entity_table, entity_id,
    action, field_name, old_value, new_value
  ) values (
    auth.uid(),
    'operations',
    'ops',
    'job_requirements',
    p_job_id,
    'update',
    'requirements',
    jsonb_build_object(
      'installers', v_old.installers,
      'licensed_drivers', v_old.licensed_drivers,
      'van_size', v_old.van_size,
      'van_count', v_old.van_count,
      'stair_climber', v_old.stair_climber
    ),
    jsonb_build_object(
      'installers', p_installers,
      'licensed_drivers', p_licensed_drivers,
      'van_size', p_van_size,
      'van_count', p_van_count,
      'stair_climber', p_stair_climber
    )
  );

  for v_day in
    select distinct day from ops.reservations
    where job_id = p_job_id and kind = 'pencil'
    order by day
  loop
    select array_agg(resource_id) into v_ids
    from ops.reservations
    where job_id = p_job_id and kind = 'pencil' and day = v_day;
    v_problem := ops.assignment_problem(
      p_installers, p_licensed_drivers, p_van_size, p_van_count, p_stair_climber,
      v_ids, v_day, p_job_id
    );
    if v_problem is not null then
      v_conflicts := v_conflicts || format('%s: %s', v_day, v_problem);
    end if;
  end loop;

  if cardinality(v_conflicts) > 0 then
    update ops.job_requirements
    set conflict = true,
        conflict_detail = array_to_string(v_conflicts, '; ')
    where job_id = p_job_id;
    select owner_rep_id into v_rep from ops.install_jobs where id = p_job_id;
    if v_rep is not null then
      insert into core.notifications (user_id, title, body, kind, link, entity_schema, entity_table, entity_id)
      values (
        v_rep,
        'Pencil booking no longer fits',
        'Required resources changed and the pencilled day does not cover them. ' || array_to_string(v_conflicts, '; '),
        'requirements_conflict',
        '/operations/jobs/' || p_job_id::text,
        'ops',
        'install_jobs',
        p_job_id
      );
    end if;
  else
    update ops.job_requirements
    set conflict = false, conflict_detail = null
    where job_id = p_job_id;
  end if;

  return public.orbit_job_requirements(p_job_id);
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
  if not core.has_ops_role(array['sales', 'install_lead', 'installer', 'hq', 'admin_owner', 'ops_manager'])
     and not core.is_ops_owner() then
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

revoke all on function public.orbit_job_requirements(uuid) from public, anon;
revoke all on function public.orbit_save_job_requirements(uuid, integer, integer, text, integer, boolean) from public, anon, authenticated;
revoke all on function public.orbit_pencil_day(uuid, date, uuid[]) from public, anon;
revoke all on function public.orbit_override_requirements(uuid, integer, integer, text, integer, boolean) from public, anon;
revoke all on function ops.assignment_problem(integer, integer, text, integer, boolean, uuid[], date, uuid) from public, anon, authenticated;

grant execute on function public.orbit_job_requirements(uuid) to authenticated, service_role;
grant execute on function public.orbit_save_job_requirements(uuid, integer, integer, text, integer, boolean) to service_role;
grant execute on function public.orbit_pencil_day(uuid, date, uuid[]) to authenticated, service_role;
grant execute on function public.orbit_override_requirements(uuid, integer, integer, text, integer, boolean) to authenticated, service_role;
grant execute on function ops.assignment_problem(integer, integer, text, integer, boolean, uuid[], date, uuid) to service_role;
