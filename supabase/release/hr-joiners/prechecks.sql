-- Read only. Run before 20261129200000_hr_joiners_leavers.sql.
-- Expected: employees, director check, workspace admin check, and ops.resources are present.
-- Expected: checklist tables are absent, and hr.employees has no engineer_resource_id yet.
-- New file only. Do not apply to production.

select
  to_regclass('hr.employees') is not null as employees,
  to_regprocedure('hr.is_director()') is not null as director_check,
  to_regprocedure('public.workspace_is_admin()') is not null as workspace_admin_check,
  to_regprocedure('hr.aal_ok()') is not null as two_step_check,
  to_regclass('ops.resources') is not null as resources,
  to_regclass('hr.checklist_templates') is null as templates_absent,
  to_regclass('hr.checklists') is null as checklists_absent,
  to_regclass('hr.checklist_items') is null as items_absent,
  not exists (
    select 1
    from information_schema.columns
    where table_schema = 'hr'
      and table_name = 'employees'
      and column_name = 'engineer_resource_id'
  ) as engineer_link_absent;

do $$
begin
  if to_regclass('hr.employees') is null
     or to_regprocedure('hr.is_director()') is null
     or to_regprocedure('public.workspace_is_admin()') is null
     or to_regprocedure('hr.aal_ok()') is null
     or to_regclass('ops.resources') is null
  then
    raise exception 'PRECHECK FAILED: HR Pulse phase 1 is not in place.';
  end if;
  if to_regclass('hr.checklist_templates') is not null
     or to_regclass('hr.checklists') is not null
     or to_regclass('hr.checklist_items') is not null
  then
    raise exception 'PRECHECK FAILED: checklist tables already exist.';
  end if;
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'hr'
      and table_name = 'employees'
      and column_name = 'engineer_resource_id'
  ) then
    raise exception 'PRECHECK FAILED: engineer_resource_id already exists.';
  end if;
end
$$;
