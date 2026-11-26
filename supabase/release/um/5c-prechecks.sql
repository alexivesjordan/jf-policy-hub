-- Read only. Run before 20261127160000_two_step_safety.sql.
-- 20261127140000 must already be applied. Do not apply to production.

select
  to_regclass('core.security_policy') as policy,
  to_regprocedure('public.two_step_due()') as due,
  exists (
    select 1
    from information_schema.columns
    where table_schema = 'core'
      and table_name = 'security_policy'
      and column_name = 'released_at'
  ) as already_has_release;
