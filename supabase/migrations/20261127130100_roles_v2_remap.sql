-- DESTRUCTIVE
-- Backs up roles, then maps manager and viewer to member without lowering access.
-- Logistics is copied from each team's Operations grant so nobody loses it.
-- New file only. Do not apply to production.

create table if not exists public.profiles_backup_20261127 as
select id, role, workspace_role, access_mode
from public.profiles;

create table if not exists public.module_access_backup_20261127 as
select profile_id, module_id, enabled, access_level
from public.module_access;

create table if not exists public.access_snapshot_before_20261127 as
select p.id as profile_id, pulse.pulse, public.workspace_level(p.id, pulse.pulse) as level
from public.profiles p
cross join (
  values ('people'), ('operations'), ('sales'), ('service'), ('supply'), ('finance')
) as pulse(pulse);

create table public.role_preserve_20261127 as
select b.profile_id, b.pulse, b.level
from public.access_snapshot_before_20261127 b
join public.profiles p on p.id = b.profile_id
where p.workspace_role in ('manager', 'viewer');

update public.profiles
set workspace_role = 'member',
    role = 'staff',
    access_mode = 'custom'
where workspace_role in ('manager', 'viewer');

insert into public.module_access (profile_id, module_id, enabled, access_level)
select profile_id, pulse, level <> 'none', level
from public.role_preserve_20261127
on conflict (profile_id, module_id) do update
  set enabled = excluded.enabled,
      access_level = excluded.access_level;

insert into public.workspace_team_access (team_id, module_id, access_level)
select team_id, 'logistics', access_level
from public.workspace_team_access
where module_id = 'operations'
on conflict (team_id, module_id) do nothing;

insert into public.module_access (profile_id, module_id, enabled, access_level)
select p.id, 'logistics', public.workspace_level(p.id, 'operations') <> 'none', public.workspace_level(p.id, 'operations')
from public.profiles p
where p.access_mode = 'custom'
on conflict (profile_id, module_id) do update
  set enabled = excluded.enabled,
      access_level = excluded.access_level;

alter table public.profiles
  drop constraint if exists profiles_workspace_role_check;

alter table public.profiles
  add constraint profiles_workspace_role_check
    check (workspace_role in ('owner', 'admin', 'member', 'guest'));

do $$
declare
  v_lost integer;
begin
  select count(*) into v_lost
  from public.access_snapshot_before_20261127 b
  where case public.workspace_level(b.profile_id, b.pulse)
      when 'admin' then 3 when 'edit' then 2 when 'view' then 1 else 0 end
    < case b.level
      when 'admin' then 3 when 'edit' then 2 when 'view' then 1 else 0 end;
  if v_lost > 0 then
    raise exception 'app: The role change lowered access for % rows.', v_lost;
  end if;

  select count(*) into v_lost
  from public.access_snapshot_before_20261127 b
  where b.pulse = 'operations'
    and case public.workspace_level(b.profile_id, 'logistics')
      when 'admin' then 3 when 'edit' then 2 when 'view' then 1 else 0 end
    < case b.level
      when 'admin' then 3 when 'edit' then 2 when 'view' then 1 else 0 end;
  if v_lost > 0 then
    raise exception 'app: Logistics was lost for % people.', v_lost;
  end if;
end
$$;

drop table public.role_preserve_20261127;

create or replace function public.workspace_save_user(
  p_profile uuid,
  p_workspace_role text,
  p_access_mode text,
  p_team_ids uuid[],
  p_custom jsonb,
  p_active boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_module text;
  v_level text;
  v_before jsonb;
  v_after jsonb;
begin
  if not public.workspace_is_admin() then
    raise exception 'app: Only a workspace owner or admin can edit users.';
  end if;
  if p_workspace_role not in ('owner', 'admin', 'member', 'guest') then
    raise exception 'app: Choose a workspace role.';
  end if;
  if p_access_mode not in ('follow', 'custom') then
    raise exception 'app: Choose how access is resolved.';
  end if;

  select jsonb_build_object('workspace_role', p.workspace_role, 'is_active', p.is_active)
  into v_before
  from public.profiles p
  where p.id = p_profile;
  if v_before is null then
    raise exception 'app: That person could not be found.';
  end if;

  update public.profiles
  set workspace_role = p_workspace_role,
      access_mode = p_access_mode,
      is_active = p_active,
      access_granted = p_active,
      role = case when p_workspace_role in ('owner', 'admin') then 'admin' else 'staff' end
  where id = p_profile;

  delete from public.workspace_team_members where profile_id = p_profile;
  insert into public.workspace_team_members (team_id, profile_id)
  select team_id, p_profile
  from unnest(coalesce(p_team_ids, '{}'::uuid[])) as team_id;

  if p_access_mode = 'custom' and p_custom is not null then
    for v_module, v_level in select key, value from jsonb_each_text(p_custom)
    loop
      if v_module in ('people', 'service', 'supply', 'operations', 'sales', 'finance', 'logistics', 'policies')
         and v_level in ('none', 'view', 'edit', 'admin') then
        insert into public.module_access (profile_id, module_id, enabled, access_level)
        values (p_profile, v_module, v_level <> 'none', v_level)
        on conflict (profile_id, module_id) do update
          set enabled = excluded.enabled, access_level = excluded.access_level;
      end if;
    end loop;
  end if;

  select jsonb_build_object('workspace_role', p.workspace_role, 'is_active', p.is_active)
  into v_after
  from public.profiles p
  where p.id = p_profile;
  perform public.write_access_audit('user.access_changed', 'profile', p_profile, v_before, v_after);
end;
$$;
