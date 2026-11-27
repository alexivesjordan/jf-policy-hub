-- Read only. Run before 20261127490000_ops_schedule_service_visits.sql. Not for production.

do $$
begin
  if to_regprocedure('public.ops_schedule(date,date)') is null then
    raise exception 'PRECHECK FAILED: public.ops_schedule is missing.';
  end if;
  if to_regclass('svc.visits') is null or to_regclass('svc.visit_assignees') is null then
    raise exception 'PRECHECK FAILED: service visits are missing.';
  end if;
  if to_regprocedure('public.service_visit_save(uuid,jsonb)') is null then
    raise exception 'PRECHECK FAILED: public.service_visit_save is missing.';
  end if;
  if to_regprocedure('svc.overlap_warning(uuid)') is null then
    raise exception 'PRECHECK FAILED: svc.overlap_warning is missing.';
  end if;
end
$$;
