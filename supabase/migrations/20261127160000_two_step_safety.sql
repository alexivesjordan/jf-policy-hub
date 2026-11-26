-- Two-step safety. New file only. Do not edit 20261127140000.
-- Production applies that file first, then this one. Do not apply here.

alter table core.security_policy
  add column if not exists released_at timestamptz,
  add column if not exists enforcement_enabled boolean not null default true;

update core.security_policy
set released_at = now()
where id = 1
  and released_at is null;

insert into core.security_policy (id, released_at, enforcement_enabled)
values (1, now(), true)
on conflict (id) do nothing;

alter table core.security_policy
  alter column released_at set not null;

revoke all on table core.security_policy from public, anon, authenticated;
alter table core.security_policy enable row level security;

create or replace function public.two_step_due()
returns boolean
language plpgsql
stable
security definer
set search_path = core, public, hr
as $$
declare
  v_role text;
  v_created timestamptz;
  v_grace integer;
  v_roles text[];
  v_released timestamptz;
  v_on boolean;
  v_start timestamptz;
begin
  if auth.uid() is null or core.session_verified() then
    return false;
  end if;
  select enforcement_enabled, grace_days, required_roles, released_at
    into v_on, v_grace, v_roles, v_released
  from core.security_policy
  where id = 1;
  if coalesce(v_on, true) = false then
    return false;
  end if;
  select workspace_role, created_at into v_role, v_created
  from public.profiles
  where id = auth.uid();
  if v_role = 'owner' then
    return false;
  end if;
  v_start := greatest(v_created, v_released);
  if v_start is null or now() < v_start + make_interval(days => coalesce(v_grace, 7)) then
    return false;
  end if;
  return v_role = any (coalesce(v_roles, array[]::text[]))
    or hr.is_director()
    or exists (
      select 1
      from hr.employees manager
      join hr.employees report on report.manager_id = manager.id
      where manager.profile_id = auth.uid()
    );
end;
$$;

create or replace function public.two_step_owner_notice()
returns boolean
language plpgsql
stable
security definer
set search_path = core, public
as $$
declare
  v_role text;
  v_created timestamptz;
  v_grace integer;
  v_released timestamptz;
  v_on boolean;
  v_start timestamptz;
begin
  if auth.uid() is null or core.session_verified() then
    return false;
  end if;
  select enforcement_enabled, grace_days, released_at
    into v_on, v_grace, v_released
  from core.security_policy
  where id = 1;
  if coalesce(v_on, true) = false then
    return false;
  end if;
  select workspace_role, created_at into v_role, v_created
  from public.profiles
  where id = auth.uid();
  if v_role is distinct from 'owner' then
    return false;
  end if;
  v_start := greatest(v_created, v_released);
  if v_start is null or now() < v_start + make_interval(days => coalesce(v_grace, 7)) then
    return false;
  end if;
  return true;
end;
$$;

create or replace function public.two_step_enforcement()
returns boolean
language sql
stable
security definer
set search_path = core, public
as $$
  select coalesce(
    (select enforcement_enabled from core.security_policy where id = 1),
    true
  );
$$;

create or replace function public.set_two_step_enforcement(p_enabled boolean)
returns void
language plpgsql
security definer
set search_path = core, public
as $$
begin
  if auth.uid() is null then
    raise exception 'app: Sign in first.';
  end if;
  if not exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and workspace_role = 'owner'
      and is_active
      and access_granted
      and deleted_at is null
  ) then
    raise exception 'app: Only an owner can change this.';
  end if;
  update core.security_policy
  set enforcement_enabled = coalesce(p_enabled, false)
  where id = 1;
end;
$$;

revoke all on function public.two_step_due() from public, anon;
revoke all on function public.two_step_owner_notice() from public, anon;
revoke all on function public.two_step_enforcement() from public, anon;
revoke all on function public.set_two_step_enforcement(boolean) from public, anon;
grant execute on function public.two_step_due() to authenticated, service_role;
grant execute on function public.two_step_owner_notice() to authenticated, service_role;
grant execute on function public.two_step_enforcement() to authenticated, service_role;
grant execute on function public.set_two_step_enforcement(boolean) to authenticated, service_role;
