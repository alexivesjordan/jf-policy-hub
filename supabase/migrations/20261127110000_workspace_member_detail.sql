-- Read-only member detail for Settings. Owner or admin only.
-- Does not read HR tables. New file only. Do not apply to production.

create or replace function public.workspace_access_row(p_profile uuid, p_module text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_mode text;
  v_role text;
  v_level text;
  v_team text;
  v_source text;
begin
  select access_mode, workspace_role into v_mode, v_role
  from public.profiles
  where id = p_profile;
  if v_role is null then
    return jsonb_build_object('pulse', p_module, 'level', 'none', 'source', 'None');
  end if;

  if v_mode = 'custom' then
    select access_level into v_level
    from public.module_access
    where profile_id = p_profile and module_id = p_module;
    return jsonb_build_object('pulse', p_module, 'level', coalesce(v_level, 'none'), 'source', 'Override');
  end if;

  select t.name into v_team
  from public.workspace_team_access a
  join public.workspace_team_members m on m.team_id = a.team_id
  join public.workspace_teams t on t.id = a.team_id
  where m.profile_id = p_profile
    and a.module_id = p_module
    and a.access_level in ('view', 'edit')
  order by case a.access_level when 'edit' then 2 else 1 end desc, t.name
  limit 1;

  v_level := public.workspace_level(p_profile, p_module);
  if v_role = 'owner' then
    v_source := 'Owner';
  elsif v_role = 'admin' then
    v_source := 'Admin';
  elsif v_team is not null and v_level <> 'none' then
    v_source := v_team;
  elsif v_role = 'manager' and v_level <> 'none' then
    v_source := 'Manager';
  else
    v_source := 'None';
  end if;
  return jsonb_build_object('pulse', p_module, 'level', v_level, 'source', v_source);
end;
$$;

create or replace function public.workspace_member(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_row public.profiles%rowtype;
  v_pulses text[] := array['people', 'operations', 'sales', 'logistics'];
begin
  if not public.workspace_is_admin() then
    raise exception 'app: Only a workspace owner or admin can open this.';
  end if;
  select * into v_row from public.profiles where id = p_id;
  if v_row.id is null then
    raise exception 'app: That person was not found.';
  end if;
  return jsonb_build_object(
    'id', v_row.id,
    'email', v_row.email,
    'first_name', v_row.first_name,
    'last_name', v_row.last_name,
    'full_name', v_row.full_name,
    'workspace_role', v_row.workspace_role,
    'access_mode', v_row.access_mode,
    'is_active', v_row.is_active,
    'last_sign_in_at', v_row.last_sign_in_at,
    'two_step', exists (
      select 1 from auth.mfa_factors f
      where f.user_id = v_row.id and f.status = 'verified'
    ),
    'teams', coalesce((
      select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name) order by t.name)
      from public.workspace_team_members m
      join public.workspace_teams t on t.id = m.team_id
      where m.profile_id = v_row.id
    ), '[]'::jsonb),
    'access', (
      select jsonb_agg(public.workspace_access_row(v_row.id, pulse) order by pulse)
      from unnest(v_pulses) as pulse
    )
  );
end;
$$;

create or replace function public.workspace_member_list()
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
    select jsonb_agg(public.workspace_member(p.id) order by p.full_name)
    from public.profiles p
  ), '[]'::jsonb);
end;
$$;

create or replace function public.workspace_pending_invites()
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
      'email', g.email,
      'full_name', g.full_name,
      'role', g.role,
      'created_at', g.created_at
    ) order by g.created_at desc)
    from public.access_grants g
    where not exists (
      select 1 from public.profiles p where lower(p.email) = lower(g.email)
    )
  ), '[]'::jsonb);
end;
$$;

create or replace function public.workspace_revoke_invite(p_email text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := lower(trim(coalesce(p_email, '')));
begin
  if not public.workspace_is_admin() then
    raise exception 'app: Only a workspace owner or admin can revoke an invite.';
  end if;
  if exists (select 1 from public.profiles p where lower(p.email) = v_email) then
    raise exception 'app: That person has already joined.';
  end if;
  delete from public.access_grants where lower(email) = v_email;
end;
$$;

revoke all on function public.workspace_access_row(uuid, text) from public, anon;
revoke all on function public.workspace_member(uuid) from public, anon;
revoke all on function public.workspace_member_list() from public, anon;
revoke all on function public.workspace_pending_invites() from public, anon;
revoke all on function public.workspace_revoke_invite(text) from public, anon;
grant execute on function public.workspace_access_row(uuid, text) to authenticated, service_role;
grant execute on function public.workspace_member(uuid) to authenticated, service_role;
grant execute on function public.workspace_member_list() to authenticated, service_role;
grant execute on function public.workspace_pending_invites() to authenticated, service_role;
grant execute on function public.workspace_revoke_invite(text) to authenticated, service_role;
