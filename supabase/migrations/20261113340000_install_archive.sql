-- A completed install leaves the board and the calendar 24 hours after that
-- completion. Opening Installs, or the nightly cron, stamps archived_at.
-- A restore clears the stamp and records restored_at, so the same completion
-- does not archive again. A later completion starts a new 24 hours.
-- Cancelled installs stay on the existing rule and are not archived here.

alter table ops.installs
  add column completed_at timestamptz,
  add column archived_at timestamptz,
  add column archived_by uuid references public.profiles (id) on delete set null,
  add column restored_at timestamptz;

update ops.installs
set completed_at = coalesce(updated_at, created_at, now())
where status = 'completed' and completed_at is null;

create or replace function ops.install_stamp_completed()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    if new.status = 'completed' and new.completed_at is null then
      new.completed_at := now();
    end if;
    return new;
  end if;
  if new.status = 'completed' and old.status is distinct from 'completed' then
    new.completed_at := now();
  elsif new.status is distinct from 'completed' then
    new.completed_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists install_stamp_completed on ops.installs;
create trigger install_stamp_completed
  before insert or update of status on ops.installs
  for each row execute function ops.install_stamp_completed();

revoke all on function ops.install_stamp_completed() from public, anon, authenticated;

create or replace function public.install_archive_due()
returns integer
language plpgsql
security definer
set search_path = ops, public
as $$
declare
  v_row ops.installs%rowtype;
  v_at timestamptz := now();
  v_count integer := 0;
begin
  for v_row in
    select *
    from ops.installs
    where archived_at is null
      and status = 'completed'
      and completed_at is not null
      and completed_at <= v_at - interval '24 hours'
      and (restored_at is null or completed_at > restored_at)
    for update
  loop
    update ops.installs
    set archived_at = v_at, archived_by = auth.uid(), updated_at = v_at
    where id = v_row.id;
    perform public.write_access_audit(
      'install.archived',
      'install',
      v_row.id,
      jsonb_build_object('archivedAt', null, 'status', v_row.status, 'completedAt', v_row.completed_at),
      jsonb_build_object('archivedAt', v_at, 'archivedBy', auth.uid(), 'status', v_row.status, 'completedAt', v_row.completed_at)
    );
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

revoke all on function public.install_archive_due() from public, anon, authenticated;
grant execute on function public.install_archive_due() to service_role;

create or replace function public.install_calendar(p_from date, p_to date, p_mine boolean)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ops, public
as $$
declare
  v_field boolean := ops.is_field_engineer() and not public.workspace_is_admin();
  v_office boolean := public.workspace_can('operations', 'view') or public.workspace_is_admin();
  v_sales boolean := v_office or v_field or public.workspace_can('sales', 'view');
begin
  if not v_sales then
    raise exception 'app: You cannot see installs.';
  end if;
  if p_from is null or p_to is null or p_to < p_from then
    raise exception 'app: Choose a date range.';
  end if;
  perform public.install_archive_due();
  return coalesce((
    select jsonb_agg(
      case when v_field then ops.engineer_install_view(span.item) else span.item end
      order by i.start_on nulls last, i.order_number
    )
    from ops.installs i
    cross join lateral (
      select ops.install_span(i) || case when v_office then jsonb_build_object(
        'flags', i.flags, 'hqBuild', i.hq_build, 'siteInstall', i.site_install, 'crew', i.crew,
        'vans', jsonb_build_object('size', i.van_size, 'count', i.van_count),
        'resources', i.resources, 'lines', i.lines, 'cin7SaleId', i.cin7_sale_id, 'cin7CustomerId', i.cin7_customer_id
      ) else '{}'::jsonb end as item
    ) span
    where i.status <> 'cancelled'
      and i.archived_at is null
      and (
        (i.start_on is null and ops.install_stage(i) = 'quoting')
        or (i.start_on <= p_to and i.end_on >= p_from)
      )
      and (not coalesce(p_mine, false) or i.booking_rep_id = auth.uid())
      and (not v_field or ops.install_assigned(i.id, auth.uid()))
  ), '[]'::jsonb);
end;
$$;

create or replace function public.install_list_archived(p_query text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ops, public
as $$
declare
  v_query text := lower(btrim(coalesce(p_query, '')));
begin
  if ops.is_field_engineer() then
    raise exception 'app: Field engineers cannot do that.';
  end if;
  if not (
    public.workspace_can('sales', 'view')
    or public.workspace_can('operations', 'view')
    or public.workspace_is_admin()
  ) then
    raise exception 'app: You cannot see archived installs.';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', i.id,
      'orderNumber', i.order_number,
      'customerName', i.customer_name,
      'status', i.status,
      'completedAt', i.completed_at,
      'archivedAt', i.archived_at,
      'startOn', i.start_on
    ) order by i.archived_at desc, i.order_number)
    from ops.installs i
    where i.archived_at is not null
      and (
        v_query = ''
        or position(v_query in lower(i.order_number)) > 0
        or position(v_query in lower(i.customer_name)) > 0
      )
  ), '[]'::jsonb);
end;
$$;

create or replace function public.install_restore(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ops, public
as $$
declare
  v_row ops.installs%rowtype;
begin
  if ops.is_field_engineer() then
    raise exception 'app: Field engineers cannot do that.';
  end if;
  if not (public.workspace_can('sales', 'edit') or public.workspace_can('operations', 'edit')) then
    raise exception 'app: You cannot restore that install.';
  end if;
  select * into v_row from ops.installs where id = p_id for update;
  if v_row.id is null or v_row.archived_at is null then
    raise exception 'app: That install is not archived.';
  end if;
  update ops.installs
  set archived_at = null, archived_by = null, restored_at = now(), updated_at = now()
  where id = p_id;
  perform public.write_access_audit(
    'install.restored',
    'install',
    p_id,
    jsonb_build_object('archivedAt', v_row.archived_at, 'status', v_row.status, 'completedAt', v_row.completed_at),
    jsonb_build_object('archivedAt', null, 'restoredAt', now(), 'status', v_row.status, 'completedAt', v_row.completed_at)
  );
end;
$$;

revoke all on function public.install_list_archived(text) from public, anon;
revoke all on function public.install_restore(uuid) from public, anon;
grant execute on function public.install_list_archived(text) to authenticated, service_role;
grant execute on function public.install_restore(uuid) to authenticated, service_role;
