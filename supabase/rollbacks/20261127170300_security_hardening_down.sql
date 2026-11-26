-- Undoes 20261127170000 through 20261127170300. Does not drop backup rows.
-- Do not run on production.

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

revoke all on function public.workspace_access_row(uuid, text) from public, anon;
grant execute on function public.workspace_access_row(uuid, text) to authenticated, service_role;
grant execute on function public.guard_last_owner() to authenticated;

grant execute on function hr.touch_org_managers() to public, anon, authenticated;
grant execute on function hr.employees_apply_position() to public, anon, authenticated;
grant execute on function hr.reject_position_cycle() to public, anon, authenticated;
grant execute on function hr.reject_extra_holder() to public, anon, authenticated;
grant execute on function hr.audit_row_change() to public, anon, authenticated;
grant execute on function hr.prevent_append_change() to public, anon, authenticated;
grant execute on function hr.prevent_audit_mutation() to public, anon, authenticated;

drop policy if exists companies_read on core.companies;
drop policy if exists pulses_read on core.pulses;
drop policy if exists positions_read on hr.positions;
drop policy if exists position_holders_read on hr.position_holders;
drop policy if exists invitations_read on core.invitations;
drop policy if exists email_challenges_own on core.email_challenges;
drop policy if exists verified_sessions_own on core.verified_sessions;
drop policy if exists trusted_devices_own on core.trusted_devices;

alter table core.companies disable row level security;
alter table core.pulses disable row level security;
alter table core.invitations disable row level security;
alter table core.email_challenges disable row level security;
alter table core.verified_sessions disable row level security;
alter table core.trusted_devices disable row level security;
alter table hr.positions disable row level security;
alter table hr.position_holders disable row level security;

do $$
declare
  v_schema text;
  v_table text;
begin
  for v_schema, v_table in
    select schema_name, table_name
    from (values
      ('public', 'profiles_backup_20261127'),
      ('public', 'module_access_backup_20261127'),
      ('public', 'access_snapshot_before_20261127'),
      ('public', 'profiles_adminrole_backup_20261126'),
      ('hr', 'seatload_employees_backup_20261126'),
      ('hr', 'seatload_positions_backup_20261126'),
      ('hr', 'seatload_holders_backup_20261126')
    ) as listed(schema_name, table_name)
  loop
    if to_regclass(format('%I.%I', v_schema, v_table)) is not null then
      execute format('grant all on table %I.%I to anon, authenticated', v_schema, v_table);
    end if;
  end loop;
end
$$;

create or replace view public.hr_leave_dates
with (security_barrier = true, security_invoker = false) as
select r.id, r.employee_id, r.starts_on, r.ends_on, r.kind, r.status
from hr.leave_requests r
where public.is_active_user()
  and (
    hr.is_self(r.employee_id)
    or hr.leads(r.employee_id)
    or (hr.aal_ok() and hr.can_view_employee(r.employee_id))
  );

revoke all on public.hr_leave_dates from public, anon;
grant select on public.hr_leave_dates to authenticated, service_role;

drop function if exists public.hr_leave_date_rows();
