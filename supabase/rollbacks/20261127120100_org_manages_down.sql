-- Restores line-manager checks from 20261126100000 and drops the org chart.
-- Do not run on production.

create or replace function hr.manages(p_employee uuid)
returns boolean
language sql
stable
security definer
set search_path = hr, public
as $$
  select exists (
    select 1
    from hr.employees report
    join hr.employees manager on manager.id = report.manager_id
    where report.id = p_employee
      and manager.profile_id = auth.uid()
  );
$$;

create or replace function hr.manages_chain(p_employee uuid)
returns boolean
language sql
stable
security definer
set search_path = hr, public
as $$
  with recursive up as (
    select manager_id as id
    from hr.employees
    where id = p_employee and manager_id is not null
    union all
    select e.manager_id
    from hr.employees e
    join up on e.id = up.id
    where e.manager_id is not null
  )
  select exists (
    select 1 from up
    join hr.employees manager on manager.id = up.id
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
    hr.is_self(p_employee) or hr.manages(p_employee) or hr.is_director()
  );
$$;

create or replace function hr.can_edit_employee(p_employee uuid)
returns boolean
language sql
stable
security definer
set search_path = hr, public
as $$
  select public.is_active_user() and (hr.manages(p_employee) or hr.is_director());
$$;

drop view if exists public.hr_leave_dates;
drop function if exists public.org_chart();
drop function if exists public.org_add_person(text, uuid);
drop function if exists public.org_set_director(uuid, boolean);
drop function if exists public.org_set_company(uuid, uuid);
drop function if exists public.org_set_lead(uuid, uuid);
drop function if exists public.org_clear_holder(uuid, uuid);
drop function if exists public.org_set_holder(uuid, uuid);
drop function if exists public.org_set_reports_to(uuid, uuid);
drop function if exists public.org_add_position(text, uuid, uuid, boolean);
drop function if exists public.org_require_admin();
drop function if exists hr.filled_seat(uuid);

drop trigger if exists employees_apply_position on hr.employees;
drop trigger if exists position_holders_one_seat on hr.position_holders;
drop trigger if exists positions_reject_cycle on hr.positions;
drop trigger if exists positions_sync_managers on hr.positions;
drop trigger if exists position_holders_sync_managers on hr.position_holders;

alter table hr.employees drop constraint if exists employees_position_fk;
alter table hr.employees drop constraint if exists employees_lead_not_self;
alter table hr.employees drop column if exists position_id;
alter table hr.employees drop column if exists lead_id;
alter table hr.employees drop column if exists company_id;

drop table if exists hr.position_holders;
drop table if exists hr.positions;
drop function if exists hr.leads(uuid);
drop function if exists hr.employees_apply_position();
drop function if exists hr.reject_extra_holder();
drop function if exists hr.reject_position_cycle();
drop function if exists hr.touch_org_managers();
drop function if exists hr.sync_manager_ids();
drop function if exists hr.primary_manager(uuid);
drop function if exists hr.resolved_manager_position(uuid);
drop function if exists hr.position_has_holder(uuid);
drop table if exists core.companies;
