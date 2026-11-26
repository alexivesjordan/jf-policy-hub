-- Line managers follow seats. A vacant seat walks up to the next filled one.
-- Direct managers approve. The chain can see the wider team.
-- Search path stays pinned. New file only. Do not apply to production.

create or replace function hr.manages(p_employee uuid)
returns boolean
language sql
stable
security definer
set search_path = hr, public
as $$
  select public.is_active_user() and exists (
    select 1
    from hr.employees subject
    join hr.position_holders h
      on h.position_id = hr.resolved_manager_position(subject.position_id)
     and h.to_date is null
    join hr.employees manager on manager.id = h.employee_id
    where subject.id = p_employee
      and manager.profile_id = auth.uid()
  );
$$;

create or replace function hr.filled_seat(p_position uuid)
returns uuid
language sql
stable
security definer
set search_path = hr, public
as $$
  select case
    when p_position is null then null
    when hr.position_has_holder(p_position) then p_position
    else hr.resolved_manager_position(p_position)
  end;
$$;

create or replace function hr.manages_chain(p_employee uuid)
returns boolean
language sql
stable
security definer
set search_path = hr, public
as $$
  with recursive chain as (
    select hr.resolved_manager_position(e.position_id) as position_id, 0 as depth
    from hr.employees e
    where e.id = p_employee
    union all
    select hr.filled_seat(p.reports_to_position_id), chain.depth + 1
    from chain
    join hr.positions p on p.id = chain.position_id
    where p.reports_to_position_id is not null
      and chain.depth < 30
  )
  select public.is_active_user() and exists (
    select 1
    from chain
    join hr.position_holders h on h.position_id = chain.position_id and h.to_date is null
    join hr.employees manager on manager.id = h.employee_id
    where manager.profile_id = auth.uid()
  );
$$;

create or replace function hr.can_view_employee(p_employee uuid)
returns boolean
language sql
stable
security definer
set search_path = hr, public
as $$
  select public.is_active_user() and (
    hr.is_self(p_employee) or hr.manages_chain(p_employee) or hr.is_director()
  );
$$;

create or replace function hr.can_edit_employee(p_employee uuid)
returns boolean
language sql
stable
security definer
set search_path = hr, public
as $$
  select public.is_active_user() and (hr.manages_chain(p_employee) or hr.is_director());
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

comment on view public.hr_leave_dates is
  'Leave dates for the person, a day-to-day lead, or someone who can see the HR record. No note.';

revoke all on public.hr_leave_dates from public, anon;
grant select on public.hr_leave_dates to authenticated, service_role;

create or replace function public.org_require_admin()
returns void
language plpgsql
security definer
set search_path = hr, public
as $$
begin
  if not public.workspace_is_admin() then
    raise exception 'app: Only a workspace owner or admin can change the org chart.';
  end if;
end;
$$;

create or replace function public.org_add_position(p_title text, p_reports_to uuid, p_company uuid, p_allow_multiple boolean)
returns uuid
language plpgsql
security definer
set search_path = hr, public
as $$
declare
  v_id uuid;
begin
  perform public.org_require_admin();
  insert into hr.positions (title, reports_to_position_id, company_id, allow_multiple)
  values (trim(p_title), p_reports_to, p_company, coalesce(p_allow_multiple, false))
  returning id into v_id;
  insert into hr.audit_log (actor_id, entity_schema, entity_table, entity_id, action, new_value)
  values (auth.uid(), 'hr', 'positions', v_id, 'add', jsonb_build_object('title', trim(p_title)));
  return v_id;
end;
$$;

create or replace function public.org_set_reports_to(p_position uuid, p_reports_to uuid)
returns void
language plpgsql
security definer
set search_path = hr, public
as $$
begin
  perform public.org_require_admin();
  update hr.positions set reports_to_position_id = p_reports_to where id = p_position;
  if not found then raise exception 'app: That seat was not found.'; end if;
  perform hr.sync_manager_ids();
  insert into hr.audit_log (actor_id, entity_schema, entity_table, entity_id, action, new_value)
  values (auth.uid(), 'hr', 'positions', p_position, 'reports_to', jsonb_build_object('reports_to', p_reports_to));
end;
$$;

create or replace function public.org_set_holder(p_position uuid, p_employee uuid)
returns void
language plpgsql
security definer
set search_path = hr, public
as $$
begin
  perform public.org_require_admin();
  update hr.position_holders set to_date = current_date
  where position_id = p_position and employee_id = p_employee and to_date is null;
  insert into hr.position_holders (position_id, employee_id, from_date)
  values (p_position, p_employee, current_date);
  update hr.employees set position_id = p_position where id = p_employee;
  perform hr.sync_manager_ids();
  insert into hr.audit_log (actor_id, entity_schema, entity_table, entity_id, action, new_value)
  values (auth.uid(), 'hr', 'position_holders', p_position, 'holder', jsonb_build_object('employee', p_employee));
end;
$$;

create or replace function public.org_clear_holder(p_position uuid, p_employee uuid)
returns void
language plpgsql
security definer
set search_path = hr, public
as $$
begin
  perform public.org_require_admin();
  update hr.position_holders set to_date = current_date
  where position_id = p_position and employee_id = p_employee and to_date is null;
  perform hr.sync_manager_ids();
  insert into hr.audit_log (actor_id, entity_schema, entity_table, entity_id, action, new_value)
  values (auth.uid(), 'hr', 'position_holders', p_position, 'clear_holder', jsonb_build_object('employee', p_employee));
end;
$$;

create or replace function public.org_set_lead(p_employee uuid, p_lead uuid)
returns void
language plpgsql
security definer
set search_path = hr, public
as $$
begin
  perform public.org_require_admin();
  update hr.employees set lead_id = p_lead where id = p_employee;
  if not found then raise exception 'app: That person was not found.'; end if;
  insert into hr.audit_log (actor_id, entity_schema, entity_table, entity_id, action, new_value)
  values (auth.uid(), 'hr', 'employees', p_employee, 'lead', jsonb_build_object('lead', p_lead));
end;
$$;

create or replace function public.org_set_company(p_employee uuid, p_company uuid)
returns void
language plpgsql
security definer
set search_path = hr, public
as $$
begin
  perform public.org_require_admin();
  update hr.employees set company_id = p_company where id = p_employee;
  if not found then raise exception 'app: That person was not found.'; end if;
  insert into hr.audit_log (actor_id, entity_schema, entity_table, entity_id, action, new_value)
  values (auth.uid(), 'hr', 'employees', p_employee, 'company', jsonb_build_object('company', p_company));
end;
$$;

create or replace function public.org_set_director(p_profile uuid, p_on boolean)
returns void
language plpgsql
security definer
set search_path = hr, public
as $$
begin
  perform public.org_require_admin();
  if p_on then
    insert into hr.directors (profile_id) values (p_profile) on conflict (profile_id) do nothing;
  else
    delete from hr.directors where profile_id = p_profile;
  end if;
  insert into hr.audit_log (actor_id, entity_schema, entity_table, entity_id, action, new_value)
  values (auth.uid(), 'hr', 'directors', p_profile, 'director', jsonb_build_object('on', p_on));
end;
$$;

create or replace function public.org_add_person(p_name text, p_company uuid)
returns uuid
language plpgsql
security definer
set search_path = hr, public
as $$
declare
  v_id uuid;
  v_company uuid := coalesce(p_company, (select id from core.companies where name = 'Jordan Fitness' limit 1));
begin
  perform public.org_require_admin();
  insert into hr.employees (full_name, status, company_id)
  values (trim(p_name), 'active', v_company)
  returning id into v_id;
  insert into hr.audit_log (actor_id, entity_schema, entity_table, entity_id, action, new_value)
  values (auth.uid(), 'hr', 'employees', v_id, 'add', jsonb_build_object('name', trim(p_name)));
  return v_id;
end;
$$;

create or replace function public.org_chart()
returns jsonb
language plpgsql
stable
security definer
set search_path = hr, public
as $$
begin
  if not public.workspace_is_admin() then
    raise exception 'app: Only a workspace owner or admin can open the org chart.';
  end if;
  return jsonb_build_object(
    'companies', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name) order by name) from core.companies), '[]'::jsonb),
    'positions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id,
        'title', p.title,
        'reports_to', p.reports_to_position_id,
        'company_id', p.company_id,
        'allow_multiple', p.allow_multiple,
        'archived', p.archived_at is not null,
        'holders', coalesce((
          select jsonb_agg(jsonb_build_object('id', e.id, 'name', e.full_name) order by e.full_name)
          from hr.position_holders h
          join hr.employees e on e.id = h.employee_id
          where h.position_id = p.id and h.to_date is null
        ), '[]'::jsonb)
      ) order by p.title)
      from hr.positions p
      where p.archived_at is null
    ), '[]'::jsonb),
    'people', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', e.id,
        'name', e.full_name,
        'position_id', e.position_id,
        'company_id', e.company_id,
        'company', c.name,
        'lead_id', e.lead_id,
        'lead', lead.full_name,
        'manager', manager.full_name,
        'director', exists (select 1 from hr.directors d where d.profile_id = e.profile_id)
      ) order by e.full_name)
      from hr.employees e
      left join core.companies c on c.id = e.company_id
      left join hr.employees lead on lead.id = e.lead_id
      left join hr.employees manager on manager.id = e.manager_id
      where e.status = 'active'
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.org_require_admin() from public, anon;
revoke all on function public.org_add_position(text, uuid, uuid, boolean) from public, anon;
revoke all on function public.org_set_reports_to(uuid, uuid) from public, anon;
revoke all on function public.org_set_holder(uuid, uuid) from public, anon;
revoke all on function public.org_clear_holder(uuid, uuid) from public, anon;
revoke all on function public.org_set_lead(uuid, uuid) from public, anon;
revoke all on function public.org_set_company(uuid, uuid) from public, anon;
revoke all on function public.org_set_director(uuid, boolean) from public, anon;
revoke all on function public.org_add_person(text, uuid) from public, anon;
revoke all on function public.org_chart() from public, anon;
grant execute on function public.org_require_admin() to authenticated, service_role;
grant execute on function public.org_add_position(text, uuid, uuid, boolean) to authenticated, service_role;
grant execute on function public.org_set_reports_to(uuid, uuid) to authenticated, service_role;
grant execute on function public.org_set_holder(uuid, uuid) to authenticated, service_role;
grant execute on function public.org_clear_holder(uuid, uuid) to authenticated, service_role;
grant execute on function public.org_set_lead(uuid, uuid) to authenticated, service_role;
grant execute on function public.org_set_company(uuid, uuid) to authenticated, service_role;
grant execute on function public.org_set_director(uuid, boolean) to authenticated, service_role;
grant execute on function public.org_add_person(text, uuid) to authenticated, service_role;
grant execute on function public.org_chart() to authenticated, service_role;

revoke all on function hr.filled_seat(uuid) from public, anon;
revoke all on function hr.manages(uuid) from public, anon;
revoke all on function hr.manages_chain(uuid) from public, anon;
revoke all on function hr.can_view_employee(uuid) from public, anon;
revoke all on function hr.can_edit_employee(uuid) from public, anon;
grant execute on function hr.filled_seat(uuid) to authenticated, service_role;
grant execute on function hr.manages(uuid) to authenticated, service_role;
grant execute on function hr.manages_chain(uuid) to authenticated, service_role;
grant execute on function hr.can_view_employee(uuid) to authenticated, service_role;
grant execute on function hr.can_edit_employee(uuid) to authenticated, service_role;
