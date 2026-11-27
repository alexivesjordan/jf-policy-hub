-- Read only. Run before 20261128900000_order_tracker.sql. Not for production.
-- Expected result: installs, files, workspace_can, and qc_private are true, and trackers_absent is true.

select
  to_regclass('ops.installs') is not null as installs,
  to_regclass('core.files') is not null as files,
  to_regprocedure('public.workspace_can(text,text)') is not null as workspace_can,
  exists (select 1 from storage.buckets where id = 'qc' and public = false) as qc_private,
  to_regclass('ops.order_trackers') is null as trackers_absent;

do $$
begin
  if to_regclass('ops.installs') is null then
    raise exception 'PRECHECK FAILED: ops.installs is missing.';
  end if;
  if to_regclass('core.files') is null then
    raise exception 'PRECHECK FAILED: core.files is missing.';
  end if;
  if to_regprocedure('public.workspace_can(text,text)') is null then
    raise exception 'PRECHECK FAILED: public.workspace_can is missing.';
  end if;
  if not exists (select 1 from storage.buckets where id = 'qc' and public = false) then
    raise exception 'PRECHECK FAILED: the private qc bucket is missing.';
  end if;
  if to_regclass('ops.order_trackers') is not null then
    raise exception 'PRECHECK FAILED: ops.order_trackers already exists.';
  end if;
end
$$;
