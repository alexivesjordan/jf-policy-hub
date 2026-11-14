-- An admin can add a field engineer while inviting or editing a login.
-- A failed invite deletes that resource only when it is still unlinked and unbooked.

create or replace function public.install_create_field_engineer(p_name text, p_role text)
returns uuid
language plpgsql
security definer
set search_path = ops, public
as $$
declare
  v_name text := regexp_replace(btrim(coalesce(p_name, '')), '[[:space:]]+', ' ', 'g');
  v_role text := lower(btrim(coalesce(p_role, '')));
  v_id uuid;
begin
  if ops.is_field_engineer() and not public.workspace_is_admin() then
    raise exception 'app: You cannot add an engineer.';
  end if;
  if not public.workspace_is_admin() then
    raise exception 'app: You cannot add an engineer.';
  end if;
  if v_name = '' or char_length(v_name) > 80 then
    raise exception 'app: Enter the engineer name.';
  end if;
  if v_role not in ('installer', 'helper') then
    raise exception 'app: Choose installer or helper.';
  end if;
  if exists (
    select 1 from ops.resources
    where status = 'active'
      and resource_type in ('installer', 'helper')
      and lower(regexp_replace(btrim(name), '[[:space:]]+', ' ', 'g')) = lower(v_name)
  ) then
    raise exception 'app: An active engineer already has that name.';
  end if;
  insert into ops.resources (resource_type, name, status)
  values (v_role::ops.resource_type, v_name, 'active')
  returning id into v_id;
  perform public.write_access_audit(
    'resource.created', 'resource', v_id, null,
    jsonb_build_object('name', v_name, 'role', v_role)
  );
  return v_id;
end;
$$;

create or replace function public.install_discard_new_engineer(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ops, public
as $$
declare
  v_name text;
begin
  if ops.is_field_engineer() and not public.workspace_is_admin() then
    raise exception 'app: You cannot add an engineer.';
  end if;
  if not public.workspace_is_admin() then
    raise exception 'app: You cannot add an engineer.';
  end if;
  select name into v_name
  from ops.resources
  where id = p_id
    and profile_id is null
    and resource_type in ('installer', 'helper')
    and not exists (select 1 from ops.reservations where resource_id = p_id)
    and not exists (select 1 from ops.install_reservations where resource_id = p_id)
    and not exists (
      select 1 from ops.install_invite_choices
      where choice = p_id::text
    );
  if v_name is null then
    return;
  end if;
  delete from ops.resources where id = p_id and profile_id is null;
  perform public.write_access_audit(
    'resource.removed', 'resource', p_id,
    jsonb_build_object('name', v_name, 'reason', 'invite_failed'),
    null
  );
end;
$$;

revoke all on function public.install_create_field_engineer(text, text) from public, anon;
revoke all on function public.install_discard_new_engineer(uuid) from public, anon;
grant execute on function public.install_create_field_engineer(text, text) to authenticated, service_role;
grant execute on function public.install_discard_new_engineer(uuid) to authenticated, service_role;
