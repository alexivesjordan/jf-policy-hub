-- Admin-managed vans for the job sheet. Nothing is seeded.

create table ops.vans (
  id uuid primary key default gen_random_uuid(),
  registration text not null,
  name text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index vans_registration_key
  on ops.vans (regexp_replace(upper(registration), '[[:space:]]', '', 'g'));

create trigger vans_touch_updated_at
before update on ops.vans
for each row execute function public.touch_updated_at();

alter table ops.vans enable row level security;
revoke all on ops.vans from public, anon, authenticated;
grant all on ops.vans to service_role;

create or replace function public.install_list_vans()
returns jsonb
language sql
stable
security definer
set search_path = ops, public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'registration', registration,
    'name', name
  ) order by registration), '[]'::jsonb)
  from ops.vans
  where active;
$$;

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
  if not public.workspace_is_admin() then
    raise exception 'app: You cannot change the vans.';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', id,
      'registration', registration,
      'name', name,
      'active', active
    ) order by active desc, registration)
    from ops.vans
  ), '[]'::jsonb);
end;
$$;

create or replace function public.install_save_van(p_id uuid, p_registration text, p_name text, p_active boolean)
returns uuid
language plpgsql
security definer
set search_path = ops, public
as $$
declare
  v_reg text := upper(regexp_replace(btrim(coalesce(p_registration, '')), '[[:space:]]+', ' ', 'g'));
  v_key text := regexp_replace(v_reg, '[[:space:]]', '', 'g');
  v_name text := nullif(btrim(coalesce(p_name, '')), '');
  v_before jsonb;
  v_id uuid := p_id;
begin
  if ops.is_field_engineer() and not public.workspace_is_admin() then
    raise exception 'app: You cannot change the vans.';
  end if;
  if not public.workspace_is_admin() then
    raise exception 'app: You cannot change the vans.';
  end if;
  if v_key = '' or char_length(v_key) > 12 then
    raise exception 'app: Enter the registration.';
  end if;
  if v_name is not null and char_length(v_name) > 80 then
    raise exception 'app: Enter a shorter name.';
  end if;
  if exists (
    select 1 from ops.vans
    where regexp_replace(upper(registration), '[[:space:]]', '', 'g') = v_key
      and id is distinct from p_id
  ) then
    raise exception 'app: That registration is already on the list.';
  end if;
  if p_id is null then
    insert into ops.vans (registration, name, active)
    values (v_reg, v_name, coalesce(p_active, true))
    returning id into v_id;
    perform public.write_access_audit(
      'van.created', 'van', v_id, null,
      jsonb_build_object('registration', v_reg, 'name', v_name, 'active', coalesce(p_active, true))
    );
    return v_id;
  end if;
  select jsonb_build_object('registration', registration, 'name', name, 'active', active)
  into v_before
  from ops.vans where id = p_id;
  if v_before is null then
    raise exception 'app: That van was not found.';
  end if;
  update ops.vans
  set registration = v_reg, name = v_name, active = coalesce(p_active, active)
  where id = p_id
  returning id into v_id;
  perform public.write_access_audit(
    'van.updated', 'van', v_id, v_before,
    jsonb_build_object('registration', v_reg, 'name', v_name, 'active', coalesce(p_active, active))
  );
  return v_id;
end;
$$;

revoke all on function public.install_list_vans() from public, anon;
revoke all on function public.install_manage_vans() from public, anon;
revoke all on function public.install_save_van(uuid, text, text, boolean) from public, anon;
grant execute on function public.install_list_vans() to authenticated, service_role;
grant execute on function public.install_manage_vans() to authenticated, service_role;
grant execute on function public.install_save_van(uuid, text, text, boolean) to authenticated, service_role;
