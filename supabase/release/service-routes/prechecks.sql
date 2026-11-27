-- Read only. Run before 20261128800000_service_routes_and_plans.sql.
-- Expected: this block finishes with no exception.
-- Expected rows: none (the checks raise on failure).
-- svc.visits exists, svc.maintenance_plans does not, svc.visits.maintenance_plan_id does not,
-- public.service_visit_save_body(uuid, jsonb) exists, ops.installs.warranty_option exists.
-- New file only. Do not apply to production.

do $$
begin
  if to_regclass('svc.visits') is null then
    raise exception 'PRECHECK FAILED: svc.visits is missing.';
  end if;
  if to_regclass('svc.sites') is null then
    raise exception 'PRECHECK FAILED: svc.sites is missing.';
  end if;
  if to_regclass('svc.maintenance_plans') is not null then
    raise exception 'PRECHECK FAILED: svc.maintenance_plans already exists.';
  end if;
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'svc'
      and table_name = 'visits'
      and column_name = 'maintenance_plan_id'
  ) then
    raise exception 'PRECHECK FAILED: svc.visits.maintenance_plan_id already exists.';
  end if;
  if to_regprocedure('public.service_visit_save_body(uuid,jsonb)') is null then
    raise exception 'PRECHECK FAILED: public.service_visit_save_body(uuid,jsonb) is missing.';
  end if;
  if to_regprocedure('public.service_visit_save(uuid,jsonb)') is null then
    raise exception 'PRECHECK FAILED: public.service_visit_save(uuid,jsonb) is missing.';
  end if;
  if to_regprocedure('svc.office(text)') is null then
    raise exception 'PRECHECK FAILED: svc.office(text) is missing.';
  end if;
  if to_regclass('ops.installs') is null then
    raise exception 'PRECHECK FAILED: ops.installs is missing.';
  end if;
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'ops'
      and table_name = 'installs'
      and column_name = 'warranty_option'
  ) then
    raise exception 'PRECHECK FAILED: ops.installs.warranty_option is missing.';
  end if;
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'ops'
      and table_name = 'installs'
      and column_name = 'archived_at'
  ) then
    raise exception 'PRECHECK FAILED: ops.installs.archived_at is missing.';
  end if;
end
$$;
