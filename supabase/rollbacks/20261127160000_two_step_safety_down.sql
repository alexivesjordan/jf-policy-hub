-- Restores the two-step check from 20261127140000. Does not drop that migration's tables.
-- Do not run on production.

drop function if exists public.set_two_step_enforcement(boolean);
drop function if exists public.two_step_enforcement();
drop function if exists public.two_step_owner_notice();

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
begin
  if auth.uid() is null or core.session_verified() then
    return false;
  end if;
  select workspace_role, created_at into v_role, v_created from public.profiles where id = auth.uid();
  select grace_days, required_roles into v_grace, v_roles from core.security_policy where id = 1;
  if v_created is null or now() < v_created + make_interval(days => coalesce(v_grace, 7)) then
    return false;
  end if;
  return v_role = any (coalesce(v_roles, array[]::text[]))
    or hr.is_director()
    or exists (
      select 1 from hr.employees manager
      join hr.employees report on report.manager_id = manager.id
      where manager.profile_id = auth.uid()
    );
end;
$$;

revoke all on function public.two_step_due() from public, anon;
grant execute on function public.two_step_due() to authenticated, service_role;

alter table core.security_policy disable row level security;
alter table core.security_policy drop column if exists enforcement_enabled;
alter table core.security_policy drop column if exists released_at;
