-- Company calendar privacy.
-- Everyone signed in can see who is off and when.
-- Sickness is shown to other people only as Off, with no reason.
-- Notes stay with the person, their line manager, and a director or admin.
-- New file only. Do not apply to production.

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

create or replace view public.calendar_entries_visible
with (security_barrier = true, security_invoker = false) as
select
  e.id,
  e.profile_id,
  e.starts_on,
  e.ends_on,
  e.request_status,
  e.requested_by,
  e.created_by,
  e.created_at,
  e.updated_at,
  case
    when public.calendar_can_see_detail(e.profile_id) then e.entry_type
    when e.entry_type = 'sick' then 'off'
    else e.entry_type
  end as entry_type,
  case
    when public.calendar_can_see_detail(e.profile_id) then e.notes
    else null
  end as notes
from public.calendar_entries e
where public.is_active_user();

comment on view public.calendar_entries_visible is
  'Company calendar for the browser. Sick type and notes are removed unless the viewer is the person, their line manager, or a director or admin.';

revoke all on public.calendar_entries_visible from public, anon;
grant select on public.calendar_entries_visible to authenticated, service_role;

revoke select on table public.calendar_entries from authenticated;
grant select (
  id,
  profile_id,
  starts_on,
  ends_on,
  request_status,
  requested_by,
  created_by,
  created_at,
  updated_at
) on public.calendar_entries to authenticated;

revoke all on function public.calendar_can_see_detail(uuid) from public, anon;
grant execute on function public.calendar_can_see_detail(uuid) to authenticated, service_role;
