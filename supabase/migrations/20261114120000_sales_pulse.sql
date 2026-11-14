-- Sales overview. One read for the signed-in rep, or every rep when an admin asks.
-- New file only. Do not edit earlier migrations. Do not apply this to production.

create or replace function public.sales_pulse(p_rep uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ops, public
as $$
declare
  v_admin boolean := public.workspace_is_admin();
  v_rep uuid;
  v_today date := (timezone('Europe/London', now()))::date;
  v_week_start date;
  v_week_end date;
begin
  if not (
    v_admin
    or public.workspace_can('sales', 'view')
    or public.workspace_can('operations', 'view')
  ) then
    raise exception 'app: You cannot see sales.';
  end if;

  v_week_start := v_today - (extract(isodow from v_today)::integer - 1);
  v_week_end := v_week_start + 4;
  v_rep := case when v_admin then p_rep else auth.uid() end;

  return jsonb_build_object(
    'admin', v_admin,
    'repId', v_rep,
    'reps', case when v_admin then coalesce((
      select jsonb_agg(person order by person->>'name')
      from (
        select jsonb_build_object(
          'id', p.id,
          'name', coalesce(nullif(btrim(p.full_name), ''), p.email)
        ) as person
        from public.profiles p
        where p.is_active
          and p.access_granted
          and public.workspace_level(p.id, 'sales') in ('view', 'edit')
      ) listed
    ), '[]'::jsonb) else '[]'::jsonb end,
    'waiting', coalesce((
      select jsonb_agg(item order by item->>'orderNumber')
      from (
        select jsonb_build_object(
          'id', q.id,
          'kind', 'quote',
          'orderNumber', q.order_number,
          'customerName', coalesce(q.payload->>'customerName', '')
        ) as item
        from ops.install_quotes q
        where q.install_id is null
          and (v_rep is null or q.created_by = v_rep)
          and not exists (
            select 1 from ops.installs live
            where live.quote_id = q.id
              and live.status <> 'cancelled'
              and live.archived_at is null
          )
        union all
        select jsonb_build_object(
          'id', i.id,
          'kind', 'install',
          'orderNumber', i.order_number,
          'customerName', i.customer_name
        )
        from ops.installs i
        where i.status = 'quoting'
          and i.archived_at is null
          and (v_rep is null or i.booking_rep_id = v_rep)
          and not exists (
            select 1 from ops.subcontractor_threads t
            where t.install_id = i.id and t.status in ('queued', 'sent')
          )
      ) rows
    ), '[]'::jsonb),
    'replies', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', i.id,
        'kind', 'install',
        'orderNumber', i.order_number,
        'customerName', i.customer_name,
        'awaiting', (
          select count(*) from ops.subcontractor_threads open
          where open.install_id = i.id and open.status in ('queued', 'sent')
        )
      ) order by i.order_number)
      from ops.installs i
      where i.status <> 'cancelled'
        and i.archived_at is null
        and (v_rep is null or i.booking_rep_id = v_rep)
        and exists (
          select 1 from ops.subcontractor_threads t
          where t.install_id = i.id and t.status in ('queued', 'sent')
        )
    ), '[]'::jsonb),
    'access', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', i.id,
        'kind', 'install',
        'orderNumber', i.order_number,
        'customerName', i.customer_name,
        'startOn', i.start_on
      ) order by i.start_on nulls last, i.order_number)
      from ops.installs i
      where i.archived_at is null
        and i.status <> 'cancelled'
        and ops.install_stage(i) = 'awaiting_access'
        and (v_rep is null or i.booking_rep_id = v_rep)
    ), '[]'::jsonb),
    'week', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', i.id,
        'kind', 'install',
        'orderNumber', i.order_number,
        'customerName', i.customer_name,
        'startOn', i.start_on
      ) order by i.start_on, i.order_number)
      from ops.installs i
      where i.archived_at is null
        and i.status not in ('cancelled', 'completed')
        and i.start_on between v_week_start and v_week_end
        and (v_rep is null or i.booking_rep_id = v_rep)
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.sales_pulse(uuid) from public, anon;
grant execute on function public.sales_pulse(uuid) to authenticated, service_role;
