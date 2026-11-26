-- Restores roles and module access from the backup tables, then drops the new access pieces.
-- Do not run on production.

alter table public.profiles drop constraint if exists profiles_workspace_role_check;
alter table public.profiles
  add constraint profiles_workspace_role_check
    check (workspace_role in ('owner', 'admin', 'manager', 'member', 'viewer', 'guest'));

update public.profiles p
set role = b.role,
    workspace_role = b.workspace_role,
    access_mode = b.access_mode
from public.profiles_backup_20261127 b
where p.id = b.id;

delete from public.module_access;
insert into public.module_access (profile_id, module_id, enabled, access_level)
select profile_id, module_id, enabled, access_level
from public.module_access_backup_20261127;

delete from public.workspace_team_access where module_id in ('logistics', 'policies');

drop trigger if exists profiles_guard_last_owner on public.profiles;
drop function if exists public.guard_last_owner();

create or replace function public.workspace_level(p_profile uuid, p_module text)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_mode text;
  v_role text;
  v_custom text;
  v_team text;
begin
  select access_mode, workspace_role into v_mode, v_role
  from public.profiles where id = p_profile;
  if v_role is null then return 'none'; end if;
  if v_mode = 'custom' then
    select access_level into v_custom from public.module_access
    where profile_id = p_profile and module_id = p_module;
    return coalesce(v_custom, 'none');
  end if;
  select case max(case a.access_level when 'edit' then 2 when 'view' then 1 else 0 end)
    when 2 then 'edit' when 1 then 'view' else 'none' end
  into v_team
  from public.workspace_team_access a
  join public.workspace_team_members m on m.team_id = a.team_id
  where m.profile_id = p_profile and a.module_id = p_module;
  v_team := coalesce(v_team, 'none');
  if v_role in ('owner', 'admin') then return 'edit';
  elsif v_role = 'viewer' then return case when v_team = 'none' then 'none' else 'view' end;
  elsif v_role = 'manager' then return case when v_team = 'none' then 'view' else v_team end;
  else return v_team;
  end if;
end;
$$;

drop function if exists public.effective_access(uuid);
alter table public.workspace_team_members drop constraint if exists workspace_team_members_role_check;
alter table public.workspace_team_members drop column if exists role;
alter table public.workspace_teams drop column if exists description;
alter table public.workspace_teams drop column if exists archived_at;
drop table if exists core.pulses;
drop table if exists public.access_snapshot_before_20261127;
