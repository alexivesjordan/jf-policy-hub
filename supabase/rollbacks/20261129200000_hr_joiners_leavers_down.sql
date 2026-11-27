-- Reverse HR Pulse Phase 2a joiners and leavers.
-- DESTRUCTIVE: copies checklist rows into backup tables, then drops the checklist tables
-- and hr.employees.engineer_resource_id. Employee rows stay. The engineer link is removed.
-- New file only. Do not apply to production.

drop table if exists hr.checklist_rollback_backup_items;
drop table if exists hr.checklist_rollback_backup_checklists;
drop table if exists hr.checklist_rollback_backup_templates;

create table hr.checklist_rollback_backup_items as select * from hr.checklist_items;
create table hr.checklist_rollback_backup_checklists as select * from hr.checklists;
create table hr.checklist_rollback_backup_templates as select * from hr.checklist_templates;

alter table hr.checklist_rollback_backup_items enable row level security;
alter table hr.checklist_rollback_backup_checklists enable row level security;
alter table hr.checklist_rollback_backup_templates enable row level security;
revoke all on hr.checklist_rollback_backup_items, hr.checklist_rollback_backup_checklists, hr.checklist_rollback_backup_templates
  from public, anon, authenticated;
grant all on hr.checklist_rollback_backup_items, hr.checklist_rollback_backup_checklists, hr.checklist_rollback_backup_templates
  to service_role;

drop view if exists public.hr_checklist_items;
drop view if exists public.hr_checklists;
drop view if exists public.hr_checklist_templates;

drop table if exists hr.checklist_items;
drop table if exists hr.checklists;
drop table if exists hr.checklist_templates;

drop function if exists public.hr_person_checklists(uuid);
drop function if exists public.hr_manager_options();
drop function if exists public.hr_open_checklists();
drop function if exists public.hr_set_checklist_item(uuid, boolean);
drop function if exists public.hr_start_leaving(uuid, date, text);
drop function if exists public.hr_create_joiner(text, text, text, text, text, text, text, date, uuid, text, numeric, text, uuid);
drop function if exists public.hr_checklist_access(uuid);

drop function if exists hr.open_checklist(uuid, text, date, text, uuid);
drop function if exists hr.refresh_checklist_status(uuid);
drop function if exists hr.template_items(uuid, text);
drop function if exists hr.shift_due(date, integer);
drop function if exists hr.checklist_visible(uuid);
drop function if exists hr.checklist_reports(uuid);

alter table hr.employees drop column if exists engineer_resource_id;

select
  to_regclass('hr.checklist_templates') is null as templates_gone,
  to_regclass('hr.checklists') is null as checklists_gone,
  to_regclass('hr.checklist_items') is null as items_gone,
  to_regprocedure('public.hr_create_joiner(text, text, text, text, text, text, text, date, uuid, text, numeric, text, uuid)') is null as create_joiner_gone,
  not exists (
    select 1
    from information_schema.columns
    where table_schema = 'hr'
      and table_name = 'employees'
      and column_name = 'engineer_resource_id'
  ) as engineer_link_gone,
  (select count(*) from hr.checklist_rollback_backup_templates) as backed_up_templates,
  (select count(*) from hr.checklist_rollback_backup_checklists) as backed_up_checklists,
  (select count(*) from hr.checklist_rollback_backup_items) as backed_up_items;
