-- A booked install can be cancelled by the booking rep, an operations editor, or an admin.
-- Field engineers cannot. The customer is not emailed. Reminders stop because the status is cancelled.

create or replace function ops.caller_is_field_engineer()
returns boolean
language sql
stable
security definer
set search_path = core, public
as $$
  select exists (
    select 1
    from core.ops_roles
    where profile_id = auth.uid()
      and ops_role = 'installer'
  )
  and not public.workspace_is_admin();
$$;

revoke all on function ops.caller_is_field_engineer() from public, anon, authenticated;

create or replace function ops.finish_install_cancel(p_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ops, core, public
as $$
declare
  v_status text;
begin
  select status into v_status from ops.installs where id = p_id for update;
  if v_status is null then
    raise exception 'app: That install was not found.';
  end if;
  if v_status is distinct from 'cancelled' then
    update ops.installs
    set status = 'cancelled', updated_at = now()
    where id = p_id;
    insert into core.audit_log (
      actor_id, module_id, entity_schema, entity_table, entity_id,
      action, field_name, old_value, new_value, details
    ) values (
      auth.uid(), 'operations', 'ops', 'installs', p_id,
      'cancel', 'status', to_jsonb(v_status), to_jsonb('cancelled'::text),
      jsonb_build_object('reason', p_reason)
    );
  end if;
  delete from ops.install_reservations where install_id = p_id;
  update core.token_links
  set revoked_at = coalesce(revoked_at, now())
  where entity_schema = 'ops'
    and entity_table = 'installs'
    and entity_id = p_id
    and purpose in ('access_form', 'subcontractor_job')
    and revoked_at is null;
end;
$$;

revoke all on function ops.finish_install_cancel(uuid, text) from public, anon, authenticated;

create or replace function public.install_cancel(p_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ops, core, public
as $$
declare
  v_row ops.installs%rowtype;
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  if char_length(v_reason) < 3 or char_length(v_reason) > 500 then
    raise exception 'app: Add a reason of 3 to 500 characters.';
  end if;
  select * into v_row from ops.installs where id = p_id;
  if v_row.id is null then
    raise exception 'app: That install was not found.';
  end if;
  if coalesce(auth.role(), '') is distinct from 'service_role'
     and ops.caller_is_field_engineer()
     and v_row.booking_rep_id is distinct from auth.uid() then
    raise exception 'app: You cannot cancel that install.';
  end if;
  if not ops.install_actor_allowed(p_id) then
    raise exception 'app: You cannot cancel that install.';
  end if;
  perform ops.finish_install_cancel(p_id, v_reason);
  return public.install_read(p_id);
end;
$$;

create or replace function public.install_set_status(p_id uuid, p_status text)
returns jsonb
language plpgsql
security definer
set search_path = ops, core, public
as $$
declare
  v_row ops.installs%rowtype;
begin
  if not public.workspace_can('operations', 'edit') then
    raise exception 'app: You cannot change that install.';
  end if;
  if p_status not in ('booked', 'scheduled', 'in_progress', 'completed', 'cancelled') then
    raise exception 'app: Choose a status.';
  end if;
  if p_status = 'cancelled' then
    select * into v_row from ops.installs where id = p_id;
    if v_row.id is null then
      raise exception 'app: That install was not found.';
    end if;
    if coalesce(auth.role(), '') is distinct from 'service_role'
       and ops.caller_is_field_engineer()
       and v_row.booking_rep_id is distinct from auth.uid() then
      raise exception 'app: You cannot cancel that install.';
    end if;
    perform ops.finish_install_cancel(p_id, 'Cancelled from the operations status control.');
    return public.install_read(p_id);
  end if;
  update ops.installs
  set status = p_status, updated_at = now()
  where id = p_id;
  if not found then
    raise exception 'app: That install was not found.';
  end if;
  return public.install_read(p_id);
end;
$$;

revoke all on function public.install_cancel(uuid, text) from public, anon;
grant execute on function public.install_cancel(uuid, text) to authenticated, service_role;
