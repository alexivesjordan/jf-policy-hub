-- Read only. Run before 20261128500000_service_pulse.sql. Not for production.

do $$
begin
  if to_regclass('ops.resources') is null then
    raise exception 'PRECHECK FAILED: ops.resources is missing.';
  end if;
  if to_regclass('ops.install_reservations') is null then
    raise exception 'PRECHECK FAILED: ops.install_reservations is missing.';
  end if;
  if to_regclass('core.files') is null then
    raise exception 'PRECHECK FAILED: core.files is missing.';
  end if;
  if to_regclass('core.pulses') is null then
    raise exception 'PRECHECK FAILED: core.pulses is missing.';
  end if;
  if not exists (select 1 from core.pulses where id = 'service') then
    raise exception 'PRECHECK FAILED: the service pulse row is missing.';
  end if;
  if to_regprocedure('public.workspace_can(text,text)') is null then
    raise exception 'PRECHECK FAILED: public.workspace_can is missing.';
  end if;
  if to_regprocedure('ops.resource_free_for_days(uuid,date[])') is null then
    raise exception 'PRECHECK FAILED: ops.resource_free_for_days is missing.';
  end if;
  if to_regclass('svc.visits') is not null then
    raise exception 'PRECHECK FAILED: svc.visits already exists.';
  end if;
end
$$;
