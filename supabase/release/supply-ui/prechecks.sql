-- Read only. Run before 20261128700400_supply_match_codes.sql. Not for production.
-- Expected: PRECHECK OK. The supply schema from the data PR is present.
-- supply_match_codes is not created yet.

do $$
begin
  if to_regnamespace('supply') is null then
    raise exception 'PRECHECK FAILED: schema supply is missing.';
  end if;
  if to_regprocedure('public.supply_match_codes(text,jsonb)') is not null then
    raise exception 'PRECHECK FAILED: supply_match_codes already exists.';
  end if;
  raise notice 'PRECHECK OK';
end
$$;

select 'PRECHECK OK' as result;
