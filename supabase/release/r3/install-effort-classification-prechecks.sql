-- Read only. The classification migration is already applied on TEST and production.
-- These checks report that state. They do not change it.

select column_name
from information_schema.columns
where table_schema = 'ops'
  and table_name = 'sku_effort'
  and column_name in ('effort_class', 'effort_rule', 'rack_family')
order by column_name;

select to_regclass('ops.sku_effort_backup_20261124') as sku_backup,
       to_regclass('ops.cin7_category_defaults_backup_20261124') as category_backup;

select effort_class, count(*)
from ops.sku_effort
where status = 'suggested'
group by effort_class
order by effort_class;
