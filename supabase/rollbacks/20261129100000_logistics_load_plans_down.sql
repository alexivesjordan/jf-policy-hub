-- DESTRUCTIVE. Copies saved load plans aside, then removes the planner.
-- The pallet, container, and vehicle catalogue stays.
-- New file only. Do not apply to production.

drop table if exists logistics.load_plans_backup_20261129;
create table logistics.load_plans_backup_20261129 as
  select * from logistics.load_plans;

comment on table logistics.load_plans_backup_20261129 is
  'Backup taken before dropping logistics.load_plans. Drop this table once the rollback is no longer needed.';

drop trigger if exists load_plans_keep_author on logistics.load_plans;
drop function if exists logistics.load_plans_keep_author();

drop table if exists logistics.load_plans;

drop policy if exists load_spaces_admin_insert on logistics.load_spaces;
drop policy if exists load_spaces_admin_update on logistics.load_spaces;
revoke insert, update on logistics.load_spaces from authenticated;

alter table logistics.load_spaces drop constraint if exists load_spaces_code_format;

drop function if exists public.logistics_can_admin_spaces();
drop function if exists logistics.can_admin_spaces();

delete from supabase_migrations.schema_migrations
where version = '20261129100000';
