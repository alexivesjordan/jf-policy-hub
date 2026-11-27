-- Read only. Run before 20261128520000_service_visit_sheet.sql. Not for production.

do $$
begin
  if to_regclass('svc.visits') is null then
    raise exception 'PRECHECK FAILED: svc.visits is missing.';
  end if;
  if to_regclass('ops.visit_sheets') is null then
    raise exception 'PRECHECK FAILED: ops.visit_sheets is missing.';
  end if;
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'ops'
      and table_name = 'visit_sheets'
      and column_name = 'service_visit_id'
  ) then
    raise exception 'PRECHECK FAILED: ops.visit_sheets.service_visit_id already exists.';
  end if;
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'ops'
      and table_name = 'visit_sheets'
      and column_name = 'install_id'
      and is_nullable = 'NO'
  ) then
    raise exception 'PRECHECK FAILED: ops.visit_sheets.install_id is already nullable.';
  end if;
  if to_regprocedure('public.install_save_visit_sheet(uuid,jsonb,text)') is null then
    raise exception 'PRECHECK FAILED: public.install_save_visit_sheet is missing.';
  end if;
  if to_regprocedure('ops.assert_visit_started(uuid,text)') is null then
    raise exception 'PRECHECK FAILED: ops.assert_visit_started is missing.';
  end if;
  if to_regprocedure('public.service_visit_set_progress(uuid,text,text,text)') is null then
    raise exception 'PRECHECK FAILED: public.service_visit_set_progress is missing.';
  end if;
end
$$;
