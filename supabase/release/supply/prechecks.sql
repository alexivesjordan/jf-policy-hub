-- Read only. Run before 20261128700000_supply_core.sql. Not for production.
-- Expected: one notice, PRECHECK OK.
-- supply schema is absent, the supply pulse row exists, workspace_can and touch_updated_at exist.

do $$
begin
  if to_regclass('core.pulses') is null then
    raise exception 'PRECHECK FAILED: core.pulses is missing.';
  end if;
  if not exists (select 1 from core.pulses where id = 'supply') then
    raise exception 'PRECHECK FAILED: the supply pulse row is missing.';
  end if;
  if to_regprocedure('public.workspace_can(text,text)') is null then
    raise exception 'PRECHECK FAILED: public.workspace_can is missing.';
  end if;
  if to_regprocedure('public.workspace_level(uuid,text)') is null then
    raise exception 'PRECHECK FAILED: public.workspace_level is missing.';
  end if;
  if to_regprocedure('public.touch_updated_at()') is null then
    raise exception 'PRECHECK FAILED: public.touch_updated_at is missing.';
  end if;
  if to_regclass('public.profiles') is null then
    raise exception 'PRECHECK FAILED: public.profiles is missing.';
  end if;
  if to_regclass('storage.buckets') is null then
    raise exception 'PRECHECK FAILED: storage.buckets is missing.';
  end if;
  if to_regnamespace('supply') is not null then
    raise exception 'PRECHECK FAILED: schema supply already exists.';
  end if;
  if exists (select 1 from storage.buckets where id = 'supply-imports' and public) then
    raise exception 'PRECHECK FAILED: supply-imports is public.';
  end if;
  raise notice 'PRECHECK OK';
end
$$;

select 'PRECHECK OK' as result;
