-- Multi-day pencil bookings. Weekends are refused for everyone except the owner roles.
-- The fixture-only pencil gate is removed: a live Cin7 sale and an uploaded quote can be booked.

alter table ops.job_requirements
  add column if not exists install_days integer not null default 1 check (install_days >= 1);

alter table ops.install_jobs
  add column if not exists requested_end date;

comment on column ops.job_requirements.install_days is
  'Working days from the priced crew plan. A pencil reserves every day in the range.';

comment on column ops.install_jobs.requested_end is
  'Last day of the pencilled range. requested_date is the first day.';

update ops.job_requirements r
set install_days = greatest(1, coalesce((
  select (q.inputs #>> '{workings,breakdown,days}')::integer
  from ops.quote_versions q
  where q.job_id = r.job_id
    and (q.inputs #>> '{workings,breakdown,days}') ~ '^[0-9]+$'
  order by q.created_at desc
  limit 1
), 1))
where r.install_days = 1;

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
    'install_days', v_row.install_days,
    'overridden', v_row.overridden,
    'conflict', v_row.conflict,
    'conflict_detail', v_row.conflict_detail
  );
end;
$$;

drop function if exists public.orbit_save_job_requirements(uuid, integer, integer, text, integer, boolean);

create function public.orbit_save_job_requirements(
  p_job_id uuid,
  p_installers integer,
  p_licensed_drivers integer,
  p_van_size text,
  p_van_count integer,
  p_stair_climber boolean,
  p_install_days integer default 1
)
returns jsonb
language plpgsql
security definer
set search_path = ops, core, public
as $$
declare
  v_days integer := greatest(coalesce(p_install_days, 1), 1);
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
    update ops.job_requirements
    set install_days = v_days, updated_at = now()
    where job_id = p_job_id;
    return jsonb_build_object('job_id', p_job_id, 'kept', true);
  end if;
  insert into ops.job_requirements (
    job_id, installers, licensed_drivers, van_size, van_count, stair_climber, install_days, overridden, conflict
  ) values (
    p_job_id, p_installers, p_licensed_drivers, p_van_size, p_van_count, p_stair_climber, v_days, false, false
  )
  on conflict (job_id) do update
    set installers = excluded.installers,
        licensed_drivers = excluded.licensed_drivers,
        van_size = excluded.van_size,
        van_count = excluded.van_count,
        stair_climber = excluded.stair_climber,
        install_days = excluded.install_days,
        overridden = false,
        conflict = false,
        conflict_detail = null,
        updated_at = now();
  return jsonb_build_object('job_id', p_job_id, 'kept', false);
end;
$$;

revoke all on function public.orbit_save_job_requirements(uuid, integer, integer, text, integer, boolean, integer) from public, anon, authenticated;
grant execute on function public.orbit_save_job_requirements(uuid, integer, integer, text, integer, boolean, integer) to service_role;

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
begin
  return public.orbit_pencil_range(p_job_id, p_day, false, p_resource_ids);
end;
$$;

create or replace function public.orbit_pencil_range(
  p_job_id uuid,
  p_start date,
  p_allow_weekends boolean,
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
  v_owner boolean;
  v_dates date[] := '{}';
  v_cursor date;
  v_guard integer := 0;
  v_day date;
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
  select * into v_need from ops.job_requirements where job_id = p_job_id;
  if v_need.job_id is null then
    raise exception 'app: This job has no required resources yet.';
  end if;

  v_owner := core.is_ops_owner() or core.has_ops_role(array['admin_owner', 'ops_manager']);
  if coalesce(p_allow_weekends, false) and not v_owner then
    raise exception 'app: Weekend installs can only be pencilled by the owner.';
  end if;
  if extract(dow from p_start) in (0, 6) and not (v_owner and coalesce(p_allow_weekends, false)) then
    raise exception 'app: Weekend installs can only be pencilled by the owner.';
  end if;

  v_cursor := p_start;
  while cardinality(v_dates) < v_need.install_days and v_guard < 400 loop
    v_guard := v_guard + 1;
    if coalesce(p_allow_weekends, false) or extract(dow from v_cursor) not in (0, 6) then
      v_dates := v_dates || v_cursor;
    end if;
    v_cursor := v_cursor + 1;
  end loop;

  if cardinality(v_dates) < v_need.install_days then
    raise exception 'app: That start day does not cover the install.';
  end if;

  foreach v_day in array v_dates loop
    if extract(dow from v_day) in (0, 6) and not v_owner then
      raise exception 'app: Weekend installs can only be pencilled by the owner.';
    end if;
    v_problem := ops.assignment_problem(
      v_need.installers,
      v_need.licensed_drivers,
      v_need.van_size,
      v_need.van_count,
      v_need.stair_climber,
      p_resource_ids,
      v_day,
      p_job_id
    );
    if v_problem is not null then
      raise exception 'app: %', v_problem;
    end if;
  end loop;

  delete from ops.reservations
  where job_id = p_job_id and kind = 'pencil';

  insert into ops.reservations (resource_id, job_id, day, kind)
  select picked.id, p_job_id, booked.day, 'pencil'
  from unnest(p_resource_ids) as picked(id)
  cross join unnest(v_dates) as booked(day);

  update ops.install_jobs
  set requested_date = v_dates[1],
      requested_end = v_dates[cardinality(v_dates)]
  where id = p_job_id;

  update ops.job_requirements
  set conflict = false, conflict_detail = null, updated_at = now()
  where job_id = p_job_id;

  return jsonb_build_object(
    'job_id', p_job_id,
    'start', v_dates[1],
    'end', v_dates[cardinality(v_dates)],
    'days', cardinality(v_dates),
    'kind', 'pencil'
  );
end;
$$;

revoke all on function public.orbit_pencil_range(uuid, date, boolean, uuid[]) from public, anon;
grant execute on function public.orbit_pencil_range(uuid, date, boolean, uuid[]) to authenticated, service_role;

create or replace function public.orbit_set_job_status(p_job_id uuid, p_status text)
returns jsonb
language plpgsql
security definer
set search_path = ops, core, public
as $$
declare
  v_old ops.job_status;
begin
  if not (
    core.is_ops_owner()
    or core.has_ops_role(array['admin_owner', 'ops_manager'])
  ) then
    raise exception 'app: Only the owner can move a job.';
  end if;
  if p_status is null or p_status not in (
    'priced', 'sub_price_pending', 'ordered', 'awaiting_access', 'variation',
    'ready_to_book', 'booked', 'in_build', 'ready_to_dispatch', 'on_site',
    'completed', 'closed', 'on_hold', 'lost_cancelled'
  ) then
    raise exception 'app: That status is not on the job pipeline.';
  end if;
  select status into v_old from ops.install_jobs where id = p_job_id;
  if v_old is null then
    raise exception 'app: That job was not found.';
  end if;
  perform set_config('ops.allow_status_change', 'on', true);
  update ops.install_jobs
  set status = p_status::ops.job_status
  where id = p_job_id;
  perform set_config('ops.allow_status_change', 'off', true);
  insert into core.audit_log (
    actor_id, module_id, entity_schema, entity_table, entity_id,
    action, field_name, old_value, new_value
  ) values (
    auth.uid(), 'operations', 'ops', 'install_jobs', p_job_id,
    'update', 'status', to_jsonb(v_old), to_jsonb(p_status)
  );
  return jsonb_build_object('job_id', p_job_id, 'status', p_status);
end;
$$;

revoke all on function public.orbit_set_job_status(uuid, text) from public, anon;
grant execute on function public.orbit_set_job_status(uuid, text) to authenticated, service_role;

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
        'cin7_order_number', j.cin7_order_number,
        'fixture', coalesce(j.cin7_number, '') like 'FIXTURE-%',
        'customer_name', c.name,
        'customer_segment', c.segment,
        'customer_type', c.customer_type,
        'postcode', s.postcode,
        'city', s.city,
        'big_install', j.big_install,
        'hold_reason', j.hold_reason,
        'requested_date', j.requested_date,
        'requested_end', j.requested_end,
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
