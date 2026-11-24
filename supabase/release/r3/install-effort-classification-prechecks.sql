-- Read only. Release order: 20261124160000, then 20261124170000, then the app.
-- Not applied to production. Fails if the classification column is missing.

do $$
begin
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'ops'
      and table_name = 'sku_effort'
      and column_name = 'effort_class'
  ) then
    raise exception 'PRECHECK FAILED: ops.sku_effort.effort_class is missing. Apply 20261124160000_install_effort_classification.sql before 20261124170000.';
  end if;
end
$$;

select column_name
from information_schema.columns
where table_schema = 'ops'
  and table_name = 'sku_effort'
  and column_name in ('effort_class', 'effort_rule', 'rack_family')
order by column_name;

select to_regclass('ops.sku_effort_backup_20261124') as sku_backup,
       to_regclass('ops.cin7_category_defaults_backup_20261124') as category_backup;
