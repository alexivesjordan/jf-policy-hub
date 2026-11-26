-- Read only. Run before 20261128400000_partial_kit_follow_up.sql.
-- Do not apply to production.

do $$
begin
  if to_regclass('ops.visit_sheets') is null or to_regclass('ops.visit_sheet_lines') is null then
    raise exception 'PRECHECK FAILED: the job sheet tables are missing.';
  end if;
  if to_regclass('core.tasks') is null then
    raise exception 'PRECHECK FAILED: core.tasks is missing.';
  end if;
  if to_regprocedure('public.install_save_visit_sheet(uuid, jsonb, text)') is null then
    raise exception 'PRECHECK FAILED: public.install_save_visit_sheet is missing.';
  end if;
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'ops' and table_name = 'visit_sheet_lines' and column_name = 'fulfilment'
  ) then
    raise exception 'PRECHECK FAILED: ops.visit_sheet_lines.fulfilment is already present.';
  end if;
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'ops' and table_name = 'visit_sheets' and column_name = 'follow_up_task_id'
  ) then
    raise exception 'PRECHECK FAILED: ops.visit_sheets.follow_up_task_id is already present.';
  end if;
end
$$;
