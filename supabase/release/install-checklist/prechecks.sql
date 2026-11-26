-- Read only. Run before 20261128410000_install_handover_checks.sql.
-- Do not apply to production.

do $$
begin
  if to_regclass('ops.visit_sheets') is null then
    raise exception 'PRECHECK FAILED: ops.visit_sheets is missing.';
  end if;
  if to_regprocedure('public.install_save_visit_sheet(uuid, jsonb, text)') is null then
    raise exception 'PRECHECK FAILED: public.install_save_visit_sheet is missing.';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'ops' and table_name = 'visit_sheet_lines' and column_name = 'fulfilment'
  ) then
    raise exception 'PRECHECK FAILED: apply 20261128400000_partial_kit_follow_up.sql first.';
  end if;
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'ops' and table_name = 'visit_sheets' and column_name = 'floor_sheeting'
  ) then
    raise exception 'PRECHECK FAILED: the handover columns are already present.';
  end if;
end
$$;
