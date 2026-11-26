-- Read only. Run before 20261128300000_logistics_landed_cost.sql.
-- Expect every landed-cost relation to be null, and logistics.can_use() to exist.

select to_regclass('logistics.tariff_cache') as tariff_cache,
       to_regclass('logistics.duty_rates') as duty_rates,
       to_regclass('logistics.landed_cost_calculations') as calculations,
       to_regclass('logistics.landed_cost_lines') as lines,
       to_regprocedure('logistics.can_use()') as can_use;
