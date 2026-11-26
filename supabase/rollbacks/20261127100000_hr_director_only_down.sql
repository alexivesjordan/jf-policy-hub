-- Restores hr.is_director() from 20261126100000_hr_core.sql.
-- Search path stays pinned. Do not run on production.

create or replace function hr.is_director()
returns boolean
language sql
stable
security definer
set search_path = hr, public
as $$
  select public.is_active_user() and (
    exists (select 1 from hr.directors d where d.profile_id = auth.uid())
    or public.is_admin()
    or public.workspace_is_admin()
  );
$$;

revoke all on function hr.is_director() from public, anon;
grant execute on function hr.is_director() to authenticated, service_role;

create or replace function public.calendar_can_see_detail(p_profile uuid)
returns boolean
language sql
stable
security definer
set search_path = hr, public
as $$
  select public.is_active_user() and (
    (p_profile is not null and p_profile = auth.uid())
    or public.is_admin()
    or public.workspace_is_admin()
    or hr.is_director()
    or exists (
      select 1
      from hr.employees subject
      join hr.employees manager on manager.id = subject.manager_id
      where subject.profile_id = p_profile
        and manager.profile_id = auth.uid()
    )
  );
$$;

revoke all on function public.calendar_can_see_detail(uuid) from public, anon;
grant execute on function public.calendar_can_see_detail(uuid) to authenticated, service_role;
