-- Show assigned service visits on the operations schedule.
-- Additive: one extra event list inside public.ops_schedule. Overlap rules are unchanged.
-- Timestamp sits in the hotfix slot. The body does not require svc to exist at create time.

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

  if to_regclass('svc.visits') is not null then
    v_events := v_events || coalesce((
      select jsonb_agg(jsonb_build_object(
        'rowKind', 'engineer',
        'rowId', a.resource_id,
        'day', v.visit_on,
        'kind', 'service',
        'label', trim(both ' ' from concat(
          'Service',
          case when v.window_start is not null then ' ' || to_char(v.window_start, 'HH24:MI') else '' end,
          ' · ',
          s.customer_name
        )),
        'href', '/service/visits/' || v.id
      ))
      from svc.visit_assignees a
      join svc.visits v on v.id = a.visit_id
      join svc.sites s on s.id = v.site_id
      where v.visit_on between p_from and p_to
        and extract(isodow from v.visit_on) < 6
    ), '[]'::jsonb);
  end if;

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

revoke all on function public.ops_schedule(date, date) from public, anon;
grant execute on function public.ops_schedule(date, date) to authenticated, service_role;
