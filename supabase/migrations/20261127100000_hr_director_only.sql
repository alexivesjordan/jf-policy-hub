-- Directors are only people with a row in hr.directors.
-- Workspace owners and admins no longer count as directors.
-- New file only. Do not apply to production.

create or replace function hr.is_director()
returns boolean
language sql
stable
security definer
set search_path = hr, public
as $$
  select public.is_active_user()
    and exists (
      select 1
      from hr.directors d
      where d.profile_id = auth.uid()
    );
$$;

revoke all on function hr.is_director() from public, anon;
grant execute on function hr.is_director() to authenticated, service_role;

-- The calendar view also treated every workspace admin as allowed to see sickness detail.
-- That shortcut goes, so a sickness reason follows the same director and line-manager rule.
create or replace function public.calendar_can_see_detail(p_profile uuid)
returns boolean
language sql
stable
security definer
set search_path = hr, public
as $$
  select public.is_active_user() and (
    (p_profile is not null and p_profile = auth.uid())
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
