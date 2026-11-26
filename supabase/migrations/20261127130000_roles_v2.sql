-- Pulse list, team leads, and access with a source.
-- Owner, admin, member and guest are the roles. Manager and viewer stay until the remap.
-- New file only. Do not apply to production.

create table if not exists core.pulses (
  id text primary key,
  name text not null,
  status text not null check (status in ('active', 'coming-soon'))
);

insert into core.pulses (id, name, status) values
  ('people', 'People', 'active'),
  ('operations', 'Operations', 'active'),
  ('sales', 'Sales', 'active'),
  ('logistics', 'Logistics', 'active'),
  ('policies', 'Policies', 'active'),
  ('service', 'Service', 'coming-soon'),
  ('supply', 'Supply', 'coming-soon'),
  ('finance', 'Finance', 'coming-soon')
on conflict (id) do update set name = excluded.name, status = excluded.status;

do $$
declare
  r record;
begin
  for r in
    select conrelid::regclass as table_name, conname
    from pg_constraint
    where contype = 'c'
      and conrelid in ('public.module_access'::regclass, 'public.workspace_team_access'::regclass)
      and (
        pg_get_constraintdef(oid) ilike '%module_id%'
        or pg_get_constraintdef(oid) ilike '%access_level%'
      )
  loop
    execute format('alter table %s drop constraint %I', r.table_name, r.conname);
  end loop;
end
$$;

alter table public.module_access
  add constraint module_access_module_id_check
    check (module_id in ('people', 'service', 'supply', 'operations', 'sales', 'finance', 'logistics', 'policies')),
  add constraint module_access_level_check
    check (access_level in ('none', 'view', 'edit', 'admin'));

alter table public.workspace_team_access
  add constraint workspace_team_access_module_id_check
    check (module_id in ('people', 'service', 'supply', 'operations', 'sales', 'finance', 'logistics', 'policies')),
  add constraint workspace_team_access_level_check
    check (access_level in ('none', 'view', 'edit', 'admin'));

alter table public.workspace_team_members
  add column if not exists role text not null default 'member';

alter table public.workspace_team_members
  drop constraint if exists workspace_team_members_role_check;

alter table public.workspace_team_members
  add constraint workspace_team_members_role_check check (role in ('member', 'lead'));

alter table public.workspace_teams
  add column if not exists description text,
  add column if not exists archived_at timestamptz;

alter table public.profiles
  drop constraint if exists profiles_workspace_role_check;

alter table public.profiles
  add constraint profiles_workspace_role_check
    check (workspace_role in ('owner', 'admin', 'manager', 'member', 'viewer', 'guest'));

create or replace function public.effective_access(p_profile uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_mode text;
  v_role text;
  v_pulse text;
  v_level text;
  v_source text;
  v_team text;
  v_rows jsonb := '[]'::jsonb;
begin
  select access_mode, workspace_role into v_mode, v_role
  from public.profiles
  where id = p_profile;

  for v_pulse in
    select id from core.pulses where status = 'active' order by id
  loop
    v_team := null;
    v_level := null;
    if v_role is null then
      v_level := 'none';
      v_source := 'None';
    elsif v_mode = 'custom' then
      select access_level into v_level
      from public.module_access
      where profile_id = p_profile and module_id = v_pulse;
      v_level := coalesce(v_level, 'none');
      v_source := 'Override';
    elsif v_role = 'owner' then
      v_level := 'admin';
      v_source := 'Owner';
    elsif v_role = 'admin' then
      v_level := 'admin';
      v_source := 'Admin';
    elsif v_role = 'guest' then
      v_level := 'none';
      v_source := 'None';
    else
      select t.name, a.access_level into v_team, v_level
      from public.workspace_team_access a
      join public.workspace_team_members m on m.team_id = a.team_id
      join public.workspace_teams t on t.id = a.team_id
      where m.profile_id = p_profile
        and a.module_id = v_pulse
        and a.access_level in ('view', 'edit', 'admin')
        and t.archived_at is null
      order by case a.access_level when 'admin' then 3 when 'edit' then 2 else 1 end desc, t.name
      limit 1;
      v_level := coalesce(v_level, 'none');
      if v_role = 'viewer' and v_level <> 'none' then
        v_level := 'view';
      elsif v_role = 'manager' and v_level = 'none' then
        v_level := 'view';
        v_source := 'Manager';
      end if;
      if v_source is null then
        v_source := case when v_team is not null and v_level <> 'none' then v_team else 'None' end;
      end if;
    end if;
    v_rows := v_rows || jsonb_build_array(jsonb_build_object('pulse', v_pulse, 'level', v_level, 'source', v_source));
    v_source := null;
  end loop;
  return v_rows;
end;
$$;

create or replace function public.workspace_level(p_profile uuid, p_module text)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select item->>'level'
      from jsonb_array_elements(public.effective_access(p_profile)) item
      where item->>'pulse' = p_module
    ),
    'none'
  );
$$;

create or replace function public.workspace_can(p_module text, p_need text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.is_active
      and p.access_granted
      and (
        p.workspace_role = 'owner'
        or public.workspace_level(p.id, p_module) in ('admin', 'edit')
        or (
          p_need is distinct from 'edit'
          and public.workspace_level(p.id, p_module) = 'view'
        )
      )
  );
$$;

create or replace function public.guard_last_owner()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_was_owner boolean;
  v_still_owner boolean;
  v_others integer;
begin
  v_was_owner := old.workspace_role = 'owner' and old.is_active and old.deleted_at is null;
  if tg_op = 'DELETE' then
    v_still_owner := false;
  else
    v_still_owner := new.workspace_role = 'owner' and new.is_active and new.deleted_at is null;
  end if;
  if v_was_owner and not v_still_owner then
    select count(*) into v_others
    from public.profiles
    where id <> old.id
      and workspace_role = 'owner'
      and is_active
      and deleted_at is null;
    if v_others = 0 then
      raise exception 'app: The last owner cannot be removed.';
    end if;
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_guard_last_owner on public.profiles;
create trigger profiles_guard_last_owner
before update or delete on public.profiles
for each row execute function public.guard_last_owner();

create or replace function public.workspace_my_access()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select case when auth.uid() is null then null else (
    select jsonb_object_agg(item->>'pulse', item->>'level') || jsonb_build_object(
      'role', (select workspace_role from public.profiles where id = auth.uid()),
      'mode', (select access_mode from public.profiles where id = auth.uid())
    )
    from jsonb_array_elements(public.effective_access(auth.uid())) item
  ) end;
$$;

revoke all on function public.effective_access(uuid) from public, anon;
revoke all on function public.guard_last_owner() from public, anon;
grant execute on function public.effective_access(uuid) to authenticated, service_role;
grant execute on function public.guard_last_owner() to service_role;
