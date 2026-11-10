-- Workspace teams, roles, and module access.
-- Existing people keep custom access copied from their current module switches.
-- Alex (is_owner) and Simon (ops_manager) are workspace owners.

alter table public.profiles
  add column if not exists workspace_role text,
  add column if not exists access_mode text;

update public.profiles
set workspace_role = 'member'
where workspace_role is null;

update public.profiles
set access_mode = 'custom'
where access_mode is null;

alter table public.profiles
  alter column workspace_role set default 'member',
  alter column workspace_role set not null,
  alter column access_mode set default 'follow',
  alter column access_mode set not null;

alter table public.profiles
  drop constraint if exists profiles_workspace_role_check,
  drop constraint if exists profiles_access_mode_check;

alter table public.profiles
  add constraint profiles_workspace_role_check
    check (workspace_role in ('owner', 'admin', 'manager', 'member', 'viewer')),
  add constraint profiles_access_mode_check
    check (access_mode in ('follow', 'custom'));

alter table public.module_access
  add column if not exists access_level text;

update public.module_access
set access_level = case when enabled then 'edit' else 'none' end
where access_level is null;

alter table public.module_access
  alter column access_level set default 'none',
  alter column access_level set not null;

alter table public.module_access
  drop constraint if exists module_access_level_check;

alter table public.module_access
  add constraint module_access_level_check
    check (access_level in ('none', 'view', 'edit'));

update public.profiles as p
set workspace_role = 'owner'
from core.ops_roles as r
where r.profile_id = p.id
  and (r.is_owner or r.ops_role = 'ops_manager');

update public.profiles
set workspace_role = 'admin'
where role = 'admin'
  and workspace_role = 'member';

update public.profiles
set workspace_role = 'manager'
where role = 'approver'
  and workspace_role = 'member';

create table if not exists public.workspace_teams (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists public.workspace_team_members (
  team_id uuid not null references public.workspace_teams (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  primary key (team_id, profile_id)
);

create table if not exists public.workspace_team_access (
  team_id uuid not null references public.workspace_teams (id) on delete cascade,
  module_id text not null check (module_id in ('people', 'service', 'supply', 'operations', 'sales', 'finance')),
  access_level text not null check (access_level in ('none', 'view', 'edit')),
  primary key (team_id, module_id)
);

alter table public.workspace_teams enable row level security;
alter table public.workspace_team_members enable row level security;
alter table public.workspace_team_access enable row level security;

insert into public.workspace_teams (name)
values ('Sales'), ('Installs'), ('Aftersales'), ('Operations'), ('Office'), ('Management')
on conflict (name) do nothing;

insert into public.workspace_team_access (team_id, module_id, access_level)
select t.id, g.module_id, g.access_level
from public.workspace_teams t
join (
  values
    ('Sales', 'sales', 'edit'),
    ('Installs', 'operations', 'edit'),
    ('Aftersales', 'service', 'view'),
    ('Operations', 'operations', 'edit'),
    ('Operations', 'people', 'view'),
    ('Office', 'people', 'view'),
    ('Office', 'operations', 'view'),
    ('Office', 'sales', 'view'),
    ('Management', 'people', 'edit'),
    ('Management', 'service', 'edit'),
    ('Management', 'supply', 'edit'),
    ('Management', 'operations', 'edit'),
    ('Management', 'sales', 'edit'),
    ('Management', 'finance', 'edit')
) as g(team_name, module_id, access_level) on g.team_name = t.name
on conflict (team_id, module_id) do nothing;

insert into public.workspace_team_members (team_id, profile_id)
select t.id, r.profile_id
from core.ops_roles r
join public.workspace_teams t on t.name = case
  when r.is_owner or r.ops_role in ('ops_manager', 'admin_owner') then 'Management'
  when r.ops_role = 'sales' then 'Sales'
  when r.ops_role in ('install_lead', 'installer') then 'Installs'
  when r.ops_role = 'hq' then 'Operations'
  else 'Office'
end
on conflict do nothing;

insert into public.workspace_team_members (team_id, profile_id)
select t.id, p.id
from public.profiles p
join public.workspace_teams t on t.name = 'Office'
where not exists (
  select 1 from public.workspace_team_members m where m.profile_id = p.id
)
on conflict do nothing;

create or replace function public.workspace_is_admin()
returns boolean
language sql
stable
security definer
set search_path = public, core
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.is_active
      and p.access_granted
      and (
        p.role = 'admin'
        or p.workspace_role in ('owner', 'admin')
        or core.is_ops_owner()
      )
  );
$$;

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
  from public.profiles
  where id = p_profile;
  if v_role is null then
    return 'none';
  end if;
  if v_mode = 'custom' then
    select access_level into v_custom
    from public.module_access
    where profile_id = p_profile and module_id = p_module;
    return coalesce(v_custom, 'none');
  end if;

  select case max(case a.access_level when 'edit' then 2 when 'view' then 1 else 0 end)
    when 2 then 'edit'
    when 1 then 'view'
    else 'none'
  end
  into v_team
  from public.workspace_team_access a
  join public.workspace_team_members m on m.team_id = a.team_id
  where m.profile_id = p_profile
    and a.module_id = p_module;
  v_team := coalesce(v_team, 'none');

  if v_role in ('owner', 'admin') then
    return 'edit';
  elsif v_role = 'viewer' then
    return case when v_team = 'none' then 'none' else 'view' end;
  elsif v_role = 'manager' then
    return case when v_team = 'none' then 'view' else v_team end;
  else
    return v_team;
  end if;
end;
$$;

create or replace function public.workspace_my_access()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_id uuid := auth.uid();
begin
  if v_id is null then
    return null;
  end if;
  return jsonb_build_object(
    'people', public.workspace_level(v_id, 'people'),
    'service', public.workspace_level(v_id, 'service'),
    'supply', public.workspace_level(v_id, 'supply'),
    'operations', public.workspace_level(v_id, 'operations'),
    'sales', public.workspace_level(v_id, 'sales'),
    'finance', public.workspace_level(v_id, 'finance'),
    'role', (select workspace_role from public.profiles where id = v_id),
    'mode', (select access_mode from public.profiles where id = v_id)
  );
end;
$$;

create or replace function public.workspace_directory()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.workspace_is_admin() then
    raise exception 'app: Only a workspace owner or admin can open this.';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', p.id,
      'email', p.email,
      'full_name', p.full_name,
      'role', p.role,
      'workspace_role', p.workspace_role,
      'access_mode', p.access_mode,
      'is_active', p.is_active,
      'teams', coalesce((
        select jsonb_agg(t.name order by t.name)
        from public.workspace_team_members m
        join public.workspace_teams t on t.id = m.team_id
        where m.profile_id = p.id
      ), '[]'::jsonb),
      'effective', jsonb_build_object(
        'people', public.workspace_level(p.id, 'people'),
        'service', public.workspace_level(p.id, 'service'),
        'supply', public.workspace_level(p.id, 'supply'),
        'operations', public.workspace_level(p.id, 'operations'),
        'sales', public.workspace_level(p.id, 'sales'),
        'finance', public.workspace_level(p.id, 'finance')
      )
    ) order by p.full_name)
    from public.profiles p
  ), '[]'::jsonb);
end;
$$;

create or replace function public.workspace_teams()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.workspace_is_admin() then
    raise exception 'app: Only a workspace owner or admin can open this.';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', t.id,
      'name', t.name,
      'members', (select count(*) from public.workspace_team_members m where m.team_id = t.id)
    ) order by t.name)
    from public.workspace_teams t
  ), '[]'::jsonb);
end;
$$;

create or replace function public.workspace_save_team(p_id uuid, p_name text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text := nullif(trim(coalesce(p_name, '')), '');
  v_id uuid := p_id;
begin
  if not public.workspace_is_admin() then
    raise exception 'app: Only a workspace owner or admin can edit teams.';
  end if;
  if v_name is null or char_length(v_name) > 80 then
    raise exception 'app: Give the team a name.';
  end if;
  if v_id is null then
    insert into public.workspace_teams (name) values (v_name) returning id into v_id;
  else
    update public.workspace_teams set name = v_name where id = v_id;
    if not found then
      raise exception 'app: That team was not found.';
    end if;
  end if;
  return v_id;
end;
$$;

create or replace function public.workspace_delete_team(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.workspace_is_admin() then
    raise exception 'app: Only a workspace owner or admin can delete a team.';
  end if;
  delete from public.workspace_teams where id = p_id;
end;
$$;

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
begin
  if not public.workspace_is_admin() then
    raise exception 'app: Only a workspace owner or admin can edit users.';
  end if;
  if p_workspace_role not in ('owner', 'admin', 'manager', 'member', 'viewer') then
    raise exception 'app: Choose a workspace role.';
  end if;
  if p_access_mode not in ('follow', 'custom') then
    raise exception 'app: Choose how access is resolved.';
  end if;
  if exists (
    select 1 from public.profiles
    where id = p_profile and lower(email) = 'alex.ives@jordanfitness.com'
  ) and (p_workspace_role <> 'owner' or p_active is false) then
    raise exception 'app: Alex stays an owner.';
  end if;

  update public.profiles
  set workspace_role = p_workspace_role,
      access_mode = p_access_mode,
      is_active = p_active,
      role = case
        when p_workspace_role in ('owner', 'admin') then 'admin'
        when p_workspace_role = 'manager' then 'approver'
        else 'staff'
      end
  where id = p_profile;

  delete from public.workspace_team_members where profile_id = p_profile;
  insert into public.workspace_team_members (team_id, profile_id)
  select team_id, p_profile
  from unnest(coalesce(p_team_ids, '{}'::uuid[])) as team_id;

  if p_access_mode = 'custom' and p_custom is not null then
    for v_module, v_level in
      select key, value
      from jsonb_each_text(p_custom)
    loop
      if v_module in ('people', 'service', 'supply', 'operations', 'sales', 'finance')
         and v_level in ('none', 'view', 'edit') then
        insert into public.module_access (profile_id, module_id, enabled, access_level)
        values (p_profile, v_module, v_level <> 'none', v_level)
        on conflict (profile_id, module_id) do update
          set enabled = excluded.enabled,
              access_level = excluded.access_level;
      end if;
    end loop;
  end if;
end;
$$;

revoke all on function public.workspace_is_admin() from public, anon;
revoke all on function public.workspace_level(uuid, text) from public, anon;
revoke all on function public.workspace_my_access() from public, anon;
revoke all on function public.workspace_directory() from public, anon;
revoke all on function public.workspace_teams() from public, anon;
revoke all on function public.workspace_save_team(uuid, text) from public, anon;
revoke all on function public.workspace_delete_team(uuid) from public, anon;
revoke all on function public.workspace_save_user(uuid, text, text, uuid[], jsonb, boolean) from public, anon;

grant execute on function public.workspace_is_admin() to authenticated, service_role;
grant execute on function public.workspace_level(uuid, text) to authenticated, service_role;
grant execute on function public.workspace_my_access() to authenticated, service_role;
grant execute on function public.workspace_directory() to authenticated, service_role;
grant execute on function public.workspace_teams() to authenticated, service_role;
grant execute on function public.workspace_save_team(uuid, text) to authenticated, service_role;
grant execute on function public.workspace_delete_team(uuid) to authenticated, service_role;
grant execute on function public.workspace_save_user(uuid, text, text, uuid[], jsonb, boolean) to authenticated, service_role;

create or replace function public.workspace_prepare_invite(
  p_email text,
  p_full_name text,
  p_workspace_role text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := lower(trim(coalesce(p_email, '')));
  v_name text := nullif(trim(coalesce(p_full_name, '')), '');
  v_workspace text := p_workspace_role;
  v_role text;
  v_user_id uuid;
  v_existing boolean := false;
begin
  if not public.workspace_is_admin() then
    raise exception 'app: Only a workspace owner or admin can invite someone.';
  end if;
  if v_email !~ '^[^@[:space:]]+@jordanfitness\.com$' then
    raise exception 'app: Use a @jordanfitness.com email address.';
  end if;
  if v_workspace not in ('owner', 'admin', 'manager', 'member', 'viewer') then
    raise exception 'app: Choose a workspace role.';
  end if;
  v_role := case
    when v_workspace in ('owner', 'admin') then 'admin'
    when v_workspace = 'manager' then 'approver'
    else 'staff'
  end;

  insert into public.access_grants (email, full_name, role, people_enabled, invited_by)
  values (v_email, v_name, v_role, true, auth.uid())
  on conflict (email) do update
    set full_name = excluded.full_name,
        role = excluded.role,
        people_enabled = true,
        invited_by = excluded.invited_by,
        updated_at = now();

  select id into v_user_id from auth.users where lower(email) = v_email limit 1;
  if v_user_id is not null then
    v_existing := true;
    update public.profiles
    set full_name = coalesce(v_name, full_name),
        role = v_role,
        workspace_role = v_workspace,
        access_mode = 'follow',
        is_active = true,
        access_granted = true
    where id = v_user_id;
    perform private.seed_module_access(v_user_id, true);
  end if;

  return jsonb_build_object(
    'email', v_email,
    'role', v_role,
    'already_registered', v_existing,
    'user_id', v_user_id
  );
end;
$$;

revoke all on function public.workspace_prepare_invite(text, text, text) from public, anon;
grant execute on function public.workspace_prepare_invite(text, text, text) to authenticated, service_role;
