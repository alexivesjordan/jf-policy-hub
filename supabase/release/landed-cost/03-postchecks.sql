-- Read only. Run after 20261128300000_logistics_landed_cost.sql.

select c.relname, c.relrowsecurity, c.relkind
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'logistics'
  and c.relname in ('tariff_cache', 'duty_rates', 'landed_cost_calculations', 'landed_cost_lines')
order by c.relname;

select has_table_privilege('anon', 'logistics.tariff_cache', 'select') as anon_cache,
       has_table_privilege('anon', 'logistics.duty_rates', 'select') as anon_rates,
       has_table_privilege('anon', 'logistics.landed_cost_calculations', 'select') as anon_calculations,
       has_table_privilege('authenticated', 'logistics.tariff_cache', 'insert') as authenticated_cache_insert,
       has_table_privilege('authenticated', 'logistics.landed_cost_calculations', 'update') as authenticated_calc_update;

select count(*) as landed_cost_views
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'logistics'
  and c.relkind = 'v'
  and c.relname like '%landed%';

select count(*) as landed_cost_functions
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'logistics'
  and p.proname like '%landed%';
