-- Read-only. Run before 20261129100000_logistics_load_plans.sql.
-- Expected on a database that already has the packing catalogue:
--   load_plans is null
--   can_admin_spaces is null
--   logistics_can_admin_spaces is null
--   keep_author is null
--   spaces >= 5
--   pallets >= 2
--   bad_codes = 0
-- Do not apply to production.

select
  to_regclass('logistics.load_plans') as load_plans,
  to_regprocedure('logistics.can_admin_spaces()') as can_admin_spaces,
  to_regprocedure('public.logistics_can_admin_spaces()') as logistics_can_admin_spaces,
  to_regprocedure('logistics.load_plans_keep_author()') as keep_author,
  (select count(*) from logistics.load_spaces where kind in ('container', 'vehicle')) as spaces,
  (select count(*) from logistics.load_spaces where kind = 'pallet') as pallets,
  (select count(*) from logistics.load_spaces where code !~ '^[a-z0-9][a-z0-9-]{0,39}$') as bad_codes;
