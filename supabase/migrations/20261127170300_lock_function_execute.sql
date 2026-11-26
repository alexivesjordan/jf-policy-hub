-- Close two function gaps. New file only. Do not apply to production.
-- workspace_access_row: a signed-in person can read their own row. An owner or
-- admin can read anyone's, which is what the member page already does.
-- guard_last_owner and the HR trigger functions stay as triggers. Callers cannot
-- execute them through the API.

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
  if auth.uid() is null then
    raise exception 'app: Sign in first.';
  end if;
  if p_profile is distinct from auth.uid() and not public.workspace_is_admin() then
    raise exception 'app: Only a workspace owner or admin can open this.';
  end if;

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

revoke all on function public.workspace_access_row(uuid, text) from public, anon;
grant execute on function public.workspace_access_row(uuid, text) to authenticated, service_role;

revoke all on function public.guard_last_owner() from public, anon, authenticated;

revoke all on function hr.touch_org_managers() from public, anon, authenticated;
revoke all on function hr.employees_apply_position() from public, anon, authenticated;
revoke all on function hr.reject_position_cycle() from public, anon, authenticated;
revoke all on function hr.reject_extra_holder() from public, anon, authenticated;
revoke all on function hr.audit_row_change() from public, anon, authenticated;
revoke all on function hr.prevent_append_change() from public, anon, authenticated;
revoke all on function hr.prevent_audit_mutation() from public, anon, authenticated;
