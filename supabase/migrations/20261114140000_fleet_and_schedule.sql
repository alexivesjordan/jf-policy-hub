-- Fleet fields on ops.vans, plus the office schedule and overview reads.
-- Mileage, defects, documents, and assignments are intentionally not here yet.
-- New file only. Do not edit earlier migrations. Do not apply this to production.

alter table ops.vans
  add column if not exists make_model text,
  add column if not exists mot_due date,
  add column if not exists tax_due date,
  add column if not exists insurance_due date,
  add column if not exists service_due date,
  add column if not exists notes text;

comment on table ops.vans is
  'Vehicle record used by the job sheet and the schedule. Mileage, defects, documents, and assignments can be added later.';

alter table ops.vans drop constraint if exists vans_notes_length;
alter table ops.vans
  add constraint vans_notes_length check (notes is null or char_length(notes) <= 2000);

alter table ops.vans drop constraint if exists vans_make_model_length;
alter table ops.vans
  add constraint vans_make_model_length check (make_model is null or char_length(make_model) <= 80);

create or replace function public.install_manage_vans()
returns jsonb
language plpgsql
stable
security definer
set search_path = ops, public
as $$
begin
  if ops.is_field_engineer() and not public.workspace_is_admin() then
    raise exception 'app: You cannot change the vans.';
  end if;
  if not (public.workspace_can('operations', 'view') or public.workspace_is_admin()) then
    raise exception 'app: You cannot see the fleet.';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', id,
      'registration', registration,
      'name', name,
      'makeModel', make_model,
      'motDue', mot_due,
      'taxDue', tax_due,
      'insuranceDue', insurance_due,
      'serviceDue', service_due,
      'notes', notes,
      'active', active
    ) order by active desc, registration)
    from ops.vans
  ), '[]'::jsonb);
end;
$$;

drop function if exists public.install_save_van(uuid, text, text, boolean);

create function public.install_save_van(
  p_id uuid,
  p_registration text,
  p_name text,
  p_active boolean,
  p_make_model text default null,
  p_mot_due date default null,
  p_tax_due date default null,
  p_insurance_due date default null,
  p_service_due date default null,
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = ops, public
as $$
declare
  v_reg text := upper(regexp_replace(btrim(coalesce(p_registration, '')), '[[:space:]]+', ' ', 'g'));
  v_key text := regexp_replace(v_reg, '[[:space:]]', '', 'g');
  v_name text := nullif(btrim(coalesce(p_name, '')), '');
  v_model text := nullif(btrim(coalesce(p_make_model, '')), '');
  v_notes text := nullif(btrim(coalesce(p_notes, '')), '');
  v_before jsonb;
  v_id uuid := p_id;
begin
  if not public.workspace_is_admin() then
    raise exception 'app: You cannot change the vans.';
  end if;
  if v_key = '' or char_length(v_key) > 12 then
    raise exception 'app: Enter the registration.';
  end if;
  if v_name is not null and char_length(v_name) > 80 then
    raise exception 'app: Enter a shorter name.';
  end if;
  if v_model is not null and char_length(v_model) > 80 then
    raise exception 'app: Enter a shorter make and model.';
  end if;
  if v_notes is not null and char_length(v_notes) > 2000 then
    raise exception 'app: Shorten the note.';
  end if;
  if exists (
    select 1 from ops.vans
    where regexp_replace(upper(registration), '[[:space:]]', '', 'g') = v_key
      and id is distinct from p_id
  ) then
    raise exception 'app: That registration is already on the list.';
  end if;
  if p_id is null then
    insert into ops.vans (
      registration, name, active, make_model, mot_due, tax_due, insurance_due, service_due, notes
    ) values (
      v_reg, v_name, coalesce(p_active, true), v_model, p_mot_due, p_tax_due, p_insurance_due, p_service_due, v_notes
    )
    returning id into v_id;
    perform public.write_access_audit(
      'van.created', 'van', v_id, null,
      jsonb_build_object('registration', v_reg, 'makeModel', v_model, 'active', coalesce(p_active, true))
    );
    return v_id;
  end if;
  select jsonb_build_object('registration', registration, 'name', name, 'active', active, 'makeModel', make_model)
  into v_before
  from ops.vans where id = p_id;
  if v_before is null then
    raise exception 'app: That van was not found.';
  end if;
  update ops.vans
  set registration = v_reg,
      name = v_name,
      active = coalesce(p_active, active),
      make_model = v_model,
      mot_due = p_mot_due,
      tax_due = p_tax_due,
      insurance_due = p_insurance_due,
      service_due = p_service_due,
      notes = v_notes
  where id = p_id
  returning id into v_id;
  perform public.write_access_audit(
    'van.updated', 'van', v_id, v_before,
    jsonb_build_object('registration', v_reg, 'makeModel', v_model, 'active', coalesce(p_active, active))
  );
  return v_id;
end;
$$;

create or replace function public.ops_schedule(p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ops, public
as $$
declare
  v_events jsonb := '[]'::jsonb;
begin
  if ops.is_field_engineer() and not public.workspace_is_admin() then
    raise exception 'app: You cannot see the schedule.';
  end if;
  if not (public.workspace_can('operations', 'view') or public.workspace_is_admin()) then
    raise exception 'app: You cannot see the schedule.';
  end if;
  if p_from is null or p_to is null or p_to < p_from or p_to > p_from + 21 then
    raise exception 'app: Choose a week.';
  end if;

  v_events := v_events || coalesce((
    select jsonb_agg(jsonb_build_object(
      'rowKind', 'engineer', 'rowId', ir.resource_id, 'day', ir.day,
      'kind', 'job', 'label', i.order_number, 'href', '/operations/installs/' || i.id
    ))
    from ops.install_reservations ir
    join ops.installs i on i.id = ir.install_id
    where ir.day between p_from and p_to
      and i.status <> 'cancelled'
      and i.archived_at is null
      and extract(isodow from ir.day) < 6
  ), '[]'::jsonb);

  v_events := v_events || coalesce((
    select jsonb_agg(jsonb_build_object(
      'rowKind', 'engineer', 'rowId', rv.resource_id, 'day', rv.day,
      'kind', 'job', 'label', coalesce(j.cin7_order_number, j.cin7_number, 'Job'),
      'href', '/operations/jobs/' || j.id
    ))
    from ops.reservations rv
    join ops.install_jobs j on j.id = rv.job_id
    where rv.day between p_from and p_to
      and extract(isodow from rv.day) < 6
  ), '[]'::jsonb);

  v_events := v_events || coalesce((
    select jsonb_agg(jsonb_build_object(
      'rowKind', 'engineer', 'rowId', u.resource_id, 'day', d::date,
      'kind', 'absence', 'label', u.reason, 'href', null
    ))
    from ops.unavailability u
    cross join lateral generate_series(greatest(u.starts_on, p_from), least(u.ends_on, p_to), interval '1 day') d
    where u.ends_on >= p_from and u.starts_on <= p_to
      and extract(isodow from d) < 6
  ), '[]'::jsonb);

  v_events := v_events || coalesce((
    select jsonb_agg(jsonb_build_object(
      'rowKind', 'engineer', 'rowId', r.id, 'day', d::date,
      'kind', 'absence', 'label', e.entry_type, 'href', '/people/calendar'
    ))
    from public.calendar_entries e
    join ops.resources r on r.profile_id = e.profile_id
    cross join lateral generate_series(greatest(e.starts_on, p_from), least(e.ends_on, p_to), interval '1 day') d
    where e.request_status = 'confirmed'
      and e.entry_type in ('annual_leave', 'sick', 'other_absence')
      and e.ends_on >= p_from and e.starts_on <= p_to
      and extract(isodow from d) < 6
  ), '[]'::jsonb);

  v_events := v_events || coalesce((
    select jsonb_agg(jsonb_build_object(
      'rowKind', 'van', 'rowId', v.id, 'day', d::date,
      'kind', 'booking', 'label', i.order_number, 'href', '/operations/installs/' || i.id
    ))
    from ops.visit_sheets s
    join ops.installs i on i.id = s.install_id
    join ops.vans v
      on regexp_replace(upper(v.registration), '[[:space:]]', '', 'g')
       = regexp_replace(upper(s.vehicle_reg), '[[:space:]]', '', 'g')
    cross join lateral generate_series(i.start_on, i.end_on, interval '1 day') d
    where v.active
      and s.vehicle_reg is not null
      and i.start_on is not null
      and i.end_on is not null
      and i.status <> 'cancelled'
      and i.archived_at is null
      and i.end_on >= p_from
      and i.start_on <= p_to
      and d::date between p_from and p_to
      and extract(isodow from d) < 6
  ), '[]'::jsonb);

  return jsonb_build_object(
    'engineers', coalesce((
      select jsonb_agg(jsonb_build_object('id', r.id, 'name', r.name, 'profileId', r.profile_id) order by r.name)
      from ops.resources r
      where r.status = 'active' and r.resource_type in ('installer', 'helper', 'driver')
    ), '[]'::jsonb),
    'vans', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', v.id, 'registration', v.registration, 'makeModel', v.make_model
      ) order by v.registration)
      from ops.vans v
      where v.active
    ), '[]'::jsonb),
    'events', v_events
  );
end;
$$;

create or replace function public.ops_pulse()
returns jsonb
language plpgsql
stable
security definer
set search_path = ops, core, public
as $$
declare
  v_today date := (timezone('Europe/London', now()))::date;
  v_week_start date := v_today - (extract(isodow from v_today)::integer - 1);
  v_week_end date := v_week_start + 4;
  v_soon date := v_today + 30;
begin
  if ops.is_field_engineer() and not public.workspace_is_admin() then
    raise exception 'app: You cannot see the office.';
  end if;
  if not (public.workspace_can('operations', 'view') or public.workspace_is_admin()) then
    raise exception 'app: You cannot see the office.';
  end if;

  return jsonb_build_object(
    'today', v_today,
    'weekStart', v_week_start,
    'weekEnd', v_week_end,
    'installsToday', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', i.id, 'orderNumber', i.order_number, 'customerName', i.customer_name, 'startOn', i.start_on
      ) order by i.order_number)
      from ops.installs i
      where i.archived_at is null and i.status not in ('cancelled', 'completed')
        and i.start_on is not null and i.end_on is not null
        and i.start_on <= v_today and i.end_on >= v_today
    ), '[]'::jsonb),
    'installsWeek', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', i.id, 'orderNumber', i.order_number, 'customerName', i.customer_name, 'startOn', i.start_on
      ) order by i.start_on, i.order_number)
      from ops.installs i
      where i.archived_at is null and i.status not in ('cancelled', 'completed')
        and i.start_on is not null and i.end_on is not null
        and i.start_on <= v_week_end and i.end_on >= v_week_start
    ), '[]'::jsonb),
    'servicesToday', coalesce((
      select jsonb_agg(item order by item->>'orderNumber')
      from (
        select jsonb_build_object(
          'id', i.id, 'kind', 'install', 'orderNumber', i.order_number, 'customerName', i.customer_name, 'startOn', i.start_on
        ) as item
        from ops.visit_sheets s
        join ops.installs i on i.id = s.install_id
        where s.visit_type = 'service'
          and i.status <> 'cancelled'
          and i.start_on is not null and i.end_on is not null
          and i.start_on <= v_today and i.end_on >= v_today
        union all
        select jsonb_build_object(
          'id', j.id, 'kind', 'job', 'orderNumber', coalesce(j.cin7_order_number, j.cin7_number, 'Service'),
          'customerName', c.name, 'startOn', j.booked_date
        )
        from ops.install_jobs j
        join ops.customers c on c.id = j.customer_id
        where j.job_type = 'service' and j.booked_date = v_today
      ) listed
    ), '[]'::jsonb),
    'servicesWeek', coalesce((
      select jsonb_agg(item order by item->>'startOn', item->>'orderNumber')
      from (
        select jsonb_build_object(
          'id', i.id, 'kind', 'install', 'orderNumber', i.order_number, 'customerName', i.customer_name, 'startOn', i.start_on
        ) as item
        from ops.visit_sheets s
        join ops.installs i on i.id = s.install_id
        where s.visit_type = 'service'
          and i.status <> 'cancelled'
          and i.start_on is not null and i.end_on is not null
          and i.start_on <= v_week_end and i.end_on >= v_week_start
        union all
        select jsonb_build_object(
          'id', j.id, 'kind', 'job', 'orderNumber', coalesce(j.cin7_order_number, j.cin7_number, 'Service'),
          'customerName', c.name, 'startOn', j.booked_date
        )
        from ops.install_jobs j
        join ops.customers c on c.id = j.customer_id
        where j.job_type = 'service'
          and j.booked_date between v_week_start and v_week_end
      ) listed
    ), '[]'::jsonb),
    'off', coalesce((
      select jsonb_agg(jsonb_build_object('name', name, 'label', label, 'startsOn', starts_on, 'endsOn', ends_on) order by name)
      from (
        select r.name, u.reason as label, u.starts_on, u.ends_on
        from ops.unavailability u
        join ops.resources r on r.id = u.resource_id
        where u.ends_on >= v_week_start and u.starts_on <= v_week_end
        union all
        select coalesce(p.full_name, p.email, 'Someone'), e.entry_type, e.starts_on, e.ends_on
        from public.calendar_entries e
        left join public.profiles p on p.id = e.profile_id
        where e.request_status = 'confirmed'
          and e.entry_type in ('annual_leave', 'sick', 'other_absence')
          and e.ends_on >= v_week_start and e.starts_on <= v_week_end
      ) away
    ), '[]'::jsonb),
    'vansOut', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', i.id, 'registration', v.registration, 'orderNumber', i.order_number
      ) order by v.registration)
      from ops.visit_sheets s
      join ops.installs i on i.id = s.install_id
      join ops.vans v
        on v.active
       and regexp_replace(upper(v.registration), '[[:space:]]', '', 'g')
         = regexp_replace(upper(s.vehicle_reg), '[[:space:]]', '', 'g')
      where i.status <> 'cancelled'
        and i.start_on is not null and i.end_on is not null
        and i.start_on <= v_week_end and i.end_on >= v_week_start
    ), '[]'::jsonb),
    'overdue', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', t.id, 'title', t.title, 'dueAt', t.due_at, 'assigneeId', t.assignee_id,
        'assignee', coalesce(p.full_name, p.email)
      ) order by t.due_at)
      from core.tasks t
      left join public.profiles p on p.id = t.assignee_id
      where t.status in ('open', 'in_progress')
        and t.due_at is not null
        and t.due_at < timezone('Europe/London', now())
    ), '[]'::jsonb),
    'warnings', coalesce((
      select jsonb_agg(item order by item->>'label')
      from (
        select jsonb_build_object(
          'label', s.name, 'detail', 'Insurance ' || doc.expires_on, 'href', '/operations/subcontractors/' || s.id
        ) as item
        from ops.subcontractors s
        join lateral (
          select expires_on from (
            select s.insurance_expires_on as expires_on
            union all
            select max(doc.expires_on) from ops.subcontractor_insurance doc where doc.subcontractor_id = s.id
          ) dates
          where expires_on is not null
          order by expires_on desc
          limit 1
        ) doc on true
        where s.status <> 'inactive' and doc.expires_on <= v_soon
        union all
        select jsonb_build_object(
          'label', v.registration,
          'detail', part.kind || ' ' || part.due_on,
          'href', '/operations/fleet'
        )
        from ops.vans v
        cross join lateral (
          values ('MOT', v.mot_due), ('Tax', v.tax_due), ('Insurance', v.insurance_due), ('Service', v.service_due)
        ) as part(kind, due_on)
        where v.active and part.due_on is not null and part.due_on <= v_soon
      ) listed
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.install_save_van(uuid, text, text, boolean, text, date, date, date, date, text) from public, anon;
grant execute on function public.install_save_van(uuid, text, text, boolean, text, date, date, date, date, text) to authenticated, service_role;
revoke all on function public.ops_schedule(date, date) from public, anon;
grant execute on function public.ops_schedule(date, date) to authenticated, service_role;
revoke all on function public.ops_pulse() from public, anon;
grant execute on function public.ops_pulse() to authenticated, service_role;
