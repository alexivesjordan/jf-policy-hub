-- Moving an install must keep the access link alive until the new end date.
-- The field-engineer refusal, quoting block, and weekday rule stay as they are.

create or replace function public.install_move(p_id uuid, p_start date)
returns jsonb
language plpgsql
security definer
set search_path = ops, core, public
as $$
declare
  v_row ops.installs%rowtype;
  v_quote ops.install_quotes%rowtype;
  v_total integer;
  v_days date[];
  v_ids uuid[];
  v_end date;
  v_weekends boolean := false;
  v_requirements jsonb;
  v_resources jsonb;
begin
  perform public.install_claim_engineer();
  if ops.is_field_engineer() and not public.workspace_is_admin() then
    raise exception 'app: You cannot move that install.';
  end if;
  if not public.workspace_can('operations', 'edit') then
    raise exception 'app: You cannot move that install.';
  end if;
  select * into v_row from ops.installs where id = p_id for update;
  if v_row.id is null or v_row.status = 'cancelled' then
    raise exception 'app: That install was not found.';
  end if;
  if v_row.status = 'quoting' then
    raise exception 'app: Award the subcontractor quote before moving dates.';
  end if;
  select * into v_quote from ops.install_quotes where id = v_row.quote_id;
  v_total := greatest(coalesce((v_quote.payload->>'totalDays')::integer, 1), 1);
  select coalesce(array_agg(day order by day), '{}') into v_days from ops.install_working_days(p_start, v_total, v_weekends) as day;
  if coalesce(array_length(v_days, 1), 0) < v_total or v_days[1] is distinct from p_start then
    raise exception 'app: Choose a weekday start date.';
  end if;
  delete from ops.install_reservations where install_id = v_row.id;
  v_requirements := coalesce(v_quote.payload->'requirements', '{}'::jsonb);
  v_ids := ops.pick_install_resources(
    v_days, v_row.crew,
    greatest(coalesce((v_requirements->>'licensedDrivers')::integer, 0), 0),
    v_row.van_size, v_row.van_count,
    coalesce((v_requirements->>'stairClimber')::boolean, false)
  );
  if v_ids is null then
    raise exception 'app: Those engineers or vans are no longer free. Choose another start date.';
  end if;
  v_end := v_days[array_length(v_days, 1)];
  v_resources := ops.hold_install_resources(v_row.id, v_ids, v_days);
  update ops.installs set start_on = p_start, end_on = v_end, resources = v_resources, updated_at = now() where id = v_row.id;
  update core.token_links
  set expires_at = (v_end::timestamp + time '23:59:59') at time zone 'UTC'
  where purpose = 'access_form'
    and entity_schema = 'ops'
    and entity_table = 'installs'
    and entity_id = v_row.id
    and revoked_at is null;
  return public.install_read(v_row.id);
end;
$$;

-- One gate for every path that mints an access or visit link, or emails the customer.

create or replace function public.install_assert_linkable(p_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = ops, public
as $$
declare
  v_status text;
begin
  select status into v_status from ops.installs where id = p_id;
  if v_status = 'cancelled' then
    raise exception 'app: This install is cancelled.';
  end if;
  if v_status = 'completed' then
    raise exception 'app: This install is completed.';
  end if;
end;
$$;

revoke all on function public.install_assert_linkable(uuid) from public, anon, authenticated;
grant execute on function public.install_assert_linkable(uuid) to service_role;
